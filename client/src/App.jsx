import { useState } from 'react';
import NavRail from './components/NavRail.jsx';
import WarRoom from './pages/WarRoom.jsx';
import Players from './pages/Players.jsx';
import Settings from './pages/Settings.jsx';
import './App.css';

export default function App() {
  const [tab, setTab] = useState('warroom');

  return (
    <div className="app-shell">
      <NavRail activeTab={tab} onChange={setTab} />
      <div className="app-shell__content">
        {tab === 'warroom' && <WarRoom />}
        {tab === 'players' && <Players />}
        {tab === 'settings' && <Settings />}
      </div>
    </div>
  );
}
