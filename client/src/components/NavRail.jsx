import './NavRail.css';

const NAV_ITEMS = [
  { key: 'warroom', label: 'War Room', short: 'WAR', shape: 'square' },
  { key: 'results', label: 'Results', short: 'RSLT', shape: 'triangle' },
  { key: 'players', label: 'Players', short: 'PLYR', shape: 'circle' },
  { key: 'settings', label: 'Settings', short: 'SET', shape: 'diamond' },
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
            title={item.label}
            aria-label={item.label}
          >
            <span className={`nav-rail__icon nav-rail__icon--${item.shape}`} />
            <span className="nav-rail__label">{item.short}</span>
          </button>
        );
      })}
    </nav>
  );
}
