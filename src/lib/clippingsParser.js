// Pure parser for Kindle "My Clippings.txt". No React, no storage, no network.
// parseClippings(text) -> { books, skipped, stats }
//
//   books:   [{ title, author, matchKey, highlights: [Highlight] }]
//   skipped: [{ raw, reason }]
//   stats:   { books, highlights, notes, bookmarks, skipped, duplicates }
//
// Highlight: { id, text, note, location, page, dateRaw, date, limited }

// hashString -> stable content-hash ids for highlights.
import { hashString } from './hash'
// makeMatchKey -> normalized "title|author" key used to group/match books.
import { makeMatchKey } from './normalize'

// Localized keyword tables. Detection uses these first, then falls back to a
// structural heuristic (empty body => bookmark, otherwise highlight) so odd or
// unlisted languages still parse. Order matters: checked top to bottom.
const TYPE_PATTERNS = [
  // Words meaning "bookmark" across the languages Kindle ships.
  { type: 'bookmark', re: /(bookmark|marcador|lesezeichen|signet|segnalibro|marca-p[aá]gina)/i },
  // Words meaning "note".
  { type: 'note', re: /(\bnote\b|\bnota\b|notiz|anmerkung|annotazione)/i },
  // Words meaning "highlight".
  { type: 'highlight', re: /(highlight|subrayado|markierung|surlignement|destaque|evidenziazione)/i },
]

// Matches the DRM "clipping limit reached" placeholder Kindle writes instead of text.
const CLIPPING_LIMIT_RE = /(clipping limit|l[ií]mite de recortes|grenze .* markierungen)/i

// "Added on ...", "Añadido el ...", etc. — strip the localized lead-in so only
// the date text remains.
const DATE_LEADIN_RE =
  /^\s*-?\s*(added on|a[nñ]adido el|hinzugef[üu]gt am|ajout[ée] le|adicionado(?: em)?|aggiunto il)\s*/i

// Decide whether an entry is a highlight, note, or bookmark.
function detectType(metaLine, body) {
  // Try each localized keyword pattern in priority order.
  for (const { type, re } of TYPE_PATTERNS) {
    // First pattern that appears in the metadata line wins.
    if (re.test(metaLine)) return type
  }
  // No keyword matched: a non-empty body is a highlight, empty is a bookmark.
  return body.trim() ? 'highlight' : 'bookmark'
}

// Split the first line "Title (Author)" into its two parts.
function parseTitleAuthor(line) {
  // Greedy match up to the LAST parenthesized group (that group is the author).
  const m = line.match(/^(.*)\(([^)]*)\)\s*$/)
  // If it matched and there's a non-empty title before the parens...
  if (m && m[1].trim()) {
    // ...return trimmed title and author (author may be blank -> null).
    return { title: m[1].trim(), author: m[2].trim() || null }
  }
  // No parenthesized author: whole line is the title, author unknown.
  return { title: line.trim(), author: null }
}

// Kindle abbreviates the end of a range ("1406-7" means 1406-1407). Expand so
// overlap math is correct; the raw string is kept separately for display/id.
function expandEnd(start, end) {
  // No end given: the range is a single point.
  if (end == null) return start
  // Already a full number >= start: use it as-is.
  if (end >= start) return end
  // Otherwise the end is abbreviated — reconstruct it from the start's prefix.
  const s = String(start)
  const e = String(end)
  // Take the leading digits of start that the abbreviation dropped...
  const prefix = s.slice(0, s.length - e.length)
  // ...and glue the abbreviated end onto them (1406 + "7" -> 1407).
  const full = Number(prefix + e)
  // Guard against nonsense: never return an end below the start.
  return full >= start ? full : start
}

