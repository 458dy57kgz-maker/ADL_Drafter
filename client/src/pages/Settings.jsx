import { useState } from 'react';
import YahooConnection from './settings/YahooConnection.jsx';
import League from './settings/League.jsx';
import Roster from './settings/Roster.jsx';
import RankingsImport from './settings/RankingsImport.jsx';
import DraftDayBehavior from './settings/DraftDayBehavior.jsx';
import AppHosting from './settings/AppHosting.jsx';
import DebugLog from './settings/DebugLog.jsx';
import './Settings.css';

const SECTIONS = [
  { key: 'yahoo', label: 'Yahoo Connection', Component: YahooConnection },
  { key: 'league', label: 'League', Component: League },
  { key: 'roster', label: 'Roster', Component: Roster },
  { key: 'rankings', label: 'Rankings Import', Component: RankingsImport },
  { key: 'draftday', label: 'Draft-Day Behavior', Component: DraftDayBehavior },
  { key: 'hosting', label: 'App / Hosting', Component: AppHosting },
  { key: 'debug', label: 'Debug Log', Component: DebugLog },
];

export default function Settings() {
  const [section, setSection] = useState('yahoo');
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const ActiveComponent = active.Component;

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__title">Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`settings-sidebar__item${s.key === section ? ' settings-sidebar__item--active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </aside>
      <div className="settings-content">
        <ActiveComponent />
      </div>
    </div>
  );
}
