const VARIANTS = [
  'linear-gradient(135deg, var(--color-accent), var(--color-accent-dark))',
  'linear-gradient(135deg, var(--color-secondary), var(--color-secondary-dark))',
  'linear-gradient(135deg, var(--color-text), #3a3f45)',
  'linear-gradient(135deg, var(--color-accent-dark), var(--color-secondary-dark))',
]

export function coverStyle(title) {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return VARIANTS[hash % VARIANTS.length]
}
