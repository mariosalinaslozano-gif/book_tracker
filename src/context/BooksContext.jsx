// React context that owns the whole library state and exposes all the
// operations (add/edit/import/enrich/etc.) the UI calls. State lives here;
// every mutation persists to storage via an effect.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
// Storage seam: load/save the state, mint ids, backfill records, read the API key.
import { loadState, saveState, createId, backfillBook, loadApiKey } from '../utils/storage'
// Recompute a book's dedupe key when its title/author change.
import { makeMatchKey } from '../lib/normalize'
// Highlight merge helpers (idempotent import + note refresh).
import { mergeHighlights, hasNoteRefresh } from '../lib/merge'
// Enrichment engine + the "fill only blanks" patch helper + field list + key setter.
import { enrichBook, pickEnrichPatch, ENRICHABLE, setGoogleApiKey } from '../lib/enrich'
// Policy for which books/fields still need metadata.
import { bookNeedsEnrichment, fieldEmpty } from '../lib/enrichPolicy'

// Apply any saved Google Books API key before the app makes lookups.
// (Runs once at module load, before the provider mounts.)
setGoogleApiKey(loadApiKey())

// The context object components subscribe to via useBooks().
const BooksContext = createContext(null)

// Fields a user can hand-edit; editing any of these marks it "protected".
const EDITABLE_FIELDS = ['title', 'author', 'category', 'description', 'length', 'notes']

