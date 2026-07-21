// Book-metadata enrichment. Queries Google Books first, falls back to Open
// Library. Pure except for the injected fetch — so mapping/scoring is unit
// tested without live network. Throttling + caching live in the caller.
import { normalizeTitle, normalizeAuthor, authorToFirstLast } from './normalize'

const ENRICHABLE = ['length', 'category', 'description', 'cover', 'isbn']

// Optional Google Books API key. Keyless works but is aggressively rate-limited
// (429) and has thin coverage once the anonymous quota is hit; a key gives your
// own quota and full data. Set via setGoogleApiKey (from the settings UI).
let googleApiKey = null
export function setGoogleApiKey(key) {
  googleApiKey = key && key.trim() ? key.trim() : null
}
export function hasGoogleApiKey() {
  return !!googleApiKey
}
function withKey(url) {
  if (!googleApiKey) return url
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(googleApiKey)}`
}

// --- query normalization ---------------------------------------------------

export function titleForQuery(title) {
  return (title || '')
    .split(':')[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function authorForQuery(author) {
  return authorToFirstLast(author || '').trim()
}

// --- similarity scoring ----------------------------------------------------

function tokens(normFn, s) {
  return new Set(normFn(s).split(' ').filter(Boolean))
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export function scoreMatch(qTitle, qAuthor, cTitle, cAuthor) {
  const tSim = jaccard(tokens(normalizeTitle, qTitle), tokens(normalizeTitle, cTitle))
  const aSim =
    qAuthor && cAuthor
      ? jaccard(tokens(normalizeAuthor, qAuthor), tokens(normalizeAuthor, cAuthor))
      : 0.5 // unknown author on either side — neutral, don't penalize
  return 0.7 * tSim + 0.3 * aSim
}

function classify(score, tSim) {
  if (score >= 0.75 && tSim >= 0.6) return 'strong'
  if (score >= 0.35) return 'uncertain'
  return 'none'
}

// --- field mapping ---------------------------------------------------------

function cleanDescription(desc) {
  if (!desc) return null
  const text = String(desc).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > 700 ? text.slice(0, 697).trimEnd() + '…' : text
}

function mapGoogle(v) {
  const ids = v.industryIdentifiers || []
  const isbn = ids.find((x) => x.type === 'ISBN_13') || ids.find((x) => x.type === 'ISBN_10')
  const thumb = v.imageLinks && v.imageLinks.thumbnail
  return {
    title: v.title || '',
    author: (v.authors || []).join(', '),
    year: (v.publishedDate || '').slice(0, 4) || null,
    fields: {
      length: typeof v.pageCount === 'number' && v.pageCount > 0 ? v.pageCount : null,
      category: (v.categories && v.categories[0]) || null,
      description: cleanDescription(v.description),
      cover: thumb ? thumb.replace(/^http:/, 'https:') : null,
      isbn: isbn ? isbn.identifier : null,
    },
  }
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function mapOpenLibrary(d) {
  const firstSentence = Array.isArray(d.first_sentence)
    ? d.first_sentence[0]
    : d.first_sentence && d.first_sentence.value
      ? d.first_sentence.value
      : typeof d.first_sentence === 'string'
        ? d.first_sentence
        : null
  return {
    title: d.title || '',
    author: (d.author_name || []).join(', '),
    year: d.first_publish_year || null,
    workKey: d.key || null,
    // Search index only has a first-sentence snippet (often non-English); keep it
    // as a last-resort fallback. The real description comes from the Works record.
    snippet: cleanDescription(firstSentence),
    fields: {
      length: typeof d.number_of_pages_median === 'number' ? d.number_of_pages_median : null,
      category: d.subject && d.subject[0] ? titleCase(d.subject[0]) : null,
      description: null,
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
      isbn: (d.isbn && d.isbn[0]) || null,
    },
  }
}

// The Open Library "Works" record has a real synopsis (usually English) rather
// than the search index's first-sentence snippet. Fetch it for a proper blurb.
async function fetchOpenLibraryWork(workKey, fetchImpl) {
  const res = await fetchImpl(`https://openlibrary.org${workKey}.json`)
  if (!res.ok) return null
  const j = await res.json()
  let raw = typeof j.description === 'string' ? j.description : (j.description && j.description.value) || null
  if (raw) {
    // Strip Open Library's trailing source footers / markdown link refs.
    raw = raw.split(/\n-{3,}|\n\[\d+\]:|\n?\(\[source\]/i)[0]
  }
  return {
    description: cleanDescription(raw),
    category: j.subjects && j.subjects[0] ? titleCase(j.subjects[0]) : null,
  }
}

