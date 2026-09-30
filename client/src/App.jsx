import { useEffect, useState } from 'react';
import NavRail, { NAV_ITEMS } from './components/NavRail.jsx';
import WarRoom from './pages/WarRoom.jsx';
import Results from './pages/Results.jsx';
import Players from './pages/Players.jsx';
import SeasonWarRoom from './pages/SeasonWarRoom.jsx';
import Teams from './pages/Teams.jsx';
import SeasonPlayers from './pages/SeasonPlayers.jsx';
import TradeFinder from './pages/TradeFinder.jsx';
import Settings from './pages/Settings.jsx';
import ManualDraftOverlay from './components/ManualDraftOverlay.jsx';
import { LivePickFeedProvider } from './lib/useLivePickFeed.jsx';
import { api } from './lib/api.js';
import './App.css';

export default function App() {
  // null until the stored mode has loaded, so the rail never flashes the
  // wrong half of the year on a reload.
  const [mode, setMode] = useState(null);
  const [tab, setTab] = useState(null);
  const [manualDraftOpen, setManualDraftOpen] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setMode(s.app?.mode === 'season' ? 'season' : 'draft'))
      .catch(() => setMode('draft'));
  }, []);

  // Each mode opens on its own War Room, and a tab the other mode owns is
  // never left showing after a switch. Settings is in both, so switching
  // from there stays there.
  useEffect(() => {
    if (!mode) return;
    const items = NAV_ITEMS[mode];
    setTab((current) => (items.some((i) => i.key === current) ? current : items[0].key));
  }, [mode]);

  async function handleModeChange(next) {
    setMode(next);
    await api.updateSettings('app', { mode: next });
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== 's' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      // Manual Draft Mode is draft-night kit; in season it would only record
      // picks into a draft that's over.
      if (mode !== 'draft') return;
      const el = document.activeElement;
      const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (isTyping) return; // let Shift+S type normally in any focused field, including the overlay's own search box
      e.preventDefault();
      setManualDraftOpen((prev) => !prev);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode]);

  if (!mode || !tab) return <div className="app-shell" />;

  return (
    // The live pick feed watches its file from up here rather than inside a
    // page, so switching tabs mid-draft never interrupts it.
    <LivePickFeedProvider>
      <div className="app-shell">
        <NavRail items={NAV_ITEMS[mode]} activeTab={tab} onChange={setTab} />
        <div className="app-shell__content">
          {tab === 'warroom' && <WarRoom />}
          {tab === 'results' && <Results />}
          {tab === 'players' && <Players />}
          {tab === 'season-war' && <SeasonWarRoom onNavigate={setTab} />}
          {tab === 'teams' && <Teams />}
          {tab === 'trades' && <TradeFinder onNavigate={setTab} />}
          {tab === 'season-players' && <SeasonPlayers />}
          {tab === 'settings' && <Settings mode={mode} onModeChange={handleModeChange} />}
        </div>
        {mode === 'draft' && (
          <ManualDraftOverlay open={manualDraftOpen} onClose={() => setManualDraftOpen(false)} />
        )}
      </div>
    </LivePickFeedProvider>
  );
}