// Tiny promise-based delay used to throttle enrichment requests.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Provider that wraps the app and supplies the books API.
export function BooksProvider({ children }) {
  // The single source of truth: { schemaVersion, books, enrichCache }.
  // Lazily initialized from storage on first render.
  const [state, setState] = useState(() => loadState())

  // Persist the entire state whenever it changes.
  useEffect(() => {
    saveState(state)
  }, [state])

  // Convenience accessor for the books array.
  const books = state.books

  // Update just the books array (accepts a new array or an updater function),
  // leaving the rest of the state (enrichCache, schemaVersion) intact.
  const setBooks = (updater) =>
    setState((s) => ({
      ...s,
      books: typeof updater === 'function' ? updater(s.books) : updater,
    }))

  // Create a new book from the Add form.
  const addBook = (bookData) => {
    // Everything the user typed here is hand-authored, so mark it protected.
    // Keep only the editable fields that actually have a value.
    const userEdited = EDITABLE_FIELDS.filter((f) => {
      const v = bookData[f]
      // Non-empty, and (for length) not zero.
      return v !== undefined && v !== null && String(v).trim() !== '' && !(f === 'length' && !v)
    })
    // Build a full book record (backfill supplies the rest of the schema).
    const newBook = backfillBook({
      id: createId(),
      title: bookData.title,
      author: bookData.author,
      category: bookData.category,
      description: bookData.description,
      length: bookData.length,
      // Cover may have been set by auto-fill.
      cover: bookData.cover ?? null,
      status: 'to-read',
      source: 'manual',
      userEdited,
    })
    // Append it to the library.
    setBooks((prev) => [...prev, newBook])
  }

  // Mark a book as read and stamp the finish date.
  const markAsRead = (id) => {
    setBooks((prev) =>
      prev.map((b) =>
        // Only the matching book changes; others pass through unchanged.
        b.id === id ? { ...b, status: 'read', dateFinished: new Date().toISOString() } : b
      )
    )
  }

  // Save the user's free-text notes for a book (and protect the notes field).
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
        // Skip non-matching books.
        if (b.id !== id) return b
        // Which patched fields actually differ from the current values.
        const changed = Object.keys(patch).filter((k) => patch[k] !== b[k])
        // Apply the patch.
        const next = { ...b, ...patch }
        // Mark each changed field as user-edited (protected).
        next.userEdited = changed.reduce((acc, k) => addEdited(acc, k), b.userEdited)
        // If identity fields changed, recompute the dedupe key.
        if (patch.title !== undefined || patch.author !== undefined) {
          next.matchKey = makeMatchKey(next.title, next.author)
        }
        return next
      })
    )
  }

  // Remove a book entirely.
  const deleteBook = (id) => {
    setBooks((prev) => prev.filter((b) => b.id !== id))
  }

  // Delete a single highlight and tombstone its id (so re-import won't re-add it).
  const deleteHighlight = (bookId, hlId) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === bookId
          ? {
              ...b,
              // Drop the highlight.
              highlights: b.highlights.filter((h) => h.id !== hlId),
              // Record its id as a tombstone (avoid duplicates in the list).
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
    // Which books the user checked to import (null = all).
    const selected = selectedKeys ? new Set(selectedKeys) : null

    // Work on a copy of the current books.
    const next = [...state.books]
    // Index existing books by matchKey for quick lookup.
    const indexByKey = new Map(next.map((b, i) => [b.matchKey, i]))

    // Process each parsed book.
    for (const pb of parsed.books) {
      // Skip books the user didn't select.
      if (selected && !selected.has(pb.matchKey)) continue
      // Position of an existing book with the same key (or undefined).
      const at = indexByKey.get(pb.matchKey)

      if (at === undefined) {
        // New book: all its highlights are new.
        const merged = mergeHighlights([], [], pb.highlights)
        // Build the record (source = 'kindle', default to-read).
        const nb = backfillBook({
          id: createId(),
          title: pb.title,
          author: pb.author ?? '',
          matchKey: pb.matchKey,
          source: 'kindle',
          status: 'to-read',
          highlights: merged,
        })
        // Append and index it.
        next.push(nb)
        indexByKey.set(pb.matchKey, next.length - 1)
        // Tally.
        summary.booksAdded++
        summary.highlightsAdded += merged.length
      } else {
        // Existing book: merge in new highlights and refresh changed notes.
        const b = next[at]
        const merged = mergeHighlights(b.highlights, b.deletedHighlightIds, pb.highlights)
        // How many genuinely-new highlights were added.
        const added = merged.length - b.highlights.length
        // Did any existing highlight's note change (e.g. repaired note parsing)?
        const noteRefresh = hasNoteRefresh(b.highlights, pb.highlights)
        // Only write (and count as updated) if something actually changed.
        if (added > 0 || noteRefresh) {
          next[at] = { ...b, highlights: merged }
          summary.booksUpdated++
          summary.highlightsAdded += added
        }
      }
    }

    // Commit the new books array and hand back the accurate summary.
    setBooks(next)
    return summary
  }

  // Look up metadata for every book that still needs it. Throttled to ~1 req/s,
  // results cached by matchKey. Strong matches auto-fill blank fields; uncertain
  // matches are held (candidates stored) for the user to pick; misses stay blank.
  const enrichLibrary = async ({ onProgress, force = false } = {}) => {
    // Books needing enrichment (unless forced, skip ones already enriched).
    const targets = state.books.filter(
      (b) => bookNeedsEnrichment(b) && (force || !b.enrichedAt)
    )
    // Progress counter.
    let done = 0
    // Process each target sequentially (so we can throttle).
    for (const b of targets) {
      // Reuse a cached result unless forcing a refresh.
      let result = force ? null : state.enrichCache[b.matchKey]
      if (!result) {
        // Live lookup.
        result = await enrichBook({ title: b.title, author: b.author })
        // Cache the result by matchKey with a timestamp.
        setState((s) => ({
          ...s,
          enrichCache: {
            ...s.enrichCache,
            [b.matchKey]: { ...result, fetchedAt: new Date().toISOString() },
          },
        }))
        await sleep(1000) // be polite to the free APIs
      }
      // Apply the result to this book.
      setBooks((prev) =>
        prev.map((x) => {
          // Leave other books alone.
          if (x.id !== b.id) return x
          // Auto-fill blanks only for a strong match; uncertain/none fill nothing.
          const patch = result.match === 'strong' ? pickEnrichPatch(x, result.fields) : {}
          return {
            ...x,
            ...patch,
            // Record that enrichment ran and its outcome.
            enrichedAt: new Date().toISOString(),
            enrichStatus: result.match,
            // Stash candidates only when the match was uncertain (for the chooser).
            enrichCandidates: result.match === 'uncertain' ? result.candidates : null,
          }
        })
      )
      // Report progress to the caller.
      done++
      onProgress?.(done, targets.length, b.title)
    }
    // Summary of the run.
    return { processed: targets.length }
  }

  // User picks a specific candidate for an uncertain book: fill its blank fields
  // from that candidate and clear the uncertain flag.
  const applyEnrichCandidate = (bookId, candidate) => {
    setBooks((prev) =>
      prev.map((x) => {
        // Only the target book.
        if (x.id !== bookId) return x
        // Build a fill-only-blanks patch from the chosen candidate.
        const patch = {}
        for (const f of ENRICHABLE) {
          const v = candidate.fields[f]
          // Skip empty candidate values.
          if (v == null || v === '') continue
          // Skip user-protected fields.
          if ((x.userEdited || []).includes(f)) continue
          // Only fill fields that are currently empty.
          if (fieldEmpty(x, f)) patch[f] = v
        }
        // Apply and mark the book as resolved (no longer uncertain).
        return { ...x, ...patch, enrichStatus: 'strong', enrichCandidates: null }
      })
    )
  }

  // Serialize the full state as pretty JSON (for the backup download).
  const exportState = () => JSON.stringify(state, null, 2)

  // Replace the library from a backup file (string or object).
  const restoreState = (json) => {
    // Accept either a JSON string or an already-parsed object.
    const parsed = typeof json === 'string' ? JSON.parse(json) : json
    // Validate the shape before trusting it.
    if (!parsed || !Array.isArray(parsed.books)) throw new Error('Invalid backup file')
    // Install the restored state (backfilling any older book records).
    setState({
      schemaVersion: 1,
      books: parsed.books.map(backfillBook),
      enrichCache: parsed.enrichCache && typeof parsed.enrichCache === 'object' ? parsed.enrichCache : {},
    })
  }

  // Memoize the context value so consumers only re-render when state changes.
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
    // Only `state` matters; the handlers are stable enough for our needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  )

  // Provide the value to the tree.
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>
}

// Add a field name to a "userEdited" list without duplicating it.
function addEdited(list = [], field) {
  return list.includes(field) ? list : [...list, field]
}

// Hook components use to read the books API; throws if used outside the provider.
export function useBooks() {
  const ctx = useContext(BooksContext)
  if (!ctx) throw new Error('useBooks must be used within a BooksProvider')
  return ctx
}