// Pull type, location, page, and date out of the "- Your Highlight ..." line.
function parseMeta(metaLine, body) {
  // Classify the entry first.
  const type = detectType(metaLine, body)

  // Location fields (raw display string + numeric start/end for overlap math).
  let location = null
  let locStart = null
  let locEnd = null
  // Match "Location 100-108" / "Loc. 1406-7" / Spanish "posición", etc.
  const locM = metaLine.match(
    /(?:location|loc\.?|posici[oó]n|position|posi[cç][aã]o|emplacement)\s*:?\s*(\d+)(?:\s*-\s*(\d+))?/i
  )
  // If a location was found...
  if (locM) {
    // ...first captured number is the start.
    locStart = Number(locM[1])
    // Second number (if any) is the raw end.
    const rawEnd = locM[2] != null ? Number(locM[2]) : null
    // Expand any abbreviated end for correct numeric comparisons.
    locEnd = expandEnd(locStart, rawEnd)
    // Keep the original human-readable location string ("100-108" or "163").
    location = locM[2] != null ? `${locM[1]}-${locM[2]}` : `${locM[1]}`
  }

  // Page number (only present on some devices/firmwares).
  let page = null
  // Match "page 5" / Spanish "página 5" / German "seite 5".
  const pageM = metaLine.match(/(?:page|p[aá]gina|seite|página)\s+(\d+)/i)
  // Store it as a number when found.
  if (pageM) page = Number(pageM[1])

  // Date: keep the raw text always, and an ISO version when parseable.
  let dateRaw = null
  let date = null
  // The date sits in the last "|"-delimited segment of the meta line.
  const segs = metaLine.split('|')
  if (segs.length) {
    // Take the last segment, strip the "Added on" lead-in, trim (or null).
    dateRaw = segs[segs.length - 1].replace(DATE_LEADIN_RE, '').trim() || null
    // Best-effort parse of the localized date string.
    if (dateRaw) {
      const d = new Date(dateRaw)
      // Only keep an ISO date if JS actually understood the string.
      if (!Number.isNaN(d.getTime())) date = d.toISOString()
    }
  }

  // Hand back everything we extracted.
  return { type, location, locStart, locEnd, page, dateRaw, date }
}

// Build a STABLE id from the book key, kind, location, and text so re-imports
// produce identical ids (idempotency). Notes hash on location, not text.
function makeHighlightId(matchKey, kind, location, text) {
  return hashString(`${matchKey}|${kind}|${location || ''}|${text}`)
}

// Do two entries' location ranges overlap? Used to cluster related entries.
function rangesOverlap(a, b) {
  // Can't compare if either lacks a numeric start.
  if (a.locStart == null || b.locStart == null) return false
  // Treat a missing end as a single-point range (end = start).
  const a2 = a.locEnd ?? a.locStart
  const b2 = b.locEnd ?? b.locStart
  // Standard interval-overlap test.
  return a.locStart <= b2 && b.locStart <= a2
}

