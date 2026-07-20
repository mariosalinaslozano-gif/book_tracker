const STORAGE_KEY = 'reading-tracker-books'

function makeId() {
  return crypto.randomUUID()
}

function seedBooks() {
  const now = new Date()
  const daysAgo = (n) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

  return [
    {
      id: makeId(),
      title: 'Project Hail Mary',
      author: 'Andy Weir',
      category: 'Science Fiction',
      description:
        'A lone astronaut wakes up on a spaceship with no memory of how he got there, and must save humanity from an extinction-level threat.',
      length: 496,
      status: 'to-read',
      notes: '',
      dateAdded: daysAgo(5),
      dateFinished: null,
    },
    {
      id: makeId(),
      title: 'The Song of Achilles',
      author: 'Madeline Miller',
      category: 'Historical Fiction',
      description:
        'A retelling of the Iliad following the friendship and love between Achilles and Patroclus, from childhood through the Trojan War.',
      length: 416,
      status: 'to-read',
      notes: '',
      dateAdded: daysAgo(2),
      dateFinished: null,
    },
    {
      id: makeId(),
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
  ]
}

export function loadBooks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seeded = seedBooks()
      saveBooks(seeded)
      return seeded
    }
    return JSON.parse(raw)
  } catch {
    const seeded = seedBooks()
    saveBooks(seeded)
    return seeded
  }
}

export function saveBooks(books) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books))
}

export function createId() {
  return makeId()
}
