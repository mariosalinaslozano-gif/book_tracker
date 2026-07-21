import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { loadState, saveState, createId, backfillBook, loadApiKey } from '../utils/storage'
import { makeMatchKey } from '../lib/normalize'
import { mergeHighlights, hasNoteRefresh } from '../lib/merge'
import { enrichBook, pickEnrichPatch, ENRICHABLE, setGoogleApiKey } from '../lib/enrich'
import { bookNeedsEnrichment, fieldEmpty } from '../lib/enrichPolicy'

// Apply any saved Google Books API key before the app makes lookups.
setGoogleApiKey(loadApiKey())

const BooksContext = createContext(null)

const EDITABLE_FIELDS = ['title', 'author', 'category', 'description', 'length', 'notes']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function BooksProvider({ children }) {
  const [state, setState] = useState(() => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  const books = state.books

  const setBooks = (updater) =>
    setState((s) => ({
      ...s,
      books: typeof updater === 'function' ? updater(s.books) : updater,
    }))

  const addBook = (bookData) => {
    // Everything the user typed here is hand-authored, so mark it protected.
    const userEdited = EDITABLE_FIELDS.filter((f) => {
      const v = bookData[f]
      return v !== undefined && v !== null && String(v).trim() !== '' && !(f === 'length' && !v)
    })
    const newBook = backfillBook({
      id: createId(),
      title: bookData.title,
      author: bookData.author,
      category: bookData.category,
      description: bookData.description,
      length: bookData.length,
      cover: bookData.cover ?? null,
      status: 'to-read',
      source: 'manual',
      userEdited,
    })
    setBooks((prev) => [...prev, newBook])
  }

  const markAsRead = (id) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, status: 'read', dateFinished: new Date().toISOString() } : b
      )
    )
  }

  const updateNotes = (id, notes) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, notes, userEdited: addEdited(b.userEdited, 'notes') }
          : b
      )
    )
  }

  // Generic edit used by the edit form; every changed field becomes protected
  // so import/enrichment never overwrites it.
  const updateBook = (id, patch) => {
    setBooks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b
        const changed = Object.keys(patch).filter((k) => patch[k] !== b[k])
        const next = { ...b, ...patch }
        next.userEdited = changed.reduce((acc, k) => addEdited(acc, k), b.userEdited)
        if (patch.title !== undefined || patch.author !== undefined) {
          next.matchKey = makeMatchKey(next.title, next.author)
        }
        return next
      })
    )
  }

  const deleteBook = (id) => {
    setBooks((prev) => prev.filter((b) => b.id !== id))
  }

  const deleteHighlight = (bookId, hlId) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === bookId
          ? {
              ...b,
              highlights: b.highlights.filter((h) => h.id !== hlId),
              deletedHighlightIds: b.deletedHighlightIds.includes(hlId)
                ? b.deletedHighlightIds
                : [...b.deletedHighlightIds, hlId],
            }
          : b
      )
    )
  }

  // Merge parsed clippings into the library. Idempotent: only new highlight ids
  // (not already stored, not tombstoned) are added; existing metadata untouched.
  const importParsed = (parsed, selectedKeys) => {
    // Computed synchronously from current state so the returned summary is
    // accurate (mutating counters inside the async updater under-reported them).
    const summary = { booksAdded: 0, booksUpdated: 0, highlightsAdded: 0 }
    const selected = selectedKeys ? new Set(selectedKeys) : null

    const next = [...state.books]
    const indexByKey = new Map(next.map((b, i) => [b.matchKey, i]))

    for (const pb of parsed.books) {
      if (selected && !selected.has(pb.matchKey)) continue
      const at = indexByKey.get(pb.matchKey)

      if (at === undefined) {
        const merged = mergeHighlights([], [], pb.highlights)
        const nb = backfillBook({
          id: createId(),
          title: pb.title,
          author: pb.author ?? '',
          matchKey: pb.matchKey,
          source: 'kindle',
          status: 'to-read',
          highlights: merged,
        })
        next.push(nb)
        indexByKey.set(pb.matchKey, next.length - 1)
        summary.booksAdded++
        summary.highlightsAdded += merged.length
      } else {
        const b = next[at]
        const merged = mergeHighlights(b.highlights, b.deletedHighlightIds, pb.highlights)
        const added = merged.length - b.highlights.length
        const noteRefresh = hasNoteRefresh(b.highlights, pb.highlights)
        if (added > 0 || noteRefresh) {
          next[at] = { ...b, highlights: merged }
          summary.booksUpdated++
          summary.highlightsAdded += added
        }
      }
    }

    setBooks(next)
    return summary
  }

  // Look up metadata for every book that still needs it. Throttled to ~1 req/s,
  // results cached by matchKey. Strong matches auto-fill blank fields; uncertain
  // matches are held (candidates stored) for the user to pick; misses stay blank.
  const enrichLibrary = async ({ onProgress, force = false } = {}) => {
    const targets = state.books.filter(
      (b) => bookNeedsEnrichment(b) && (force || !b.enrichedAt)
    )
    let done = 0
    for (const b of targets) {
      let result = force ? null : state.enrichCache[b.matchKey]
      if (!result) {
        result = await enrichBook({ title: b.title, author: b.author })
        setState((s) => ({
          ...s,
          enrichCache: {
            ...s.enrichCache,
            [b.matchKey]: { ...result, fetchedAt: new Date().toISOString() },
          },
        }))
        await sleep(1000) // be polite to the free APIs
      }
      setBooks((prev) =>
        prev.map((x) => {
          if (x.id !== b.id) return x
          const patch = result.match === 'strong' ? pickEnrichPatch(x, result.fields) : {}
          return {
            ...x,
            ...patch,
            enrichedAt: new Date().toISOString(),
            enrichStatus: result.match,
            enrichCandidates: result.match === 'uncertain' ? result.candidates : null,
          }
        })
      )
      done++
      onProgress?.(done, targets.length, b.title)
    }
    return { processed: targets.length }
  }

  // User picks a specific candidate for an uncertain book: fill its blank fields
  // from that candidate and clear the uncertain flag.
  const applyEnrichCandidate = (bookId, candidate) => {
    setBooks((prev) =>
      prev.map((x) => {
        if (x.id !== bookId) return x
        const patch = {}
        for (const f of ENRICHABLE) {
          const v = candidate.fields[f]
          if (v == null || v === '') continue
          if ((x.userEdited || []).includes(f)) continue
          if (fieldEmpty(x, f)) patch[f] = v
        }
        return { ...x, ...patch, enrichStatus: 'strong', enrichCandidates: null }
      })
    )
  }

  const exportState = () => JSON.stringify(state, null, 2)

  const restoreState = (json) => {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json
    if (!parsed || !Array.isArray(parsed.books)) throw new Error('Invalid backup file')
    setState({
      schemaVersion: 1,
      books: parsed.books.map(backfillBook),
      enrichCache: parsed.enrichCache && typeof parsed.enrichCache === 'object' ? parsed.enrichCache : {},
    })
  }

  const value = useMemo(
    () => ({
      books,
      state,
      addBook,
      markAsRead,
      updateNotes,
      updateBook,
      deleteBook,
      deleteHighlight,
      importParsed,
      enrichLibrary,
      applyEnrichCandidate,
      exportState,
      restoreState,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  )

  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>
}

function addEdited(list = [], field) {
  return list.includes(field) ? list : [...list, field]
}

export function useBooks() {
  const ctx = useContext(BooksContext)
  if (!ctx) throw new Error('useBooks must be used within a BooksProvider')
  return ctx
}
