import { newHighlights } from '../lib/merge'

function ImportPreview({ books, existingByKey, selected, onToggle, onToggleAll, stats, skippedCount }) {
  const allSelected = books.length > 0 && books.every((b) => selected.has(b.matchKey))

  return (
    <div className="import-preview">
      <div className="import-preview-head">
        <label className="import-check-all">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
          Select all
        </label>
        <span className="import-stats">
          {stats.books} books · {stats.highlights} highlights · {stats.notes} notes
          {stats.bookmarks ? ` · ${stats.bookmarks} bookmarks skipped` : ''}
        </span>
      </div>

      {skippedCount > 0 && (
        <p className="import-skipped-note">
          ⚠ {skippedCount} {skippedCount === 1 ? 'entry' : 'entries'} could not be parsed and{' '}
          {skippedCount === 1 ? 'was' : 'were'} skipped.
        </p>
      )}

      <ul className="import-book-list">
        {books.map((b) => {
          const existing = existingByKey.get(b.matchKey)
          const nNew = existing
            ? newHighlights(existing.highlights, existing.deletedHighlightIds, b.highlights).length
            : b.highlights.length
          return (
            <li key={b.matchKey} className="import-book-row">
              <label className="import-book-label">
                <input
                  type="checkbox"
                  checked={selected.has(b.matchKey)}
                  onChange={() => onToggle(b.matchKey)}
                />
                <span className="import-book-main">
                  <span className="import-book-title">{b.title}</span>
                  <span className="import-book-author">{b.author || 'Unknown author'}</span>
                </span>
              </label>
              <span className={`import-book-flag ${existing ? 'is-existing' : 'is-new'}`}>
                {existing
                  ? `In library · ${nNew} new`
                  : `New · ${nNew} highlight${nNew === 1 ? '' : 's'}`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default ImportPreview
