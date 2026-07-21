// Pure highlight-merge helpers. A highlight's id is a content hash, so the same
// clipping always yields the same id — the basis for idempotent re-import.

// Which incoming highlights are genuinely new: not already stored, and not
// previously deleted (tombstoned, so re-import doesn't resurrect them).
export function newHighlights(existing = [], deletedIds = [], incoming = []) {
  const have = new Set(existing.map((h) => h.id))
  const dead = new Set(deletedIds)
  return incoming.filter((h) => !have.has(h.id) && !dead.has(h.id))
}

// Existing highlights plus any genuinely-new incoming ones. Also refreshes the
// note text on an already-stored highlight when the re-imported version has a
// different note — so fixing note parsing and re-importing repairs old data
// (a highlight's id is its passage, independent of the note).
export function mergeHighlights(existing = [], deletedIds = [], incoming = []) {
  const incomingById = new Map(incoming.map((h) => [h.id, h]))
  const refreshed = existing.map((eh) => {
    const inc = incomingById.get(eh.id)
    return inc && inc.note && inc.note !== eh.note ? { ...eh, note: inc.note } : eh
  })
  return refreshed.concat(newHighlights(existing, deletedIds, incoming))
}

// True when re-importing would change note text on an already-stored highlight.
export function hasNoteRefresh(existing = [], incoming = []) {
  const incomingById = new Map(incoming.map((h) => [h.id, h]))
  return existing.some((eh) => {
    const inc = incomingById.get(eh.id)
    return inc && inc.note && inc.note !== eh.note
  })
}
