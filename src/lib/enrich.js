// Book-metadata enrichment. Queries Google Books first, falls back to Open
// Library. Pure except for the injected fetch — so mapping/scoring is unit
// tested without live network. Throttling + caching live in the caller.
import { normalizeTitle, normalizeAuthor, authorToFirstLast } from './normalize'

const ENRICHABLE = ['length', 'category', 'description', 'cover', 'isbn']

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
    fields: {
      length: typeof d.number_of_pages_median === 'number' ? d.number_of_pages_median : null,
      category: d.subject && d.subject[0] ? titleCase(d.subject[0]) : null,
      description: cleanDescription(firstSentence),
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
      isbn: (d.isbn && d.isbn[0]) || null,
    },
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
      score: Number(c.score.toFixed(2)),
      fields: c.fields,
    })),
  }
}

// --- API calls -------------------------------------------------------------

async function tryGoogle(qTitle, qAuthor, fetchImpl) {
  const q = [
    `intitle:${encodeURIComponent(qTitle)}`,
    qAuthor ? `inauthor:${encodeURIComponent(qAuthor)}` : '',
  ]
    .filter(Boolean)
    .join('+')
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5`
  const res = await fetchImpl(url)
  if (!res.ok) return null // 429 / 5xx -> let caller fall back
  const json = await res.json()
  const mapped = (json.items || []).map((it) => mapGoogle(it.volumeInfo || {}))
  return buildResult('google', qTitle, qAuthor, mapped)
}

async function tryOpenLibrary(qTitle, qAuthor, fetchImpl) {
  const params = new URLSearchParams({
    title: qTitle,
    limit: '5',
    fields: 'title,author_name,number_of_pages_median,first_sentence,subject,cover_i,isbn',
  })
  if (qAuthor) params.set('author', qAuthor)
  const url = `https://openlibrary.org/search.json?${params.toString()}`
  const res = await fetchImpl(url)
  if (!res.ok) return null
  const json = await res.json()
  const mapped = (json.docs || []).map(mapOpenLibrary)
  return buildResult('openlibrary', qTitle, qAuthor, mapped)
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

  return result || { source: null, match: 'none', score: 0, fields: {}, candidates: [] }
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
