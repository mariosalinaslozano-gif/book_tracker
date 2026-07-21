import { formatDate } from '../utils/date'

// kind: 'highlight' (a passage from the book, maybe with your note attached)
//       'note'      (a standalone note you typed, no highlighted passage)
function HighlightList({ items, kind = 'highlight', onDelete }) {
  if (!items || items.length === 0) return null

  return (
    <ul className="highlight-list">
      {items.map((h) => (
        <li key={h.id} className={`highlight-item highlight-item-${kind}`}>
          <div className="highlight-body">
            {kind === 'note' ? (
              <p className="note-text">{h.note}</p>
            ) : (
              <>
                {h.limited ? (
                  <p className="highlight-limited">
                    ⚠ Clipping limit reached — Amazon withheld this highlight’s text.
                  </p>
                ) : (
                  <blockquote className="highlight-text">{h.text}</blockquote>
                )}
                {h.note && (
                  <div className="attached-note">
                    <span className="attached-note-label">Your note</span>
                    <p>{h.note}</p>
                  </div>
                )}
              </>
            )}
            <p className="highlight-meta">
              {h.location ? `Location ${h.location}` : h.page != null ? `Page ${h.page}` : ''}
              {h.date ? ` · ${formatDate(h.date)}` : ''}
            </p>
          </div>
          <button
            className="btn btn-text btn-small highlight-delete"
            onClick={() => onDelete(h.id)}
            aria-label="Delete"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  )
}

export default HighlightList
