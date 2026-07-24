// Title/author normalization shared by the clippings parser (for dedupe match
// keys) and the enrichment module (for API queries + match scoring).

// Remove accent marks so "García" and "Garcia" compare as equal.
export function stripDiacritics(s) {
  // NFD splits an accented letter into base letter + a separate combining mark,
  // then the regex deletes that combining-mark range (U+0300–U+036F).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// "Last, First" -> "First Last"; leaves already-natural names untouched.
export function authorToFirstLast(author) {
  // Guard against null/undefined/empty input.
  if (!author) return ''
  // Trim surrounding whitespace.
  const a = author.trim()
  // A comma signals the "Last, First" library-catalog format.
  if (a.includes(',')) {
    // Split off the last name; keep the rest (handles extra commas/suffixes).
    const [last, ...rest] = a.split(',')
    // Re-join and trim the remainder — that's the first (given) name.
    const first = rest.join(',').trim()
    // Only flip the order when there's actually a first-name part.
    if (first) return `${first} ${last.trim()}`.trim()
  }
  // No comma (or nothing after it): return the name unchanged.
  return a
}

// Aggressive normalization: lowercase, drop subtitle after ':', drop
// parentheticals, strip diacritics, collapse to single spaces.
export function normalizeTitle(title) {
  // Empty/undefined -> empty string.
  if (!title) return ''
  // Compare case-insensitively.
  let t = title.toLowerCase()
  // Drop any subtitle after a colon ("dune: messiah" -> "dune ").
  t = t.split(':')[0]
  // Remove parenthetical noise like "(z-library.sk)" or "(spanish edition)".
  t = t.replace(/\([^)]*\)/g, ' ')
  // Remove accents so diacritics don't split otherwise-equal titles.
  t = stripDiacritics(t)
  // Replace every run of non-alphanumerics with one space, then trim.
  t = t.replace(/[^a-z0-9]+/g, ' ').trim()
  // Return the cleaned key fragment.
  return t
}

export function normalizeAuthor(author) {
  // Empty/undefined -> empty string.
  if (!author) return ''
  // Normalize "Last, First" ordering first, then lowercase.
  let a = authorToFirstLast(author).toLowerCase()
  // Strip accents.
  a = stripDiacritics(a)
  // Collapse non-alphanumerics to single spaces and trim.
  a = a.replace(/[^a-z0-9]+/g, ' ').trim()
  // Return the cleaned author fragment.
  return a
}

// Stable key used to match a parsed book against the existing library.
export function makeMatchKey(title, author) {
  // Join normalized title and author with a pipe so two books match only when
  // BOTH parts agree (e.g. "dune|frank herbert").
  return `${normalizeTitle(title)}|${normalizeAuthor(author)}`
}
