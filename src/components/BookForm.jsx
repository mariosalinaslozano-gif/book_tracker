import { useState } from 'react'
import { searchCandidates, completeCandidate } from '../lib/enrich'

function BookForm({ initial, heading = 'Add a Book', submitLabel = 'Add Book', onSubmit, onClose }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title ?? '',
    author: initial?.author ?? '',
    category: initial?.category ?? '',
    description: initial?.description ?? '',
    length: initial?.length ? String(initial.length) : '',
    cover: initial?.cover ?? null,
  }))
  const [autofill, setAutofill] = useState({ status: 'idle', candidates: [], error: '' })

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const runAutofill = async () => {
    if (!form.title.trim()) return
    setAutofill({ status: 'loading', candidates: [], error: '' })
    try {
      const list = await searchCandidates({ title: form.title, author: form.author })
      setAutofill({
        status: list.length ? 'done' : 'empty',
        candidates: list,
        error: '',
      })
    } catch (e) {
      setAutofill({ status: 'error', candidates: [], error: e.message })
    }
  }

  const pick = async (c) => {
    setAutofill((a) => ({ ...a, status: 'resolving' }))
    // Google search omits description/category — fetch the full volume on pick.
    const full = await completeCandidate(c)
    setForm((f) => ({
      ...f,
      category: full.fields.category || f.category,
      description: full.fields.description || f.description,
      length: full.fields.length ? String(full.fields.length) : f.length,
      cover: full.fields.cover || f.cover,
    }))
    setAutofill({ status: 'idle', candidates: [], error: '' })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.title.trim() || !form.author.trim()) return
    onSubmit({ ...form, length: Number(form.length) || 0 })
    onClose()
  }

  return (
    <form className="book-form" onSubmit={handleSubmit}>
      <h2>{heading}</h2>

      <label className="form-field">
        Title
        <input name="title" value={form.title} onChange={handleChange} required />
      </label>

      <label className="form-field">
        Author
        <input name="author" value={form.author} onChange={handleChange} required />
      </label>

      <div className="autofill">
        <button
          type="button"
          className="btn btn-secondary btn-small"
          onClick={runAutofill}
          disabled={!form.title.trim() || autofill.status === 'loading' || autofill.status === 'resolving'}
        >
          {autofill.status === 'loading' ? 'Searching…' : '✦ Auto-fill from the web'}
        </button>

        {autofill.status === 'empty' && (
          <p className="autofill-status">No matches found — enter the details manually.</p>
        )}
        {autofill.status === 'error' && (
          <p className="autofill-status autofill-error">Search failed: {autofill.error}</p>
        )}

        {(autofill.status === 'done' || autofill.status === 'resolving') && (
          <>
            <p className="autofill-status">
              {autofill.status === 'resolving'
                ? 'Getting full details…'
                : 'Pick the correct edition — it fills the fields below.'}
            </p>
            <ul className="candidate-list">
              {autofill.candidates.map((c, i) => (
                <li key={i}>
                  <button type="button" className="candidate" onClick={() => pick(c)}>
                    {c.fields.cover ? (
                      <img className="candidate-cover" src={c.fields.cover} alt="" loading="lazy" />
                    ) : (
                      <span className="candidate-cover candidate-cover-blank" />
                    )}
                    <span className="candidate-info">
                      <span className="candidate-title">{c.title}</span>
                      <span className="candidate-sub">
                        {c.author || 'Unknown author'}
                        {c.year ? ` · ${c.year}` : ''}
                        {c.fields.length ? ` · ${c.fields.length} pages` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <label className="form-field">
        Category
        <input name="category" value={form.category} onChange={handleChange} placeholder="e.g. Fantasy" />
      </label>

      <label className="form-field">
        Length (pages)
        <input type="number" name="length" min="0" value={form.length} onChange={handleChange} />
      </label>

      <label className="form-field">
        Description
        <textarea name="description" rows={4} value={form.description} onChange={handleChange} />
      </label>

      <div className="form-actions">
        <button type="button" className="btn btn-text" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export default BookForm
