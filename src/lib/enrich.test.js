import { describe, it, expect } from 'vitest'
import { enrichBook, pickEnrichPatch, scoreMatch, searchCandidates } from './enrich'

const ok = (data) => ({ ok: true, json: async () => data })
const fail = (status) => ({ ok: false, status, json: async () => ({}) })

const GOOGLE_PRAGMATIC = {
  items: [
    {
      volumeInfo: {
        title: 'The Pragmatic Programmer',
        authors: ['David Thomas', 'Andrew Hunt'],
        pageCount: 352,
        categories: ['Computers'],
        description: '<p>Classic</p> guide to software craftsmanship',
        imageLinks: { thumbnail: 'http://books.google.com/cover' },
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780135957059' }],
      },
    },
  ],
}

const OL_DUNE = {
  docs: [
    {
      title: 'Dune',
      author_name: ['Frank Herbert'],
      number_of_pages_median: 412,
      subject: ['science fiction'],
      cover_i: 11481354,
      isbn: ['9780441172719'],
    },
  ],
}

describe('enrichBook', () => {
  it('maps a strong Google Books match to our fields', async () => {
    const fetchImpl = async () => ok(GOOGLE_PRAGMATIC)
    const r = await enrichBook(
      { title: 'The Pragmatic Programmer', author: 'David Thomas' },
      { fetchImpl }
    )
    expect(r.source).toBe('google')
    expect(r.match).toBe('strong')
    expect(r.fields.length).toBe(352)
    expect(r.fields.category).toBe('Computers')
    expect(r.fields.description).toBe('Classic guide to software craftsmanship') // HTML stripped
    expect(r.fields.cover).toBe('https://books.google.com/cover') // https-ified
    expect(r.fields.isbn).toBe('9780135957059')
  })

  it('falls back to Open Library when Google returns no items', async () => {
    const fetchImpl = async (url) =>
      url.includes('googleapis') ? ok({ items: [] }) : ok(OL_DUNE)
    const r = await enrichBook({ title: 'Dune', author: 'Frank Herbert' }, { fetchImpl })
    expect(r.source).toBe('openlibrary')
    expect(r.fields.length).toBe(412)
    expect(r.fields.category).toBe('Science Fiction') // title-cased
    expect(r.fields.cover).toContain('covers.openlibrary.org')
  })

  it('falls back to Open Library when Google is rate-limited (429)', async () => {
    const fetchImpl = async (url) =>
      url.includes('googleapis') ? fail(429) : ok(OL_DUNE)
    const r = await enrichBook({ title: 'Dune', author: 'Frank Herbert' }, { fetchImpl })
    expect(r.source).toBe('openlibrary')
    expect(r.fields.length).toBe(412)
  })

  it('returns match "none" and does not throw when nothing is found', async () => {
    const fetchImpl = async () => ok({ items: [], docs: [] })
    const r = await enrichBook({ title: 'Zzxqq Nonexistent Book', author: '' }, { fetchImpl })
    expect(r.match).toBe('none')
    expect(r.fields).toEqual({})
  })

  it('does not throw when the network fails entirely', async () => {
    const fetchImpl = async () => {
      throw new Error('network down')
    }
    const r = await enrichBook({ title: 'Dune', author: 'Frank Herbert' }, { fetchImpl })
    expect(r.match).toBe('none')
  })
})

describe('searchCandidates', () => {
  it('ranks the best title+author match first and de-dupes', async () => {
    const fetchImpl = async (url) => (url.includes('googleapis') ? ok(GOOGLE_PRAGMATIC) : ok(OL_DUNE))
    const list = await searchCandidates(
      { title: 'The Pragmatic Programmer', author: 'David Thomas' },
      { fetchImpl }
    )
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].title).toBe('The Pragmatic Programmer')
    expect(list[0].fields.length).toBe(352)
    expect(list[0]).toHaveProperty('author')
  })

  it('returns [] for a blank title without calling the network', async () => {
    let called = false
    const fetchImpl = async () => {
      called = true
      return ok({})
    }
    const list = await searchCandidates({ title: '', author: '' }, { fetchImpl })
    expect(list).toEqual([])
    expect(called).toBe(false)
  })
})

describe('scoreMatch', () => {
  it('scores an exact title+author higher than a mismatch', () => {
    const good = scoreMatch('Dune', 'Frank Herbert', 'Dune', 'Frank Herbert')
    const bad = scoreMatch('Dune', 'Frank Herbert', 'War and Peace', 'Leo Tolstoy')
    expect(good).toBeGreaterThan(0.9)
    expect(bad).toBeLessThan(0.2)
  })
})

describe('pickEnrichPatch', () => {
  const fields = { length: 352, category: 'Computers', description: 'x', cover: 'c', isbn: '1' }

  it('fills only blank fields', () => {
    const book = { length: 0, category: '', description: 'my own words', cover: null, isbn: null, userEdited: [] }
    const patch = pickEnrichPatch(book, fields)
    expect(patch).toEqual({ length: 352, category: 'Computers', cover: 'c', isbn: '1' })
    expect(patch.description).toBeUndefined() // already had a value
  })

  it('never touches a user-edited field even if blank', () => {
    const book = { length: 0, category: '', description: '', cover: null, isbn: null, userEdited: ['category', 'length'] }
    const patch = pickEnrichPatch(book, fields)
    expect(patch.category).toBeUndefined()
    expect(patch.length).toBeUndefined()
    expect(patch.description).toBe('x')
  })
})
