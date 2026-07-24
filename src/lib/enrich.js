// Book-metadata enrichment. Queries Google Books first, falls back to Open
// Library. Pure except for the injected fetch — so mapping/scoring is unit
// tested without live network. Throttling + caching live in the caller.
// Normalization helpers reused for building queries and scoring matches.
import { normalizeTitle, normalizeAuthor, authorToFirstLast } from './normalize'

// The fields enrichment can fill on a book.
const ENRICHABLE = ['length', 'category', 'description', 'cover', 'isbn']

// Optional Google Books API key. Keyless works but is aggressively rate-limited
// (429) and has thin coverage once the anonymous quota is hit; a key gives your
// own quota and full data. Set via setGoogleApiKey (from the settings UI).
// Module-level so every request in this file can read it without threading it through.
let googleApiKey = null
// Setter called on app load and whenever the user saves a key.
export function setGoogleApiKey(key) {
  // Store the trimmed key, or null when cleared/blank.
  googleApiKey = key && key.trim() ? key.trim() : null
}
// Lets the UI show whether a key is currently active.
export function hasGoogleApiKey() {
  return !!googleApiKey
}
// Append &key=... (or ?key=...) to a Google URL when a key is set.
function withKey(url) {
  // No key: leave the URL untouched.
  if (!googleApiKey) return url
  // Use & if the URL already has a query string, otherwise ?.
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(googleApiKey)}`
}

// --- query normalization ---------------------------------------------------

// Turn a possibly-messy stored title into a clean search query.
export function titleForQuery(title) {
  return (title || '')
    // Drop any subtitle after a colon.
    .split(':')[0]
    // Remove parenthetical junk like "(z-library.sk)".
    .replace(/\([^)]*\)/g, ' ')
    // Collapse whitespace runs.
    .replace(/\s+/g, ' ')
    // Trim the ends.
    .trim()
}

// Normalize the author for a query ("Last, First" -> "First Last").
export function authorForQuery(author) {
  return authorToFirstLast(author || '').trim()
}

// --- similarity scoring ----------------------------------------------------

// Turn a string into a Set of normalized word tokens (for Jaccard overlap).
function tokens(normFn, s) {
  // Normalize, split on spaces, drop empties, dedupe via Set.
  return new Set(normFn(s).split(' ').filter(Boolean))
}

// Jaccard similarity: size of intersection over size of union (0..1).
function jaccard(a, b) {
  // Empty on either side means no meaningful similarity.
  if (!a.size || !b.size) return 0
  // Count shared tokens.
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  // intersection / union.
  return inter / (a.size + b.size - inter)
}

// Score how well a candidate (cTitle/cAuthor) matches the query (qTitle/qAuthor).
export function scoreMatch(qTitle, qAuthor, cTitle, cAuthor) {
  // Title similarity (weighted most heavily).
  const tSim = jaccard(tokens(normalizeTitle, qTitle), tokens(normalizeTitle, cTitle))
  // Author similarity, or a neutral 0.5 when either side has no author.
  const aSim =
    qAuthor && cAuthor
      ? jaccard(tokens(normalizeAuthor, qAuthor), tokens(normalizeAuthor, cAuthor))
      : 0.5 // unknown author on either side — neutral, don't penalize
  // Weighted blend: title matters more than author.
  return 0.7 * tSim + 0.3 * aSim
}

// Bucket a numeric score into strong / uncertain / none.
function classify(score, tSim) {
  // Confident match: high overall score and a solid title overlap.
  if (score >= 0.75 && tSim >= 0.6) return 'strong'
  // Plausible but shaky — worth showing to the user.
  if (score >= 0.35) return 'uncertain'
  // Not a match.
  return 'none'
}

// --- field mapping ---------------------------------------------------------

// Sanitize a raw description: strip HTML, collapse whitespace, cap the length.
function cleanDescription(desc) {
  // Nothing in, nothing out.
  if (!desc) return null
  // Remove HTML tags and squeeze whitespace.
  const text = String(desc).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  // If it emptied out, treat as missing.
  if (!text) return null
  // Cap very long blurbs at ~700 chars with an ellipsis.
  return text.length > 700 ? text.slice(0, 697).trimEnd() + '…' : text
}

// Map a Google Books volumeInfo object to our candidate/fields shape.
function mapGoogle(v) {
  // Industry identifiers array (may be absent).
  const ids = v.industryIdentifiers || []
  // Prefer a 13-digit ISBN, else fall back to ISBN-10.
  const isbn = ids.find((x) => x.type === 'ISBN_13') || ids.find((x) => x.type === 'ISBN_10')
  // Thumbnail cover URL, if present.
  const thumb = v.imageLinks && v.imageLinks.thumbnail
  return {
    // Display title.
    title: v.title || '',
    // Authors joined into one string.
    author: (v.authors || []).join(', '),
    // Just the year from the publish date.
    year: (v.publishedDate || '').slice(0, 4) || null,
    // The fillable metadata fields:
    fields: {
      // Page count (only if it's a real positive number).
      length: typeof v.pageCount === 'number' && v.pageCount > 0 ? v.pageCount : null,
      // First category/genre.
      category: (v.categories && v.categories[0]) || null,
      // Cleaned description.
      description: cleanDescription(v.description),
      // Cover, upgraded to https so it isn't blocked as mixed content.
      cover: thumb ? thumb.replace(/^http:/, 'https:') : null,
      // ISBN identifier string.
      isbn: isbn ? isbn.identifier : null,
    },
  }
}

// Title-case a string ("science fiction" -> "Science Fiction").
function titleCase(s) {
  // Uppercase the first letter of each word, lowercase the rest.
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

// Map an Open Library search doc to our candidate/fields shape.
function mapOpenLibrary(d) {
  // first_sentence can be an array, an object {value}, or a plain string.
  const firstSentence = Array.isArray(d.first_sentence)
    ? d.first_sentence[0]
    : d.first_sentence && d.first_sentence.value
      ? d.first_sentence.value
      : typeof d.first_sentence === 'string'
        ? d.first_sentence
        : null
  return {
    // Display title.
    title: d.title || '',
    // Authors joined.
    author: (d.author_name || []).join(', '),
    // First publish year.
    year: d.first_publish_year || null,
    // The "/works/OL...W" key, used to fetch the full synopsis later.
    workKey: d.key || null,
    // Search index only has a first-sentence snippet (often non-English); keep it
    // as a last-resort fallback. The real description comes from the Works record.
    snippet: cleanDescription(firstSentence),
    fields: {
      // Median page count across editions.
      length: typeof d.number_of_pages_median === 'number' ? d.number_of_pages_median : null,
      // First subject, title-cased.
      category: d.subject && d.subject[0] ? titleCase(d.subject[0]) : null,
      // Left null on purpose — filled from the Works record on demand.
      description: null,
      // Cover image URL built from the cover id.
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
      // First ISBN.
      isbn: (d.isbn && d.isbn[0]) || null,
    },
  }
}

// The Open Library "Works" record has a real synopsis (usually English) rather
// than the search index's first-sentence snippet. Fetch it for a proper blurb.
async function fetchOpenLibraryWork(workKey, fetchImpl) {
  // GET the work JSON (e.g. https://openlibrary.org/works/OL27482W.json).
  const res = await fetchImpl(`https://openlibrary.org${workKey}.json`)
  // Bail on any non-OK response.
  if (!res.ok) return null
  // Parse the body.
  const j = await res.json()
  // description may be a string or an object {value}.
  let raw = typeof j.description === 'string' ? j.description : (j.description && j.description.value) || null
  // If we got a description...
  if (raw) {
    // Strip Open Library's trailing source footers / markdown link refs.
    raw = raw.split(/\n-{3,}|\n\[\d+\]:|\n?\(\[source\]/i)[0]
  }
  return {
    // Cleaned synopsis.
    description: cleanDescription(raw),
    // First subject as a fallback category.
    category: j.subjects && j.subjects[0] ? titleCase(j.subjects[0]) : null,
  }
}