// Build a scored result from a list of mapped candidates.
function buildResult(source, qTitle, qAuthor, mapped) {
  if (!mapped.length) return { source, match: 'none', score: 0, fields: {}, candidates: [] }
  const scored = mapped
    .map((c) => {
      const tSim = jaccard(tokens(normalizeTitle, qTitle), tokens(normalizeTitle, c.title))
      const score = scoreMatch(qTitle, qAuthor, c.title, c.author)
      return { ...c, score, tSim }
    })
    .sort((a, b) => b.score - a.score)

  const best = scored[0]
  return {
    source,
    match: classify(best.score, best.tSim),
    score: best.score,
    fields: best.fields,
    candidates: scored.slice(0, 3).map((c) => ({
      title: c.title,
      author: c.author,
      year: c.year,
      gid: c.gid || null,
      score: Number(c.score.toFixed(2)),
      fields: c.fields,
    })),
  }
}

// --- API calls -------------------------------------------------------------

async function googleCandidates(qTitle, qAuthor, fetchImpl) {
  const q = [
    `intitle:${encodeURIComponent(qTitle)}`,
    qAuthor ? `inauthor:${encodeURIComponent(qAuthor)}` : '',
  ]
    .filter(Boolean)
    .join('+')
  // projection=full asks for description/categories, which the default "lite"
  // search projection omits. Some volumes still only expose them on the detail
  // endpoint — completeCandidate() fetches those on demand.
  const url = withKey(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&projection=full`)
  const res = await fetchImpl(url)
  if (!res.ok) return null // 429 / 5xx -> signal "unavailable" so caller falls back
  const json = await res.json()
  return (json.items || []).map((it) => ({ ...mapGoogle(it.volumeInfo || {}), gid: it.id }))
}

// Google's search results often omit description/categories; fetch the full
// volume by id to complete them. Returns the candidate with missing fields
// filled in. Never throws.
async function fetchGoogleVolume(gid, fetchImpl) {
  const res = await fetchImpl(withKey(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(gid)}`))
  if (!res.ok) return null
  const json = await res.json()
  return mapGoogle(json.volumeInfo || {})
}

export async function completeCandidate(candidate, { fetchImpl = fetch } = {}) {
  const f = { ...(candidate.fields || {}) }
  if (f.description && f.category) return candidate

  // 1) Google's search omits description/categories — fetch the full volume.
  if (candidate.gid && (!f.description || !f.category)) {
    try {
      const full = await fetchGoogleVolume(candidate.gid, fetchImpl)
      if (full) {
        f.length = f.length || full.fields.length
        f.category = f.category || full.fields.category
        f.description = f.description || full.fields.description
        f.cover = f.cover || full.fields.cover
        f.isbn = f.isbn || full.fields.isbn
      }
    } catch {
      /* fall through to Open Library */
    }
  }

  // 2) Open Library Works synopsis for this candidate (real, usually-English).
  if (!f.description && candidate.workKey) {
    try {
      const work = await fetchOpenLibraryWork(candidate.workKey, fetchImpl)
      if (work) {
        f.description = work.description
        f.category = f.category || work.category
      }
    } catch {
      /* fall through */
    }
  }

  // 3) Cross-source: search Open Library by title/author for anything still
  //    missing (e.g. a Google candidate when Google is rate-limited).
  if (!f.description || !f.category) {
    try {
      const ol = await openLibraryCandidates(
        titleForQuery(candidate.title),
        authorForQuery(candidate.author),
        fetchImpl
      )
      const best = ol && ol[0]
      if (best) {
        f.category = f.category || best.fields.category
        f.length = f.length || best.fields.length
        f.cover = f.cover || best.fields.cover
        f.isbn = f.isbn || best.fields.isbn
        if (!f.description && best.workKey) {
          const work = await fetchOpenLibraryWork(best.workKey, fetchImpl)
          if (work && work.description) f.description = work.description
        }
        if (!f.description) f.description = best.snippet || null
      }
    } catch {
      /* keep what we have */
    }
  }

  // Absolute last resort: this candidate's own snippet.
  if (!f.description) f.description = candidate.snippet || null

  return { ...candidate, fields: f }
}

