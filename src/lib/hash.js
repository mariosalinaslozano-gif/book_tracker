// Small deterministic string hash (FNV-1a, 32-bit) rendered as base36.
// Used for STABLE highlight IDs so re-importing the same clipping yields the
// same id — which is what makes import idempotent. Never use randomUUID here.
export function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
