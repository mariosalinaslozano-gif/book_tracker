import { useRef, useState } from 'react'
import { useBooks } from '../context/BooksContext'
import { storageSize } from '../utils/storage'

const LIMIT_BYTES = 5 * 1024 * 1024 // localStorage is ~5 MB per origin

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function BackupPanel() {
  const { state, exportState, restoreState } = useBooks()
  const [message, setMessage] = useState('')
  const inputRef = useRef(null)

  const bytes = storageSize(state)
  const pct = Math.min(100, Math.round((bytes / LIMIT_BYTES) * 100))
  const near = pct >= 80

  const handleExport = () => {
    const blob = new Blob([exportState()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reading-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleRestore = (file) => {
    if (!file) return
    if (!window.confirm('Restore will replace your current library with the backup. Continue?')) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        restoreState(String(reader.result))
        setMessage('Library restored from backup.')
      } catch (e) {
        setMessage('Could not restore: ' + e.message)
      }
    }
    reader.readAsText(file)
  }

  return (
    <section className="backup-panel">
      <div>
        <p className="page-eyebrow">Data &amp; backup</p>
        <h3 className="enrich-title">Your library lives in this browser</h3>
      </div>

      <div className="storage-meter">
        <div className="storage-bar">
          <div className={`storage-fill${near ? ' storage-fill-warn' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="storage-label">
          {formatBytes(bytes)} used of ~5 MB ({pct}%)
          {near && ' — getting full; export a backup.'}
        </p>
      </div>

      <div className="backup-actions">
        <button className="btn btn-primary" onClick={handleExport}>
          Export backup (JSON)
        </button>
        <button className="btn btn-secondary" onClick={() => inputRef.current?.click()}>
          Restore from backup
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => handleRestore(e.target.files?.[0])}
        />
      </div>

      {message && <p className="backup-message">{message}</p>}
      <p className="import-note">
        Clearing your browser data will erase your library — export a backup first. Restoring replaces
        everything with the backup’s contents.
      </p>
    </section>
  )
}

export default BackupPanel
