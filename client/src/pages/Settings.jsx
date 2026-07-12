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
        <div className="settings-sidebar__footer">
          <div className="settings-sidebar__footer-title">NAS deploy (Tailscale)</div>
          <div className="settings-sidebar__footer-text">
            1. Check the app's port is free on the NAS first:
          </div>
          <div className="mono settings-sidebar__footer-code">sudo lsof -i :4000</div>
          <div className="settings-sidebar__footer-text">
            2. Terminate TLS with Tailscale Serve (proxies 443 → the app):
          </div>
          <div className="mono settings-sidebar__footer-code">
            tailscale serve --bg --https=443 http://localhost:4000
          </div>
          <div className="settings-sidebar__footer-text">
            3. Public URL (Yahoo Connection, above) and Yahoo's "Redirect URI(s)" field must both be exactly:
          </div>
          <div className="mono settings-sidebar__footer-code">
            https://&lt;device&gt;.&lt;tailnet&gt;.ts.net/api/yahoo/callback
          </div>
          <div className="settings-sidebar__footer-text">
            Port 4000 is only used internally by Tailscale Serve — nobody ever types it in a browser. Change it in
            docker-compose.yml if something else on the NAS already has it.
          </div>
        </div>
      </aside>
      <div className="settings-content">
        <ActiveComponent />
      </div>
    </div>
  );
}
