import { useState } from 'react'
import { useBooks } from '../context/BooksContext'
import BookCard from '../components/BookCard'
import BookDetail from '../components/BookDetail'
import Modal from '../components/Modal'
import FilterSidebar from '../components/FilterSidebar'

function ReadPage() {
  const { books, markAsRead, updateNotes, updateBook, deleteBook, deleteHighlight } = useBooks()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  const readBooks = books.filter((b) => b.status === 'read')
  const categories = [...new Set(readBooks.map((b) => b.category).filter(Boolean))].sort()
  const query = search.trim().toLowerCase()
  const filtered = readBooks.filter(
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
      <FilterSidebar categories={categories} selected={category} onSelect={setCategory} />

      <div className="page-main">
        <div className="page-header-row">
          <div>
            <p className="page-eyebrow">The Library</p>
            <h1 className="page-title">Read</h1>
          </div>
          <p className="page-count">
            {readBooks.length} book{readBooks.length !== 1 ? 's' : ''} read
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
            {readBooks.length === 0 ? 'You haven\'t finished any books yet.' : 'No books match your search.'}
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
            onUpdateBook={updateBook}
            onDeleteHighlight={deleteHighlight}
          />
        </Modal>
      )}
    </div>
  )
}

export default ReadPage
