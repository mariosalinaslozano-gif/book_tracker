// Title/author normalization shared by the clippings parser (for dedupe match
// keys) and the enrichment module (for API queries + match scoring).

export function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// "Last, First" -> "First Last"; leaves already-natural names untouched.
export function authorToFirstLast(author) {
  if (!author) return ''
  const a = author.trim()
  if (a.includes(',')) {
    const [last, ...rest] = a.split(',')
    const first = rest.join(',').trim()
    if (first) return `${first} ${last.trim()}`.trim()
  }
  return a
}

// Aggressive normalization: lowercase, drop subtitle after ':', drop
// parentheticals, strip diacritics, collapse to single spaces.
export function normalizeTitle(title) {
  if (!title) return ''
  let t = title.toLowerCase()
  t = t.split(':')[0]
  t = t.replace(/\([^)]*\)/g, ' ')
  t = stripDiacritics(t)
  t = t.replace(/[^a-z0-9]+/g, ' ').trim()
  return t
}

export function normalizeAuthor(author) {
  if (!author) return ''
  let a = authorToFirstLast(author).toLowerCase()
  a = stripDiacritics(a)
  a = a.replace(/[^a-z0-9]+/g, ' ').trim()
  return a
}

// Stable key used to match a parsed book against the existing library.
export function makeMatchKey(title, author) {
  return `${normalizeTitle(title)}|${normalizeAuthor(author)}`
}
