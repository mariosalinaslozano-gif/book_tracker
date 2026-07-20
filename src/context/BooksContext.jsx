import { createContext, useContext, useEffect, useState } from 'react'
import { loadBooks, saveBooks, createId } from '../utils/storage'

const BooksContext = createContext(null)

export function BooksProvider({ children }) {
  const [books, setBooks] = useState(() => loadBooks())

  useEffect(() => {
    saveBooks(books)
  }, [books])

  const addBook = (bookData) => {
    const newBook = {
      id: createId(),
      title: bookData.title,
      author: bookData.author,
      category: bookData.category,
      description: bookData.description,
      length: bookData.length,
      status: 'to-read',
      notes: '',
      dateAdded: new Date().toISOString(),
      dateFinished: null,
    }
    setBooks((prev) => [...prev, newBook])
  }

  const markAsRead = (id) => {
    setBooks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, status: 'read', dateFinished: new Date().toISOString() } : b
      )
    )
  }

  const updateNotes = (id, notes) => {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)))
  }

  const deleteBook = (id) => {
    setBooks((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <BooksContext.Provider value={{ books, addBook, markAsRead, updateNotes, deleteBook }}>
      {children}
    </BooksContext.Provider>
  )
}

export function useBooks() {
  const ctx = useContext(BooksContext)
  if (!ctx) throw new Error('useBooks must be used within a BooksProvider')
  return ctx
}
