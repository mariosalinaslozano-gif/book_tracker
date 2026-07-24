// Shared policy for which books/fields still want metadata. Kept out of the
// React context file so that file only exports components/hooks (fast refresh).

// Fields whose absence should trigger a lookup (isbn is a bonus, not a trigger).
const ENRICH_TRIGGER = ['length', 'category', 'description', 'cover']

// A field counts as "empty" when it's null/undefined, an empty string, or —
// for length — zero (0 pages means "unknown", not a real value).
export function fieldEmpty(book, f) {
  // Read the field value off the book.
  const v = book[f]
  // Empty if null/undefined, '', or a falsy length (0).
  return v == null || v === '' || (f === 'length' && !v)
}

// A book needs enrichment if any trigger field is empty AND the user hasn't
// hand-edited that field (enrichment must never overwrite the user's own edits).
export function bookNeedsEnrichment(book) {
  // True when at least one trigger field is both empty and not user-protected.
  return ENRICH_TRIGGER.some((f) => fieldEmpty(book, f) && !(book.userEdited || []).includes(f))
}
