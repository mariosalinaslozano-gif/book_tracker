import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseClippings } from './clippingsParser'

const read = (name) =>
  readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8')

describe('parseClippings — basic fixture', () => {
  const r = parseClippings(read('my-clippings-basic.txt'))
  const byTitle = (t) => r.books.find((b) => b.title === t)

  it('counts entry types correctly', () => {
    expect(r.stats.books).toBe(2)
    expect(r.stats.highlights).toBe(2)
    expect(r.stats.notes).toBe(1)
    expect(r.stats.bookmarks).toBe(1)
    expect(r.stats.skipped).toBe(0)
  })

  it('drops bookmarks (no text) rather than importing them', () => {
    const prag = byTitle('The Pragmatic Programmer')
    // 1 highlight only — the bookmark is not a highlight
    expect(prag.highlights).toHaveLength(1)
  })

  it('attaches a note to its highlight by location', () => {
    const prag = byTitle('The Pragmatic Programmer')
    expect(prag.highlights[0].note).toBeTruthy()
    expect(prag.highlights[0].text).toMatch(/Care about your craft/)
  })

  it('parses a non-English (Spanish) highlight', () => {
    const cien = byTitle('Cien anos de soledad')
    expect(cien).toBeTruthy()
    expect(cien.author).toMatch(/Marquez/)
    expect(cien.highlights).toHaveLength(1)
  })

  it('gives every highlight a stable, non-empty id', () => {
    const ids = r.books.flatMap((b) => b.highlights.map((h) => h.id))
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('parseClippings — Kindle note typing-drafts', () => {
  const r = parseClippings(read('my-clippings-notes.txt'))
  const book = r.books[0]

  it('collapses same-location note drafts to the final note only', () => {
    // one highlight, note is the LAST draft — not the concatenation of all drafts
    expect(book.highlights).toHaveLength(1)
    const note = book.highlights[0].note
    expect(note).toBe('como lo que dice en el libro del monje, tener proposito | metas')
    expect(note).not.toMatch(/como lo q\b.*como lo que dice/s) // no accumulated drafts
  })
})

describe('parseClippings — edge fixture', () => {
  const r = parseClippings(read('my-clippings-edge.txt'))
  const byTitle = (t) => r.books.find((b) => b.title === t)

  it('sends the malformed entry to skipped instead of throwing', () => {
    expect(r.stats.skipped).toBe(1)
    expect(r.skipped[0].reason).toBeTruthy()
  })

  it('handles old "Loc. 1406-7" format with no page', () => {
    const old = byTitle('Old Firmware Book')
    expect(old.highlights[0].location).toBe('1406-7')
    expect(old.highlights[0].page).toBeNull()
  })

  it('takes the last parenthesized group as author (title keeps its parens)', () => {
    const fel = byTitle('The Fellowship of the Ring (Illustrated Edition)')
    expect(fel).toBeTruthy()
    expect(fel.author).toBe('J.R.R. Tolkien')
  })

  it('allows a book with no author', () => {
    const solo = byTitle('A Standalone Title With No Author')
    expect(solo.author).toBeNull()
  })

  it('preserves a multi-line highlight body', () => {
    const ml = byTitle('Multi Line Book')
    expect(ml.highlights[0].text).toContain('\n')
  })

  it('flags a clipping-limit placeholder', () => {
    const drm = byTitle('DRM Locked Book')
    expect(drm.highlights[0].limited).toBe(true)
  })

  it('dedupes an extended/overlapping highlight, keeping the longer text', () => {
    const ded = byTitle('Dedupe Book')
    expect(ded.highlights).toHaveLength(1)
    expect(ded.highlights[0].text).toMatch(/near the river/)
    expect(r.stats.duplicates).toBe(1)
  })
})
