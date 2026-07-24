// Single storage seam for the whole app. Everything reads/writes through here,
// so swapping localStorage for IndexedDB later means changing only this file.
// Persisted shape: { schemaVersion, books: [Book], enrichCache: { [matchKey]: {...} } }
// makeMatchKey is used to backfill a book's dedupe key when migrating old data.
import { makeMatchKey } from '../lib/normalize'

// localStorage key holding the whole library state.
const STORAGE_KEY = 'reading-tracker-books'
// Separate localStorage key holding the optional Google Books API key.
const API_KEY_KEY = 'reading-tracker-gbooks-key'
// Current persisted-data version (bump when the shape changes; migrate() handles old data).
const SCHEMA_VERSION = 1

// Read the saved Google Books API key (empty string if none / unavailable).
export function loadApiKey() {
  try {
    // Return the stored key, or '' when absent.
    return localStorage.getItem(API_KEY_KEY) || ''
  } catch {
    // localStorage can throw (private mode, disabled) — treat as no key.
    return ''
  }
}

// Persist (or clear) the Google Books API key.
export function saveApiKey(key) {
  try {
    // A non-blank key is stored trimmed...
    if (key && key.trim()) localStorage.setItem(API_KEY_KEY, key.trim())
    // ...otherwise the key is removed entirely.
    else localStorage.removeItem(API_KEY_KEY)
  } catch {
    /* ignore */
  }
}

// Generate a random unique id (used for book records).
function makeId() {
  return crypto.randomUUID()
}

// Public wrapper so other modules don't reach for crypto directly.
export function createId() {
  return makeId()
}

// Ensure a book has every field the current schema expects. Used both when
// migrating old data and when importing/creating books. `??` fills only the
// truly-missing fields, leaving existing values intact.
export function backfillBook(b = {}) {
  return {
    // Stable id (generate one if absent).
    id: b.id ?? makeId(),
    // Core bibliographic fields.
    title: b.title ?? '',
    author: b.author ?? '',
    category: b.category ?? '',
    description: b.description ?? '',
    // 0 pages means "unknown".
    length: b.length ?? 0,
    // Reading status.
    status: b.status ?? 'to-read',
    // The user's free-text notes.
    notes: b.notes ?? '',
    // Timestamps.
    dateAdded: b.dateAdded ?? new Date().toISOString(),
    dateFinished: b.dateFinished ?? null,
    // fields added by the Kindle-import feature
    // Cover image URL.
    cover: b.cover ?? null,
    // ISBN (aids matching).
    isbn: b.isbn ?? null,
    // Normalized dedupe key — recompute from title/author if missing.
    matchKey: b.matchKey ?? makeMatchKey(b.title ?? '', b.author ?? ''),
    // Where the book came from: 'manual' or 'kindle'.
    source: b.source ?? 'manual',
    // Field names the user hand-edited (protected from enrichment).
    userEdited: Array.isArray(b.userEdited) ? b.userEdited : [],
    // When enrichment last ran for this book.
    enrichedAt: b.enrichedAt ?? null,
    // Last enrichment outcome: strong / uncertain / none.
    enrichStatus: b.enrichStatus ?? null,
    // Candidate matches to pick from when enrichment was uncertain.
    enrichCandidates: Array.isArray(b.enrichCandidates) ? b.enrichCandidates : null,
    // Imported Kindle highlights/notes.
    highlights: Array.isArray(b.highlights) ? b.highlights : [],
    // Tombstones: ids of highlights the user deleted (so re-import won't re-add).
    deletedHighlightIds: Array.isArray(b.deletedHighlightIds) ? b.deletedHighlightIds : [],
  }
}

// Build the initial library shown on a brand-new install.
function seedState() {
  // "now", and a helper to make an ISO date N days ago.
  const now = new Date()
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()
  // Three sample books (partial records)...
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
    // ...each run through backfillBook to get the full field set.
  ].map(backfillBook)
  // Wrap the books in the versioned state shape with an empty enrich cache.
  return { schemaVersion: SCHEMA_VERSION, books, enrichCache: {} }
}

// Accepts any historical shape and returns the current one, or null if unusable.
function migrate(raw) {
  // v0: the data was just a bare array of books.
  if (Array.isArray(raw)) {
    // v0: bare array of books
    // Backfill each book and wrap in the current shape.
    return { schemaVersion: SCHEMA_VERSION, books: raw.map(backfillBook), enrichCache: {} }
  }
  // v1+: already the wrapped { books, enrichCache } shape.
  if (raw && typeof raw === 'object' && Array.isArray(raw.books)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      // Backfill in case older books lack newer fields.
      books: raw.books.map(backfillBook),
      // Keep the cache if it's a valid object, else start fresh.
      enrichCache: raw.enrichCache && typeof raw.enrichCache === 'object' ? raw.enrichCache : {},
    }
  }
  // Unrecognized shape.
  return null
}

// Load the library state, seeding + saving a fresh one when needed.
export function loadState() {
  try {
    // Read the raw JSON string.
    const rawStr = localStorage.getItem(STORAGE_KEY)
    // Nothing stored yet: seed, persist, and return.
    if (!rawStr) {
      const s = seedState()
      saveState(s)
      return s
    }
    // Parse and migrate whatever was stored.
    const migrated = migrate(JSON.parse(rawStr))
    // Unusable shape: fall back to a fresh seed.
    if (!migrated) {
      const s = seedState()
      saveState(s)
      return s
    }
    // Good data: return it.
    return migrated
  } catch {
    // Corrupt JSON / storage error: seed a clean state.
    const s = seedState()
    saveState(s)
    return s
  }
}

// Persist the whole state back to localStorage.
export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// Approximate bytes used by the persisted state (for the size indicator).
export function storageSize(state) {
  try {
    // Blob gives an accurate UTF-8 byte count.
    return new Blob([JSON.stringify(state)]).size
  } catch {
    // Fallback: character count if Blob isn't available.
    return JSON.stringify(state).length
  }
}