// Build a scored result from a list of mapped candidates.
function buildResult(source, qTitle, qAuthor, mapped) {
  // No candidates: a "none" result.
  if (!mapped.length) return { source, match: 'none', score: 0, fields: {}, candidates: [] }
  // Score each candidate and remember its title similarity...
  const scored = mapped
    .map((c) => {
      // Title-only similarity (used by classify's threshold).
      const tSim = jaccard(tokens(normalizeTitle, qTitle), tokens(normalizeTitle, c.title))
      // Overall weighted score.
      const score = scoreMatch(qTitle, qAuthor, c.title, c.author)
      // Carry the scores alongside the candidate.
      return { ...c, score, tSim }
    })
    // ...then rank best-first.
    .sort((a, b) => b.score - a.score)

  // The top-ranked candidate.
  const best = scored[0]
  return {
    // Which source produced this.
    source,
    // strong / uncertain / none for the best match.
    match: classify(best.score, best.tSim),
    // The best match's score.
    score: best.score,
    // The best match's fillable fields.
    fields: best.fields,
    // Top 3 candidates for an "uncertain" chooser.
    candidates: scored.slice(0, 3).map((c) => ({
      title: c.title,
      author: c.author,
      year: c.year,
      // Google volume id (if from Google), for detail lookups.
      gid: c.gid || null,
      // Rounded score for display/debugging.
      score: Number(c.score.toFixed(2)),
      fields: c.fields,
    })),
  }
}

