import { useState } from 'react'
import { useBooks } from '../context/BooksContext'
import { bookNeedsEnrichment } from '../lib/enrichPolicy'

function EnrichPanel() {
  const { books, enrichLibrary, applyEnrichCandidate } = useBooks()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)

  const pending = books.filter((b) => bookNeedsEnrichment(b) && !b.enrichedAt)
  const uncertain = books.filter(
    (b) => b.enrichStatus === 'uncertain' && b.enrichCandidates && b.enrichCandidates.length
  )

  if (pending.length === 0 && uncertain.length === 0) return null

  const run = async () => {
    setRunning(true)
    setProgress({ done: 0, total: pending.length, title: '' })
    await enrichLibrary({ onProgress: (done, total, title) => setProgress({ done, total, title }) })
    setRunning(false)
    setProgress(null)
  }

  return (
    <section className="enrich-panel">
      <div className="enrich-head">
        <div>
          <p className="page-eyebrow">Book details</p>
          <h3 className="enrich-title">Fill in missing metadata</h3>
        </div>
        {pending.length > 0 && (
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running
              ? 'Fetching…'
              : `Fetch details for ${pending.length} book${pending.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {running && progress && (
        <p className="enrich-progress">
          Looking up {progress.done}/{progress.total}
          {progress.title ? ` — ${progress.title}` : ''}…
        </p>
      )}

      {uncertain.length > 0 && (
        <div className="enrich-uncertain">
          <p className="enrich-uncertain-label">
            Not sure about {uncertain.length} book{uncertain.length === 1 ? '' : 's'} — pick the right match:
          </p>
          {uncertain.map((b) => (
            <div key={b.id} className="enrich-uncertain-row">
              <span className="enrich-uncertain-book">
                {b.title}
                {b.author ? ` · ${b.author}` : ''}
              </span>
              <div className="enrich-candidate-btns">
                {b.enrichCandidates.map((c, i) => (
                  <button
                    key={i}
                    className="btn btn-secondary btn-small"
                    onClick={() => applyEnrichCandidate(b.id, c)}
                  >
                    {c.title}
                    {c.author ? ` · ${c.author}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default EnrichPanel
