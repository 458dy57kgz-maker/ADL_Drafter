import './NavRail.css';

const NAV_ITEMS = [
  { key: 'warroom', label: 'War Room', shape: 'square' },
  { key: 'players', label: 'Players', shape: 'circle' },
  { key: 'settings', label: 'Settings', shape: 'diamond' },
];

export default function NavRail({ activeTab, onChange }) {
  return (
    <nav className="nav-rail">
      <div className="nav-rail__logo">FH</div>
      {NAV_ITEMS.map((item) => {
        const isActive = activeTab === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={`nav-rail__item${isActive ? ' nav-rail__item--active' : ''}`}
            onClick={() => onChange(item.key)}
          >
            <span className={`nav-rail__icon nav-rail__icon--${item.shape}`} />
            <span className="nav-rail__label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