async function openLibraryCandidates(qTitle, qAuthor, fetchImpl) {
  const params = new URLSearchParams({
    title: qTitle,
    limit: '5',
    fields:
      'key,title,author_name,first_publish_year,number_of_pages_median,first_sentence,subject,cover_i,isbn',
  })
  if (qAuthor) params.set('author', qAuthor)
  const url = `https://openlibrary.org/search.json?${params.toString()}`
  const res = await fetchImpl(url)
  if (!res.ok) return null
  const json = await res.json()
  return (json.docs || []).map(mapOpenLibrary)
}

async function tryGoogle(qTitle, qAuthor, fetchImpl) {
  const mapped = await googleCandidates(qTitle, qAuthor, fetchImpl)
  return mapped == null ? null : buildResult('google', qTitle, qAuthor, mapped)
}

async function tryOpenLibrary(qTitle, qAuthor, fetchImpl) {
  const mapped = await openLibraryCandidates(qTitle, qAuthor, fetchImpl)
  return mapped == null ? null : buildResult('openlibrary', qTitle, qAuthor, mapped)
}

// Return a ranked, de-duplicated candidate list for the user to pick from
// (title + author search across both sources). Each candidate carries display
// info (title, author, year) plus the mapped `fields` to fill on selection.
export async function searchCandidates({ title, author }, { fetchImpl = fetch, limit = 5 } = {}) {
  const qTitle = titleForQuery(title)
  const qAuthor = authorForQuery(author)
  if (!qTitle) return []

  let all = []
  try {
    const g = await googleCandidates(qTitle, qAuthor, fetchImpl)
    if (g) all = all.concat(g)
  } catch {
    /* ignore, fall through to Open Library */
  }
  if (all.length < limit) {
    try {
      const o = await openLibraryCandidates(qTitle, qAuthor, fetchImpl)
      if (o) all = all.concat(o)
    } catch {
      /* ignore */
    }
  }

  const scored = all
    .map((c) => ({ ...c, score: scoreMatch(qTitle, qAuthor, c.title, c.author) }))
    .sort((a, b) => b.score - a.score)

  const seen = new Set()
  const unique = []
  for (const c of scored) {
    const key = `${normalizeTitle(c.title)}|${normalizeAuthor(c.author)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  return unique.slice(0, limit)
}

// Enrich one book. Returns { source, match, score, fields, candidates }.
// Never throws — network failure yields a 'none' result so the caller can move on.
export async function enrichBook({ title, author }, { fetchImpl = fetch } = {}) {
  const qTitle = titleForQuery(title)
  const qAuthor = authorForQuery(author)
  if (!qTitle) return { source: null, match: 'none', score: 0, fields: {}, candidates: [] }

  let result = null
  try {
    result = await tryGoogle(qTitle, qAuthor, fetchImpl)
  } catch {
    result = null
  }

  if (!result || result.match === 'none') {
    try {
      const ol = await tryOpenLibrary(qTitle, qAuthor, fetchImpl)
      if (ol && (!result || ol.score > result.score)) result = ol
    } catch {
      /* keep whatever we had */
    }
  }

  if (!result) return { source: null, match: 'none', score: 0, fields: {}, candidates: [] }

  // Google's search omits description/categories — complete the chosen match so
  // bulk enrichment fills them too, not just page count.
  if (result.candidates && result.candidates[0]) {
    const completed = await completeCandidate(result.candidates[0], { fetchImpl })
    result = { ...result, fields: completed.fields }
  }

  return result
}

// Which enrichable fields to actually write to a book: skip user-edited fields,
// only fill blanks (never overwrite existing values).
export function pickEnrichPatch(book, fields) {
  const patch = {}
  for (const f of ENRICHABLE) {
    const v = fields[f]
    if (v == null || v === '') continue
    if (book.userEdited && book.userEdited.includes(f)) continue
    const cur = book[f]
    const empty = cur == null || cur === '' || (f === 'length' && !cur)
    if (empty) patch[f] = v
  }
  return patch
}

export { ENRICHABLE }
