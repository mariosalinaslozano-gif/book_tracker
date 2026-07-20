function FilterSidebar({ categories, selected, onSelect, children }) {
  return (
    <aside className="sidebar">
      {children}
      <div className="sidebar-section">
        <h4>Filter by category</h4>
        <div className="filter-chip-list">
          <button
            className={`filter-chip${selected === null ? ' filter-chip-active' : ''}`}
            onClick={() => onSelect(null)}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`filter-chip${selected === cat ? ' filter-chip-active' : ''}`}
              onClick={() => onSelect(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

export default FilterSidebar
