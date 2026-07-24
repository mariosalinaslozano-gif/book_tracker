// Pure highlight-merge helpers. A highlight's id is a content hash, so the same
// clipping always yields the same id — the basis for idempotent re-import.

// Which incoming highlights are genuinely new: not already stored, and not
// previously deleted (tombstoned, so re-import doesn't resurrect them).
export function newHighlights(existing = [], deletedIds = [], incoming = []) {
  // Ids we already have stored, as a Set for O(1) lookups.
  const have = new Set(existing.map((h) => h.id))
  // Ids the user deleted (tombstones), also as a Set.
  const dead = new Set(deletedIds)
  // Keep only incoming highlights that are neither already stored nor tombstoned.
  return incoming.filter((h) => !have.has(h.id) && !dead.has(h.id))
}

// Existing highlights plus any genuinely-new incoming ones. Also refreshes the
// note text on an already-stored highlight when the re-imported version has a
// different note — so fixing note parsing and re-importing repairs old data
// (a highlight's id is its passage, independent of the note).
export function mergeHighlights(existing = [], deletedIds = [], incoming = []) {
  // Index the incoming highlights by id for quick lookup.
  const incomingById = new Map(incoming.map((h) => [h.id, h]))
  // Copy existing highlights, swapping in a fresher note where one exists.
  const refreshed = existing.map((eh) => {
    // The incoming version of this same highlight (same passage/id), if any.
    const inc = incomingById.get(eh.id)
    // If it carries a different, non-empty note, adopt it; otherwise keep as-is.
    return inc && inc.note && inc.note !== eh.note ? { ...eh, note: inc.note } : eh
  })
  // Append the brand-new highlights after the (possibly note-refreshed) ones.
  return refreshed.concat(newHighlights(existing, deletedIds, incoming))
}

// True when re-importing would change note text on an already-stored highlight
// (used so the import summary can report "updated" even with no new highlights).
export function hasNoteRefresh(existing = [], incoming = []) {
  // Index incoming highlights by id.
  const incomingById = new Map(incoming.map((h) => [h.id, h]))
  // Any existing highlight whose incoming twin has a different, non-empty note?
  return existing.some((eh) => {
    // Look up the incoming counterpart by id.
    const inc = incomingById.get(eh.id)
    // Report a refresh when it exists and its note differs.
    return inc && inc.note && inc.note !== eh.note
  })
}
