// Pure highlight-merge helpers. A highlight's id is a content hash, so the same
// clipping always yields the same id — the basis for idempotent re-import.

// Which incoming highlights are genuinely new: not already stored, and not
// previously deleted (tombstoned, so re-import doesn't resurrect them).
export function newHighlights(existing = [], deletedIds = [], incoming = []) {
  const have = new Set(existing.map((h) => h.id))
  const dead = new Set(deletedIds)
  return incoming.filter((h) => !have.has(h.id) && !dead.has(h.id))
}

// Existing highlights plus any genuinely-new incoming ones.
export function mergeHighlights(existing = [], deletedIds = [], incoming = []) {
  return existing.concat(newHighlights(existing, deletedIds, incoming))
}
