import { NavLink } from 'react-router-dom'

function NavBar() {
  const linkClass = ({ isActive }) => `nav-tab${isActive ? ' nav-tab-active' : ''}`

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="app-brand">
          <span className="app-brand-name">My Reading Tracker</span>
          <span className="app-brand-tagline">A private library, kept with pleasure</span>
        </div>
        <nav className="nav-bar">
          <NavLink to="/to-read" className={linkClass}>
            To Read
          </NavLink>
          <NavLink to="/read" className={linkClass}>
            Read
          </NavLink>
          <NavLink to="/import" className={linkClass}>
            Import
          </NavLink>
        </nav>
      </div>
    </header>
  )
}

export default NavBar
