import { describe, it, expect } from 'vitest'
import { newHighlights, mergeHighlights, hasNoteRefresh } from './merge'

const hl = (id, text = '') => ({ id, text })
const hln = (id, note) => ({ id, text: 'passage', note })

describe('merge — idempotency & tombstones', () => {
  it('adds all highlights on a first import', () => {
    const incoming = [hl('a'), hl('b')]
    expect(mergeHighlights([], [], incoming)).toHaveLength(2)
  })

  it('adds zero duplicates on a second import of the same data', () => {
    const incoming = [hl('a'), hl('b')]
    const first = mergeHighlights([], [], incoming)
    const second = mergeHighlights(first, [], incoming)
    expect(second).toHaveLength(2)
    expect(newHighlights(first, [], incoming)).toHaveLength(0)
  })

  it('does not resurrect a deleted (tombstoned) highlight', () => {
    const incoming = [hl('a'), hl('b')]
    const existing = [hl('a')]
    const deleted = ['b']
    expect(newHighlights(existing, deleted, incoming)).toHaveLength(0)
    expect(mergeHighlights(existing, deleted, incoming)).toHaveLength(1)
  })

  it('still adds a brand-new highlight alongside tombstones', () => {
    const incoming = [hl('a'), hl('b'), hl('c')]
    const existing = [hl('a')]
    const deleted = ['b']
    expect(newHighlights(existing, deleted, incoming).map((h) => h.id)).toEqual(['c'])
  })
})

describe('merge — note refresh (repairs old data on re-import)', () => {
  it('updates the note on an existing highlight when re-import has a better note', () => {
    const existing = [hln('a', 'mangled draft draft draft')]
    const incoming = [hln('a', 'the clean final note')]
    const merged = mergeHighlights(existing, [], incoming)
    expect(merged).toHaveLength(1) // no new highlight added
    expect(merged[0].note).toBe('the clean final note')
    expect(hasNoteRefresh(existing, incoming)).toBe(true)
  })

  it('does not report a refresh when notes are unchanged', () => {
    const existing = [hln('a', 'same note')]
    const incoming = [hln('a', 'same note')]
    expect(hasNoteRefresh(existing, incoming)).toBe(false)
  })
})
