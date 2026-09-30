import './NavRail.css';

// The rail shows one half of the year at a time. Draft mode is the draft-night
// kit; season mode swaps in the pages for trades and the waiver wire. The
// short labels repeat on purpose — WAR and PLYR mean "the room" and "the
// player list" in either mode, just over different data.
export const NAV_ITEMS = {
  draft: [
    { key: 'warroom', label: 'War Room', short: 'WAR', shape: 'square' },
    { key: 'results', label: 'Draft Results', short: 'RSLT', shape: 'triangle' },
    { key: 'players', label: 'Players', short: 'PLYR', shape: 'circle' },
    { key: 'settings', label: 'Settings', short: 'SET', shape: 'diamond' },
  ],
  season: [
    { key: 'season-war', label: 'Season War Room', short: 'WAR', shape: 'square' },
    { key: 'teams', label: 'Teams', short: 'TEAMS', shape: 'triangle' },
    { key: 'trades', label: 'Trade Finder', short: 'TRADE', shape: 'swap' },
    { key: 'season-players', label: 'Season Players', short: 'PLYR', shape: 'circle' },
    { key: 'settings', label: 'Settings', short: 'SET', shape: 'diamond' },
  ],
};

export default function NavRail({ items, activeTab, onChange }) {
  return (
    <nav className="nav-rail">
      <div className="nav-rail__logo">FH</div>
      {items.map((item) => {
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
