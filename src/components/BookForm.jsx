import { useState } from 'react'

function BookForm({ initial, heading = 'Add a Book', submitLabel = 'Add Book', onSubmit, onClose }) {
  const [form, setForm] = useState(() => ({
    title: initial?.title ?? '',
    author: initial?.author ?? '',
    category: initial?.category ?? '',
    description: initial?.description ?? '',
    length: initial?.length ? String(initial.length) : '',
  }))

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
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
