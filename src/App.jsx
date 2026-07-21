import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { BooksProvider } from './context/BooksContext'
import NavBar from './components/NavBar'
import ToReadPage from './pages/ToReadPage'
import ReadPage from './pages/ReadPage'
import ImportPage from './pages/ImportPage'

function App() {
  return (
    <BooksProvider>
      <BrowserRouter>
        <div className="app">
          <NavBar />
          <main className="app-main">
            <Routes>
              <Route path="/" element={<Navigate to="/to-read" replace />} />
              <Route path="/to-read" element={<ToReadPage />} />
              <Route path="/read" element={<ReadPage />} />
              <Route path="/import" element={<ImportPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </BooksProvider>
  )
}

export default App
