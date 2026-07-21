// Pure parser for Kindle "My Clippings.txt". No React, no storage, no network.
// parseClippings(text) -> { books, skipped, stats }
//
//   books:   [{ title, author, matchKey, highlights: [Highlight] }]
//   skipped: [{ raw, reason }]
//   stats:   { books, highlights, notes, bookmarks, skipped, duplicates }
//
// Highlight: { id, text, note, location, page, dateRaw, date, limited }

import { hashString } from './hash'
import { makeMatchKey } from './normalize'

// Localized keyword tables. Detection uses these first, then falls back to a
// structural heuristic (empty body => bookmark, otherwise highlight) so odd or
// unlisted languages still parse.
const TYPE_PATTERNS = [
  { type: 'bookmark', re: /(bookmark|marcador|lesezeichen|signet|segnalibro|marca-p[aá]gina)/i },
  { type: 'note', re: /(\bnote\b|\bnota\b|notiz|anmerkung|annotazione)/i },
  { type: 'highlight', re: /(highlight|subrayado|markierung|surlignement|destaque|evidenziazione)/i },
]

const CLIPPING_LIMIT_RE = /(clipping limit|l[ií]mite de recortes|grenze .* markierungen)/i

// "Added on ...", "Añadido el ...", etc. — strip the localized lead-in.
const DATE_LEADIN_RE =
  /^\s*-?\s*(added on|a[nñ]adido el|hinzugef[üu]gt am|ajout[ée] le|adicionado(?: em)?|aggiunto il)\s*/i

function detectType(metaLine, body) {
  for (const { type, re } of TYPE_PATTERNS) {
    if (re.test(metaLine)) return type
  }
  return body.trim() ? 'highlight' : 'bookmark'
}

function parseTitleAuthor(line) {
  const m = line.match(/^(.*)\(([^)]*)\)\s*$/)
  if (m && m[1].trim()) {
    return { title: m[1].trim(), author: m[2].trim() || null }
  }
  return { title: line.trim(), author: null }
}

// Kindle abbreviates the end of a range ("1406-7" means 1406-1407). Expand so
// overlap math is correct; the raw string is kept separately for display/id.
function expandEnd(start, end) {
  if (end == null) return start
  if (end >= start) return end
  const s = String(start)
  const e = String(end)
  const prefix = s.slice(0, s.length - e.length)
  const full = Number(prefix + e)
  return full >= start ? full : start
}

function parseMeta(metaLine, body) {
  const type = detectType(metaLine, body)

  let location = null
  let locStart = null
  let locEnd = null
  const locM = metaLine.match(
    /(?:location|loc\.?|posici[oó]n|position|posi[cç][aã]o|emplacement)\s*:?\s*(\d+)(?:\s*-\s*(\d+))?/i
  )
  if (locM) {
    locStart = Number(locM[1])
    const rawEnd = locM[2] != null ? Number(locM[2]) : null
    locEnd = expandEnd(locStart, rawEnd)
    location = locM[2] != null ? `${locM[1]}-${locM[2]}` : `${locM[1]}`
  }

  let page = null
  const pageM = metaLine.match(/(?:page|p[aá]gina|seite|página)\s+(\d+)/i)
  if (pageM) page = Number(pageM[1])

  let dateRaw = null
  let date = null
  const segs = metaLine.split('|')
  if (segs.length) {
    dateRaw = segs[segs.length - 1].replace(DATE_LEADIN_RE, '').trim() || null
    if (dateRaw) {
      const d = new Date(dateRaw)
      if (!Number.isNaN(d.getTime())) date = d.toISOString()
    }
  }

  return { type, location, locStart, locEnd, page, dateRaw, date }
}

function makeHighlightId(matchKey, kind, location, text) {
  return hashString(`${matchKey}|${kind}|${location || ''}|${text}`)
}

function rangesOverlap(a, b) {
  if (a.locStart == null || b.locStart == null) return false
  const a2 = a.locEnd ?? a.locStart
  const b2 = b.locEnd ?? b.locStart
  return a.locStart <= b2 && b.locStart <= a2
}

