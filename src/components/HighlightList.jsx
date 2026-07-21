import { formatDate } from '../utils/date'

function HighlightList({ highlights, onDelete }) {
  if (!highlights || highlights.length === 0) return null

  return (
    <ul className="highlight-list">
      {highlights.map((h) => (
        <li key={h.id} className="highlight-item">
          <div className="highlight-body">
            {h.limited ? (
              <p className="highlight-limited">⚠ Clipping limit reached — Amazon withheld this highlight’s text.</p>
            ) : h.text ? (
              <blockquote className="highlight-text">{h.text}</blockquote>
            ) : (
              <p className="highlight-note-only">Note</p>
            )}
            {h.note && <p className="highlight-note">{h.note}</p>}
            <p className="highlight-meta">
              {h.location ? `Location ${h.location}` : h.page != null ? `Page ${h.page}` : ''}
              {h.date ? ` · ${formatDate(h.date)}` : ''}
            </p>
          </div>
          <button
            className="btn btn-text btn-small highlight-delete"
            onClick={() => onDelete(h.id)}
            aria-label="Delete highlight"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  )
}

export default HighlightList
