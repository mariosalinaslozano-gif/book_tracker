import { coverStyle } from '../utils/coverStyle'

function BookCard({ book, index, onOpen, onMarkRead, onDelete }) {
  const number = String(index + 1).padStart(3, '0')

  return (
    <article className="book-row" onClick={() => onOpen(book.id)}>
      <span className="book-index">N.{number}</span>
      <div className="book-cover" style={{ backgroundImage: coverStyle(book.title) }}>
        {book.title.charAt(0).toUpperCase()}
      </div>
      <div className="book-row-info">
        <p className="book-eyebrow">{book.category || 'Uncategorized'}</p>
        <h3 className="book-title">{book.title}</h3>
        <p className="book-author">{book.author}</p>
        <p className="book-meta-line">
          {book.length} pages
          <span className="book-status-word">
            {book.status === 'read' ? 'Read' : 'To Read'}
          </span>
        </p>
        <div className="book-row-actions">
          {book.status === 'to-read' && (
            <button
              className="btn btn-secondary btn-small"
              onClick={(e) => {
                e.stopPropagation()
                onMarkRead(book.id)
              }}
            >
              Mark as Read
            </button>
          )}
          <button
            className="btn btn-text btn-small"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(book.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}

export default BookCard