// Normalize for similarity comparison only: lowercase, collapse whitespace,
// drop trailing punctuation (extending a highlight past a sentence end shifts
// the terminal period, so a literal prefix check is too strict).
function normText(s) {
  return (s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?"'’”)\]]+$/, '')
}

// Kindle rewrites a highlight when you extend it, leaving overlapping entries
// where one text extends the other. Keep the longer; drop the rest.
function dedupeHighlights(list) {
  const kept = []
  let duplicates = 0
  for (const h of list) {
    const ht = normText(h.text)
    const idx = kept.findIndex((k) => {
      if (!rangesOverlap(k, h)) return false
      const kt = normText(k.text)
      return kt.startsWith(ht) || ht.startsWith(kt) || kt.includes(ht) || ht.includes(kt)
    })
    if (idx === -1) {
      kept.push(h)
    } else {
      duplicates++
      if (h.text.length > kept[idx].text.length) kept[idx] = h
    }
  }
  return { kept, duplicates }
}

function attachNotes(highlights, notes) {
  const leftover = []
  for (const n of notes) {
    let best = null
    let bestDist = Infinity
    for (const h of highlights) {
      let dist = Infinity
      if (rangesOverlap(n, h)) dist = 0
      else if (n.locStart != null && h.locStart != null)
        dist = Math.abs(n.locStart - h.locStart)
      else if (n.page != null && n.page === h.page) dist = 1
      if (dist < bestDist) {
        bestDist = dist
        best = h
      }
    }
    if (best && bestDist <= 3) {
      best.note = best.note ? `${best.note}\n\n${n.text}` : n.text
    } else {
      leftover.push(n)
    }
  }
  return leftover
}

export function parseClippings(text) {
  const skipped = []
  const stats = { books: 0, highlights: 0, notes: 0, bookmarks: 0, skipped: 0, duplicates: 0 }

  if (!text || typeof text !== 'string') {
    return { books: [], skipped, stats }
  }

  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const rawEntries = normalized
    .split(/\n?={5,}[ \t]*\n?/)
    .map((e) => e.replace(/^\n+|\n+$/g, ''))
    .filter((e) => e.trim().length > 0)

  // matchKey -> { title, author, matchKey, highlights: [], notes: [] }
  const byBook = new Map()

  for (const raw of rawEntries) {
    const lines = raw.split('\n')
    if (lines.length < 2 || !/^\s*-/.test(lines[1])) {
      skipped.push({ raw, reason: 'no metadata line' })
      stats.skipped++
      continue
    }

    const { title, author } = parseTitleAuthor(lines[0])
    if (!title) {
      skipped.push({ raw, reason: 'no title' })
      stats.skipped++
      continue
    }

    const metaLine = lines[1]
    const body = lines.slice(2).join('\n').trim()
    const meta = parseMeta(metaLine, body)

    if (meta.type === 'bookmark') {
      stats.bookmarks++
      continue // skipped per product decision (no text)
    }

    const limited = CLIPPING_LIMIT_RE.test(body)
    if (!limited && !body) {
      skipped.push({ raw, reason: 'empty body' })
      stats.skipped++
      continue
    }

    const matchKey = makeMatchKey(title, author)
    if (!byBook.has(matchKey)) {
      byBook.set(matchKey, { title, author, matchKey, highlights: [], notes: [] })
    }
    const bucket = byBook.get(matchKey)

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

    if (meta.type === 'note') {
      stats.notes++
      bucket.notes.push(entry)
    } else {
      stats.highlights++
      bucket.highlights.push(entry)
    }
  }

  const books = []
  for (const bucket of byBook.values()) {
    const { kept, duplicates } = dedupeHighlights(bucket.highlights)
    stats.duplicates += duplicates

    const leftoverNotes = attachNotes(kept, bucket.notes)
    // Notes with no matching highlight survive as text-less entries.
    for (const n of leftoverNotes) {
      kept.push({ ...n, text: '', note: n.text })
    }

    if (kept.length === 0) continue

    const highlights = kept.map((h) => ({
      id: makeHighlightId(bucket.matchKey, h.text ? 'hl' : 'note', h.location, h.text || h.note || ''),
      text: h.text,
      note: h.note,
      location: h.location,
      page: h.page,
      dateRaw: h.dateRaw,
      date: h.date,
      limited: !!h.limited,
    }))

    books.push({
      title: bucket.title,
      author: bucket.author,
      matchKey: bucket.matchKey,
      highlights,
    })
  }

  stats.books = books.length
  return { books, skipped, stats }
}
