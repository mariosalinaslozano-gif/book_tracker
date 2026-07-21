import { useEffect, useState } from 'react'
import { formatDate } from '../utils/date'

// kind: 'highlight' (a passage from the book, maybe with your note attached)
//       'note'      (a standalone note you typed, no highlighted passage)
// Paginated: shows one page of items at a time with Prev/Next, so long lists
// don't require scrolling.
function HighlightList({ items, kind = 'highlight', onDelete, pageSize = 5 }) {
  const [page, setPage] = useState(0)
  const total = items?.length || 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Keep the page in range when the list shrinks (e.g. after a delete).
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  if (!items || total === 0) return null

  const start = page * pageSize
  const visible = items.slice(start, start + pageSize)

  return (
    <div className="paged-list">
      <ul className="highlight-list">
        {visible.map((h) => (
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

      {pageCount > 1 && (
        <div className="pager">
          <button
            className="btn btn-text btn-small"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Previous
          </button>
          <span className="pager-status">
            {start + 1}–{Math.min(start + pageSize, total)} of {total}
          </span>
          <button
            className="btn btn-text btn-small"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

export default HighlightList