// Normalize for similarity comparison only: lowercase, collapse whitespace,
// drop trailing punctuation (extending a highlight past a sentence end shifts
// the terminal period, so a literal prefix check is too strict).
function normText(s) {
  return (s || '')
    // Trim ends.
    .trim()
    // Case-insensitive.
    .toLowerCase()
    // Collapse internal whitespace runs to a single space.
    .replace(/\s+/g, ' ')
    // Drop trailing punctuation so "dog." and "dog" compare equal.
    .replace(/[.,;:!?"'’”)\]]+$/, '')
}

// Kindle rewrites a highlight when you extend it, leaving overlapping entries
// where one text extends the other. Keep the longer; drop the rest.
function dedupeHighlights(list) {
  // Highlights we're keeping.
  const kept = []
  // Count of overlapping duplicates removed (for stats).
  let duplicates = 0
  // Walk every raw highlight.
  for (const h of list) {
    // Normalized text of the current highlight.
    const ht = normText(h.text)
    // Find an already-kept highlight that overlaps AND shares text with this one.
    const idx = kept.findIndex((k) => {
      // Must overlap by location to be considered the same passage.
      if (!rangesOverlap(k, h)) return false
      // Compare normalized texts.
      const kt = normText(k.text)
      // Same passage if either text is a prefix/substring of the other.
      return kt.startsWith(ht) || ht.startsWith(kt) || kt.includes(ht) || ht.includes(kt)
    })
    // No match: it's a distinct highlight, keep it.
    if (idx === -1) {
      kept.push(h)
    } else {
      // Match: it's a duplicate/extension.
      duplicates++
      // Keep whichever version has more text (the fuller highlight).
      if (h.text.length > kept[idx].text.length) kept[idx] = h
    }
  }
  // Return the deduped list plus how many we merged away.
  return { kept, duplicates }
}

// Kindle re-saves a note every time you pause typing it, leaving many Note
// entries at the same location (progressively longer drafts). Collapse each
// location cluster to the last one written — the completed note.
function dedupeNotes(list) {
  // Notes we're keeping (one per location cluster).
  const kept = []
  // Walk every note entry in file (chronological) order.
  for (const n of list) {
    // Find an already-kept note at the same place.
    const idx = kept.findIndex((k) => {
      // Prefer matching by location range when both have one...
      if (k.locStart != null && n.locStart != null) return rangesOverlap(k, n)
      // ...otherwise fall back to matching by page.
      return k.page != null && k.page === n.page
    })
    // New location: keep this note.
    if (idx === -1) kept.push(n)
    // Same location: overwrite with the later draft (last write wins).
    else kept[idx] = n // last write wins = the finished note
  }
  // Return one finished note per cluster.
  return kept
}

// Attach each note to the highlight it annotates (by nearest location). Notes
// with no nearby highlight are returned as "leftover".
function attachNotes(highlights, notes) {
  // Notes we couldn't attach to any highlight.
  const leftover = []
  // For every (deduped) note...
  for (const n of notes) {
    // Track the closest highlight and its distance.
    let best = null
    let bestDist = Infinity
    // Compare against each highlight.
    for (const h of highlights) {
      // Distance metric: 0 if ranges overlap...
      let dist = Infinity
      if (rangesOverlap(n, h)) dist = 0
      // ...else the gap between location starts...
      else if (n.locStart != null && h.locStart != null)
        dist = Math.abs(n.locStart - h.locStart)
      // ...else same-page counts as near (distance 1).
      else if (n.page != null && n.page === h.page) dist = 1
      // Remember the closest highlight so far.
      if (dist < bestDist) {
        bestDist = dist
        best = h
      }
    }
    // Close enough (within 3 locations): attach the note to that highlight.
    if (best && bestDist <= 3) {
      // Append to any existing note, or set it if this is the first.
      best.note = best.note ? `${best.note}\n\n${n.text}` : n.text
    } else {
      // Otherwise it's a standalone note — keep it for later.
      leftover.push(n)
    }
  }
  // Hand back the notes that didn't attach anywhere.
  return leftover
}

// MAIN ENTRY POINT: text -> structured { books, skipped, stats }.
export function parseClippings(text) {
  // Entries we couldn't parse, with a reason (surfaced in the UI).
  const skipped = []
  // Running tallies for the import preview.
  const stats = { books: 0, highlights: 0, notes: 0, bookmarks: 0, skipped: 0, duplicates: 0 }

  // Defensive: nothing sensible to do with non-string input.
  if (!text || typeof text !== 'string') {
    return { books: [], skipped, stats }
  }

  // Strip a leading BOM, then normalize CRLF/CR line endings to plain "\n".
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  // Split on the "==========" separators into individual raw entries...
  const rawEntries = normalized
    .split(/\n?={5,}[ \t]*\n?/)
    // ...trim stray blank lines around each entry...
    .map((e) => e.replace(/^\n+|\n+$/g, ''))
    // ...and drop any empty chunks.
    .filter((e) => e.trim().length > 0)

  // Group entries by book: matchKey -> { title, author, matchKey, highlights, notes }.
  const byBook = new Map()

  // Process each raw entry.
  for (const raw of rawEntries) {
    // Split the entry into its lines.
    const lines = raw.split('\n')
    // Line 2 must be the "- ..." metadata line; if not, this entry is malformed.
    if (lines.length < 2 || !/^\s*-/.test(lines[1])) {
      // Record it as skipped and move on (never throw on bad data).
      skipped.push({ raw, reason: 'no metadata line' })
      stats.skipped++
      continue
    }

    // Parse the "Title (Author)" first line.
    const { title, author } = parseTitleAuthor(lines[0])
    // A missing title means we can't identify the book — skip.
    if (!title) {
      skipped.push({ raw, reason: 'no title' })
      stats.skipped++
      continue
    }

    // The metadata line (type/location/page/date).
    const metaLine = lines[1]
    // Everything after the blank line 3 is the body text.
    const body = lines.slice(2).join('\n').trim()
    // Extract structured metadata.
    const meta = parseMeta(metaLine, body)

    // Bookmarks carry no text — count them but don't import them.
    if (meta.type === 'bookmark') {
      stats.bookmarks++
      continue // skipped per product decision (no text)
    }

    // Detect the DRM "clipping limit reached" placeholder.
    const limited = CLIPPING_LIMIT_RE.test(body)
    // An entry that's neither limited nor has body text is useless — skip.
    if (!limited && !body) {
      skipped.push({ raw, reason: 'empty body' })
      stats.skipped++
      continue
    }

    // Compute the book's grouping key.
    const matchKey = makeMatchKey(title, author)
    // First time we see this book: create its bucket.
    if (!byBook.has(matchKey)) {
      byBook.set(matchKey, { title, author, matchKey, highlights: [], notes: [] })
    }
    // The bucket for this book.
    const bucket = byBook.get(matchKey)

    // Build the raw entry object (ids/attachment happen later, per book).
    const entry = {
      text: body,
      note: null,
      location: meta.location,
      locStart: meta.locStart,
      locEnd: meta.locEnd,
      page: meta.page,
      dateRaw: meta.dateRaw,
      date: meta.date,
      limited,
    }

    // Route notes and highlights into their respective sub-lists.
    if (meta.type === 'note') {
      stats.notes++
      bucket.notes.push(entry)
    } else {
      stats.highlights++
      bucket.highlights.push(entry)
    }
  }

  // Final per-book assembly.
  const books = []
  // Process each book bucket.
  for (const bucket of byBook.values()) {
    // Collapse extended/overlapping highlights; track how many merged.
    const { kept, duplicates } = dedupeHighlights(bucket.highlights)
    stats.duplicates += duplicates

    // Collapse Kindle's per-keystroke note drafts to the finished note.
    const notes = dedupeNotes(bucket.notes)
    // Attach notes to their highlights; keep the ones that don't attach.
    const leftoverNotes = attachNotes(kept, notes)
    // Notes with no matching highlight survive as text-less entries.
    for (const n of leftoverNotes) {
      // Represent a standalone note as a highlight with empty text + the note.
      kept.push({ ...n, text: '', note: n.text })
    }

    // If nothing survived for this book, skip it entirely.
    if (kept.length === 0) continue

    // Finalize each kept entry into the public Highlight shape (with a stable id).
    const highlights = kept.map((h) => ({
      // Highlights hash on their passage text; standalone notes hash on location.
      id: makeHighlightId(bucket.matchKey, h.text ? 'hl' : 'note', h.location, h.text || h.note || ''),
      text: h.text,
      note: h.note,
      location: h.location,
      page: h.page,
      dateRaw: h.dateRaw,
      date: h.date,
      // Coerce the limited flag to a real boolean.
      limited: !!h.limited,
    }))

    // Emit the finished book record.
    books.push({
      title: bucket.title,
      author: bucket.author,
      matchKey: bucket.matchKey,
      highlights,
    })
  }

  // Record the final book count and return the full result.
  stats.books = books.length
  return { books, skipped, stats }
}
