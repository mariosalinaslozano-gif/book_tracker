// Single storage seam for the whole app. Everything reads/writes through here,
// so swapping localStorage for IndexedDB later means changing only this file.
// Persisted shape: { schemaVersion, books: [Book], enrichCache: { [matchKey]: {...} } }
import { makeMatchKey } from '../lib/normalize'

const STORAGE_KEY = 'reading-tracker-books'
const API_KEY_KEY = 'reading-tracker-gbooks-key'
const SCHEMA_VERSION = 1

export function loadApiKey() {
  try {
    return localStorage.getItem(API_KEY_KEY) || ''
  } catch {
    return ''
  }
}

export function saveApiKey(key) {
  try {
    if (key && key.trim()) localStorage.setItem(API_KEY_KEY, key.trim())
    else localStorage.removeItem(API_KEY_KEY)
  } catch {
    /* ignore */
  }
}

function makeId() {
  return crypto.randomUUID()
}

export function createId() {
  return makeId()
}

// Ensure a book has every field the current schema expects. Used both when
// migrating old data and when importing/creating books.
export function backfillBook(b = {}) {
  return {
    id: b.id ?? makeId(),
    title: b.title ?? '',
    author: b.author ?? '',
    category: b.category ?? '',
    description: b.description ?? '',
    length: b.length ?? 0,
    status: b.status ?? 'to-read',
    notes: b.notes ?? '',
    dateAdded: b.dateAdded ?? new Date().toISOString(),
    dateFinished: b.dateFinished ?? null,
    // fields added by the Kindle-import feature
    cover: b.cover ?? null,
    isbn: b.isbn ?? null,
    matchKey: b.matchKey ?? makeMatchKey(b.title ?? '', b.author ?? ''),
    source: b.source ?? 'manual',
    userEdited: Array.isArray(b.userEdited) ? b.userEdited : [],
    enrichedAt: b.enrichedAt ?? null,
    enrichStatus: b.enrichStatus ?? null,
    enrichCandidates: Array.isArray(b.enrichCandidates) ? b.enrichCandidates : null,
    highlights: Array.isArray(b.highlights) ? b.highlights : [],
    deletedHighlightIds: Array.isArray(b.deletedHighlightIds) ? b.deletedHighlightIds : [],
  }
}

function seedState() {
  const now = new Date()
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
  const books = [
    {
      title: 'Project Hail Mary',
      author: 'Andy Weir',
      category: 'Science Fiction',
      description:
        'A lone astronaut wakes up on a spaceship with no memory of how he got there, and must save humanity from an extinction-level threat.',
      length: 496,
      status: 'to-read',
      dateAdded: daysAgo(5),
    },
    {
      title: 'The Song of Achilles',
      author: 'Madeline Miller',
      category: 'Historical Fiction',
      description:
        'A retelling of the Iliad following the friendship and love between Achilles and Patroclus, from childhood through the Trojan War.',
      length: 416,
      status: 'to-read',
      dateAdded: daysAgo(2),
    },
    {
      title: 'Atomic Habits',
      author: 'James Clear',
      category: 'Self-Help',
      description:
        'A practical guide to building good habits and breaking bad ones through small, incremental changes backed by behavioral science.',
      length: 320,
      status: 'read',
      notes: 'Loved the idea of "habit stacking" — started pairing new habits with my morning coffee routine.',
      dateAdded: daysAgo(30),
      dateFinished: daysAgo(10),
    },
  ].map(backfillBook)
  return { schemaVersion: SCHEMA_VERSION, books, enrichCache: {} }
}

// Accepts any historical shape and returns the current one, or null if unusable.
function migrate(raw) {
  if (Array.isArray(raw)) {
    // v0: bare array of books
    return { schemaVersion: SCHEMA_VERSION, books: raw.map(backfillBook), enrichCache: {} }
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.books)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      books: raw.books.map(backfillBook),
      enrichCache: raw.enrichCache && typeof raw.enrichCache === 'object' ? raw.enrichCache : {},
    }
  }
  return null
}

export function loadState() {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY)
    if (!rawStr) {
      const s = seedState()
      saveState(s)
      return s
    }
    const migrated = migrate(JSON.parse(rawStr))
    if (!migrated) {
      const s = seedState()
      saveState(s)
      return s
    }
    return migrated
  } catch {
    const s = seedState()
    saveState(s)
    return s
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// Approximate bytes used by the persisted state (for the size indicator).
export function storageSize(state) {
  try {
    return new Blob([JSON.stringify(state)]).size
  } catch {
    return JSON.stringify(state).length
  }
}
