import { useState } from 'react'
import { loadApiKey, saveApiKey } from '../utils/storage'
import { setGoogleApiKey } from '../lib/enrich'

function ApiKeyPanel() {
  const [key, setKey] = useState(() => loadApiKey())
  const [saved, setSaved] = useState(false)
  const [test, setTest] = useState(null) // { status, message }

  const save = () => {
    saveApiKey(key)
    setGoogleApiKey(key)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const runTest = async () => {
    setTest({ status: 'loading' })
    const k = key.trim()
    try {
      const url =
        `https://www.googleapis.com/books/v1/volumes?q=intitle:dune&maxResults=1` +
        (k ? `&key=${encodeURIComponent(k)}` : '')
      const res = await fetch(url)
      if (res.ok) {
        setTest({ status: 'ok', message: k ? '✓ Key works — Google Books responded.' : '✓ Google responded (keyless).' })
      } else if (res.status === 429) {
        setTest({
          status: 'warn',
          message: k
            ? 'Still rate-limited (429) — double-check the key and that Books API is enabled.'
            : 'Rate-limited (429) — this is exactly what a key fixes.',
        })
      } else {
        setTest({ status: 'err', message: `Google returned ${res.status}. Check the key.` })
      }
    } catch (e) {
      setTest({ status: 'err', message: e.message })
    }
  }

  return (
    <section className="apikey-panel">
      <div>
        <p className="page-eyebrow">Google Books API key</p>
        <h3 className="enrich-title">Better auto-fill coverage (optional)</h3>
      </div>
      <p className="import-note">
        Keyless auto-fill works but Google rate-limits it, and Open Library alone misses many books. A
        free key gives full descriptions and categories for far more titles. It’s stored only in this
        browser and used only for Google Books lookups.
      </p>
      <div className="apikey-row">
        <input
          className="apikey-input"
          type="text"
          placeholder="Paste your Google Books API key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn btn-primary" onClick={save} disabled={!key.trim()}>
          Save
        </button>
        <button className="btn btn-secondary" onClick={runTest}>
          Test
        </button>
      </div>
      {saved && <p className="backup-message">Saved — auto-fill will use it now.</p>}
      {test && test.status === 'loading' && <p className="import-note">Testing…</p>}
      {test && test.status !== 'loading' && (
        <p className={`apikey-test apikey-${test.status}`}>{test.message}</p>
      )}
    </section>
  )
}

export default ApiKeyPanel
