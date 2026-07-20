import { useState } from 'react'
import { useBooks } from '../context/BooksContext'
import BookCard from '../components/BookCard'
import BookDetail from '../components/BookDetail'
import BookForm from '../components/BookForm'
import Modal from '../components/Modal'
import FilterSidebar from '../components/FilterSidebar'

function ToReadPage() {
  const { books, addBook, markAsRead, updateNotes, deleteBook } = useBooks()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const toReadBooks = books.filter((b) => b.status === 'to-read')
  const categories = [...new Set(toReadBooks.map((b) => b.category).filter(Boolean))].sort()
  const query = search.trim().toLowerCase()
  const filtered = toReadBooks.filter(
    (b) =>
      (b.title.toLowerCase().includes(query) || b.category.toLowerCase().includes(query)) &&
      (!category || b.category === category)
  )
  const selectedBook = books.find((b) => b.id === selectedId)

  const handleDelete = (id) => {
    if (window.confirm('Delete this book? This cannot be undone.')) {
      deleteBook(id)
    }
  }

  return (
    <div className="page-layout">
      <FilterSidebar categories={categories} selected={category} onSelect={setCategory}>
        <button className="btn btn-primary btn-block" onClick={() => setShowAddForm(true)}>
          + Add Book
        </button>
      </FilterSidebar>

      <div className="page-main">
        <div className="page-header-row">
          <div>
            <p className="page-eyebrow">The Library</p>
            <h1 className="page-title">To Read</h1>
          </div>
          <p className="page-count">
            {toReadBooks.length} book{toReadBooks.length !== 1 ? 's' : ''} to read
          </p>
        </div>

        <input
          className="search-input"
          placeholder="Search by title or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {filtered.length === 0 ? (
          <p className="empty-state">
            {toReadBooks.length === 0 ? 'Your to-read list is empty. Add a book to get started!' : 'No books match your search.'}
          </p>
        ) : (
          <div className="book-list">
            {filtered.map((book, i) => (
              <BookCard
                key={book.id}
                book={book}
                index={i}
                onOpen={setSelectedId}
                onMarkRead={markAsRead}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {selectedBook && (
        <Modal onClose={() => setSelectedId(null)}>
          <BookDetail
            book={selectedBook}
            onMarkRead={markAsRead}
            onDelete={handleDelete}
            onSaveNotes={updateNotes}
          />
        </Modal>
      )}

      {showAddForm && (
        <Modal onClose={() => setShowAddForm(false)}>
          <BookForm onSubmit={addBook} onClose={() => setShowAddForm(false)} />
        </Modal>
      )}
    </div>
  )
}

export default ToReadPage
