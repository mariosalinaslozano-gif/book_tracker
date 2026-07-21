import { useEffect, useState } from 'react'
import { formatDate } from '../utils/date'
import { coverStyle } from '../utils/coverStyle'
import BookForm from './BookForm'
import HighlightList from './HighlightList'

// ISO string -> YYYY-MM-DD (local) for a <input type="date">.
function toInputDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// YYYY-MM-DD -> ISO at local noon (avoids timezone off-by-one).
function fromInputDate(value) {
  return value ? new Date(`${value}T12:00:00`).toISOString() : null
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function BookDetail({ book, onMarkRead, onDelete, onSaveNotes, onUpdateBook, onDeleteHighlight }) {
  const [notes, setNotes] = useState(book.notes || '')
  const [dirty, setDirty] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editingDate, setEditingDate] = useState(false)

  useEffect(() => {
    setNotes(book.notes || '')
    setDirty(false)
    setEditing(false)
    setEditingDate(false)
    // Reset only when switching books, not on every notes keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  const handleSave = () => {
    onSaveNotes(book.id, notes)
    setDirty(false)
  }

  if (editing) {
    return (
      <BookForm
        initial={book}
        heading="Edit Book"
        submitLabel="Save Changes"
        onSubmit={(data) => onUpdateBook(book.id, data)}
        onClose={() => setEditing(false)}
      />
    )
  }

  const allHighlights = book.highlights || []
  const passages = allHighlights.filter((h) => h.text || h.limited)
  const standaloneNotes = allHighlights.filter((h) => !h.text && !h.limited && h.note)

  return (
    <div className="book-detail">
      <div className="book-detail-top">
        {book.cover ? (
          <img className="book-cover book-cover-large book-cover-img" src={book.cover} alt="" />
        ) : (
          <div className="book-cover book-cover-large" style={{ backgroundImage: coverStyle(book.title) }}>
            {book.title.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="book-detail-heading">
          <p className="book-eyebrow">{book.category || 'Uncategorized'}</p>
          <h2>{book.title}</h2>
          <p className="book-detail-author">by {book.author}</p>
          <div className="book-detail-tags">
            <span className={`status-badge ${book.status === 'read' ? 'status-read' : 'status-to-read'}`}>
              {book.status === 'read' ? 'Read' : 'To Read'}
            </span>
            {book.category && <span className="book-tag">{book.category}</span>}
            {book.length > 0 && <span className="book-tag">{book.length} pages</span>}
          </div>
          <p className="book-meta-line">
            {book.status === 'read' ? (
              editingDate ? (
                <input
                  type="date"
                  className="date-edit-input"
                  autoFocus
                  defaultValue={toInputDate(book.dateFinished)}
                  onChange={(e) => {
                    onUpdateBook(book.id, { dateFinished: fromInputDate(e.target.value) })
                    setEditingDate(false)
                  }}
                  onBlur={() => setEditingDate(false)}
                />
              ) : (
                <>
                  Finished {formatDate(book.dateFinished)}
                  <button
                    className="icon-btn"
                    onClick={() => setEditingDate(true)}
                    aria-label="Edit date read"
                    title="Edit date read"
                  >
                    <PencilIcon />
                  </button>
                </>
              )
            ) : (
              `Added ${formatDate(book.dateAdded)}`
            )}
          </p>
        </div>
      </div>

      <div className="book-detail-section">
        <h4>Description</h4>
        <p className="book-detail-description">{book.description || 'No description added.'}</p>
      </div>

      <div className="book-detail-section">
        <h4>Notes</h4>
        <textarea
          className="notes-textarea"
          rows={6}
          value={notes}
          placeholder="Add your thoughts, quotes, or takeaways..."
          onChange={(e) => {
            setNotes(e.target.value)
            setDirty(true)
          }}
        />
        <div className="notes-actions">
          <button className="btn btn-primary btn-small" onClick={handleSave} disabled={!dirty}>
            Save Notes
          </button>
          {!dirty && <span className="save-hint">Saved</span>}
        </div>
      </div>

      {passages.length > 0 && (
        <div className="book-detail-section">
          <h4>Highlights · {passages.length}</h4>
          <HighlightList
            key={`hl-${book.id}`}
            items={passages}
            kind="highlight"
            pageSize={4}
            onDelete={(hlId) => onDeleteHighlight(book.id, hlId)}
          />
        </div>
      )}

      {standaloneNotes.length > 0 && (
        <div className="book-detail-section">
          <h4>Notes · {standaloneNotes.length}</h4>
          <HighlightList
            key={`note-${book.id}`}
            items={standaloneNotes}
            kind="note"
            pageSize={6}
            onDelete={(hlId) => onDeleteHighlight(book.id, hlId)}
          />
        </div>
      )}

      <div className="book-detail-footer">
        {book.status === 'to-read' && (
          <button className="btn btn-primary" onClick={() => onMarkRead(book.id)}>
            Mark as Read
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="btn btn-danger" onClick={() => onDelete(book.id)}>
          Delete Book
        </button>
      </div>
    </div>
  )
}

export default BookDetail
