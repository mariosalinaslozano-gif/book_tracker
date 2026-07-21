// Shared policy for which books/fields still want metadata. Kept out of the
// React context file so that file only exports components/hooks (fast refresh).

// Fields whose absence should trigger a lookup (isbn is a bonus, not a trigger).
const ENRICH_TRIGGER = ['length', 'category', 'description', 'cover']

export function fieldEmpty(book, f) {
  const v = book[f]
  return v == null || v === '' || (f === 'length' && !v)
}

export function bookNeedsEnrichment(book) {
  return ENRICH_TRIGGER.some((f) => fieldEmpty(book, f) && !(book.userEdited || []).includes(f))
}
