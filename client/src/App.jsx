import { useEffect, useState } from 'react';
import NavRail from './components/NavRail.jsx';
import WarRoom from './pages/WarRoom.jsx';
import Players from './pages/Players.jsx';
import Settings from './pages/Settings.jsx';
import ManualDraftOverlay from './components/ManualDraftOverlay.jsx';
import './App.css';

export default function App() {
  const [tab, setTab] = useState('warroom');
  const [manualDraftOpen, setManualDraftOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key.toLowerCase() !== 's' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const isTyping = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (isTyping) return; // let Shift+S type normally in any focused field, including the overlay's own search box
      e.preventDefault();
      setManualDraftOpen((prev) => !prev);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <NavRail activeTab={tab} onChange={setTab} />
      <div className="app-shell__content">
        {tab === 'warroom' && <WarRoom />}
        {tab === 'players' && <Players />}
        {tab === 'settings' && <Settings />}
      </div>
      <ManualDraftOverlay open={manualDraftOpen} onClose={() => setManualDraftOpen(false)} />
    </div>
  );
}
