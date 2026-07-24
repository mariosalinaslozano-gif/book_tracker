// Small deterministic string hash (FNV-1a, 32-bit) rendered as base36.
// Used for STABLE highlight IDs so re-importing the same clipping yields the
// same id — which is what makes import idempotent. Never use randomUUID here.
export function hashString(str) {
  // FNV-1a starts from a fixed 32-bit "offset basis" seed value.
  let h = 0x811c9dc5
  // Walk the input one character at a time.
  for (let i = 0; i < str.length; i++) {
    // XOR the running hash with this character's code point.
    h ^= str.charCodeAt(i)
    // Multiply by the FNV prime; Math.imul does a real 32-bit integer multiply.
    h = Math.imul(h, 0x01000193)
  }
  // Coerce to an unsigned 32-bit int (>>> 0), then base36 for a short id string.
  return (h >>> 0).toString(36)
}