// --- API calls -------------------------------------------------------------

// Fetch and map Google Books search candidates. Returns null when unavailable.
async function googleCandidates(qTitle, qAuthor, fetchImpl) {
  // Build the "intitle:.. inauthor:.." query, dropping the author clause if none.
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
  // Perform the request.
  const res = await fetchImpl(url)
  // Non-OK (e.g. 429) -> signal "unavailable" so the caller can fall back.
  if (!res.ok) return null // 429 / 5xx -> signal "unavailable" so caller falls back
  // Parse the JSON.
  const json = await res.json()
  // Map each item, tagging it with its Google volume id.
  return (json.items || []).map((it) => ({ ...mapGoogle(it.volumeInfo || {}), gid: it.id }))
}

// Google's search results often omit description/categories; fetch the full
// volume by id to complete them. Returns the mapped volume, or null. Never throws.
async function fetchGoogleVolume(gid, fetchImpl) {
  // GET the single-volume detail endpoint (keyed if a key is set).
  const res = await fetchImpl(withKey(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(gid)}`))
  // Bail on failure.
  if (!res.ok) return null
  // Parse and map.
  const json = await res.json()
  return mapGoogle(json.volumeInfo || {})
}

// Fill any missing description/category on a chosen candidate, trying Google's
// detail endpoint, then the OL Works record, then a cross-source OL search.
export async function completeCandidate(candidate, { fetchImpl = fetch } = {}) {
  // Start from a copy of the candidate's fields.
  const f = { ...(candidate.fields || {}) }
  // Already complete: nothing to do.
  if (f.description && f.category) return candidate

  // 1) Google's search omits description/categories — fetch the full volume.
  if (candidate.gid && (!f.description || !f.category)) {
    try {
      // Detail lookup by Google volume id.
      const full = await fetchGoogleVolume(candidate.gid, fetchImpl)
      // Fill only the still-empty fields from the detail record.
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
      // Fetch the Works record via the candidate's own work key.
      const work = await fetchOpenLibraryWork(candidate.workKey, fetchImpl)
      if (work) {
        // Use the full synopsis, and its subject as a category fallback.
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
      // Run an OL search using the candidate's title/author.
      const ol = await openLibraryCandidates(
        titleForQuery(candidate.title),
        authorForQuery(candidate.author),
        fetchImpl
      )
      // Best OL result.
      const best = ol && ol[0]
      if (best) {
        // Fill still-empty scalar fields.
        f.category = f.category || best.fields.category
        f.length = f.length || best.fields.length
        f.cover = f.cover || best.fields.cover
        f.isbn = f.isbn || best.fields.isbn
        // Prefer that result's Works synopsis for the description.
        if (!f.description && best.workKey) {
          const work = await fetchOpenLibraryWork(best.workKey, fetchImpl)
          if (work && work.description) f.description = work.description
        }
        // Else fall back to the search snippet.
        if (!f.description) f.description = best.snippet || null
      }
    } catch {
      /* keep what we have */
    }
  }

  // Absolute last resort: this candidate's own snippet.
  if (!f.description) f.description = candidate.snippet || null

  // Return the candidate with completed fields.
  return { ...candidate, fields: f }
}

// Fetch and map Open Library search candidates. Returns null when unavailable.
async function openLibraryCandidates(qTitle, qAuthor, fetchImpl) {
  // Build the query params, requesting just the fields we map.
  const params = new URLSearchParams({
    title: qTitle,
    limit: '5',
    fields:
      'key,title,author_name,first_publish_year,number_of_pages_median,first_sentence,subject,cover_i,isbn',
  })
  // Add the author filter when we have one.
  if (qAuthor) params.set('author', qAuthor)
  // Assemble the URL.
  const url = `https://openlibrary.org/search.json?${params.toString()}`
  // Request.
  const res = await fetchImpl(url)
  // Bail on failure.
  if (!res.ok) return null
  // Parse and map the docs.
  const json = await res.json()
  return (json.docs || []).map(mapOpenLibrary)
}

// Google path -> scored result (or null when Google is unavailable).
async function tryGoogle(qTitle, qAuthor, fetchImpl) {
  const mapped = await googleCandidates(qTitle, qAuthor, fetchImpl)
  return mapped == null ? null : buildResult('google', qTitle, qAuthor, mapped)
}

// Open Library path -> scored result (or null when OL is unavailable).
async function tryOpenLibrary(qTitle, qAuthor, fetchImpl) {
  const mapped = await openLibraryCandidates(qTitle, qAuthor, fetchImpl)
  return mapped == null ? null : buildResult('openlibrary', qTitle, qAuthor, mapped)
}

// Return a ranked, de-duplicated candidate list for the user to pick from
// (title + author search across both sources). Each candidate carries display
// info (title, author, year) plus the mapped `fields` to fill on selection.
export async function searchCandidates({ title, author }, { fetchImpl = fetch, limit = 5 } = {}) {
  // Clean the inputs into query strings.
  const qTitle = titleForQuery(title)
  const qAuthor = authorForQuery(author)
  // No usable title: nothing to search.
  if (!qTitle) return []

  // Accumulate candidates from both sources.
  let all = []
  try {
    // Google first (best data when reachable).
    const g = await googleCandidates(qTitle, qAuthor, fetchImpl)
    if (g) all = all.concat(g)
  } catch {
    /* ignore, fall through to Open Library */
  }
  // If Google didn't fill the list, add Open Library results.
  if (all.length < limit) {
    try {
      const o = await openLibraryCandidates(qTitle, qAuthor, fetchImpl)
      if (o) all = all.concat(o)
    } catch {
      /* ignore */
    }
  }

  // Score every candidate against the query and rank best-first.
  const scored = all
    .map((c) => ({ ...c, score: scoreMatch(qTitle, qAuthor, c.title, c.author) }))
    .sort((a, b) => b.score - a.score)

  // De-duplicate by normalized title+author (both sources may return the book).
  const seen = new Set()
  const unique = []
  for (const c of scored) {
    // Dedupe key.
    const key = `${normalizeTitle(c.title)}|${normalizeAuthor(c.author)}`
    // Skip a book we've already added.
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  // Return the top `limit` unique candidates.
  return unique.slice(0, limit)
}

// Enrich one book. Returns { source, match, score, fields, candidates }.
// Never throws — network failure yields a 'none' result so the caller can move on.
export async function enrichBook({ title, author }, { fetchImpl = fetch } = {}) {
  // Build query strings.
  const qTitle = titleForQuery(title)
  const qAuthor = authorForQuery(author)
  // No title: immediate "none".
  if (!qTitle) return { source: null, match: 'none', score: 0, fields: {}, candidates: [] }

  // Try Google first.
  let result = null
  try {
    result = await tryGoogle(qTitle, qAuthor, fetchImpl)
  } catch {
    result = null
  }

  // If Google gave nothing usable, try Open Library and keep the better score.
  if (!result || result.match === 'none') {
    try {
      const ol = await tryOpenLibrary(qTitle, qAuthor, fetchImpl)
      if (ol && (!result || ol.score > result.score)) result = ol
    } catch {
      /* keep whatever we had */
    }
  }

  // Still nothing: a clean "none".
  if (!result) return { source: null, match: 'none', score: 0, fields: {}, candidates: [] }

  // Google's search omits description/categories — complete the chosen match so
  // bulk enrichment fills them too, not just page count.
  if (result.candidates && result.candidates[0]) {
    // Complete the top candidate, then use its filled fields.
    const completed = await completeCandidate(result.candidates[0], { fetchImpl })
    result = { ...result, fields: completed.fields }
  }

  // Return the finished result.
  return result
}

// Which enrichable fields to actually write to a book: skip user-edited fields,
// only fill blanks (never overwrite existing values).
export function pickEnrichPatch(book, fields) {
  // The patch object we'll apply to the book.
  const patch = {}
  // Consider each enrichable field.
  for (const f of ENRICHABLE) {
    // The candidate value.
    const v = fields[f]
    // Skip when the source has nothing for it.
    if (v == null || v === '') continue
    // Skip fields the user has hand-edited (protected).
    if (book.userEdited && book.userEdited.includes(f)) continue
    // Current stored value.
    const cur = book[f]
    // Is the current value empty (treat 0 pages as empty)?
    const empty = cur == null || cur === '' || (f === 'length' && !cur)
    // Only fill when currently empty.
    if (empty) patch[f] = v
  }
  // Return only the fields we decided to fill.
  return patch
}

// Re-export so consumers can import the enrichable-field list from here.
export { ENRICHABLE }
