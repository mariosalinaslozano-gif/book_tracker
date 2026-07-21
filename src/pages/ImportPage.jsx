import { useMemo, useRef, useState } from 'react'
import { useBooks } from '../context/BooksContext'
import { parseClippings } from '../lib/clippingsParser'
import ImportPreview from '../components/ImportPreview'
import EnrichPanel from '../components/EnrichPanel'
import BackupPanel from '../components/BackupPanel'
import ApiKeyPanel from '../components/ApiKeyPanel'

function ImportPage() {
  const { books, importParsed } = useBooks()
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [summary, setSummary] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const existingByKey = useMemo(() => new Map(books.map((b) => [b.matchKey, b])), [books])

  const handleFile = (file) => {
    if (!file) return
    setError('')
    setSummary(null)
    const reader = new FileReader()
    reader.onerror = () => setError('Could not read that file.')
    reader.onload = () => {
      try {
        const result = parseClippings(String(reader.result))
        if (result.books.length === 0) {
          setParsed(null)
          setError('No highlights found — is this a Kindle “My Clippings.txt” file?')
          return
        }
        setParsed(result)
        setFileName(file.name)
        setSelected(new Set(result.books.map((b) => b.matchKey)))
      } catch (e) {
        setParsed(null)
        setError('Failed to parse the file: ' + e.message)
      }
    }
    reader.readAsText(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const toggle = (key) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const toggleAll = () =>
    setSelected((s) =>
      s.size === parsed.books.length ? new Set() : new Set(parsed.books.map((b) => b.matchKey))
    )

  const doImport = () => {
    const res = importParsed(parsed, [...selected])
    setSummary(res)
    setParsed(null)
    setSelected(new Set())
    setFileName('')
  }

  const reset = () => {
    setParsed(null)
    setError('')
    setSummary(null)
    setFileName('')
  }

  return (
    <div className="page-main import-page">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">From your Kindle</p>
          <h1 className="page-title">Import Highlights</h1>
        </div>
      </div>

      {!parsed && (
        <>
          <div
            className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <p className="dropzone-title">Drop your <code>My Clippings.txt</code> here</p>
            <p className="dropzone-sub">or click to choose the file</p>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,text/plain"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          <ol className="import-how">
            <li>Plug your Kindle into this computer with a USB cable.</li>
            <li>Open the Kindle drive → <code>documents</code> folder.</li>
            <li>Drag <code>My Clippings.txt</code> into the box above.</li>
          </ol>
          <p className="import-note">
            Everything stays in your browser. Highlights made in the Kindle phone/tablet app won’t be in this
            file — only ones made on the Kindle device itself.
          </p>
        </>
      )}

      {error && <p className="import-error">{error}</p>}

      {summary && (
        <div className="import-summary">
          <p className="import-summary-title">Import complete</p>
          <p>
            {summary.booksAdded} new book{summary.booksAdded === 1 ? '' : 's'} · {summary.booksUpdated} updated ·{' '}
            {summary.highlightsAdded} highlight{summary.highlightsAdded === 1 ? '' : 's'} added
          </p>
          {summary.highlightsAdded === 0 && summary.booksAdded === 0 && (
            <p className="import-note">Nothing new — these highlights were already imported.</p>
          )}
        </div>
      )}

      {!parsed && <EnrichPanel />}
      {!parsed && <ApiKeyPanel />}
      {!parsed && <BackupPanel />}

      {parsed && (
        <>
          <p className="import-filename">Parsed <strong>{fileName}</strong></p>
          <ImportPreview
            books={parsed.books}
            existingByKey={existingByKey}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            stats={parsed.stats}
            skippedCount={parsed.skipped.length}
          />
          <div className="import-actions">
            <button className="btn btn-text" onClick={reset}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={doImport} disabled={selected.size === 0}>
              Import {selected.size} book{selected.size === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default ImportPage
