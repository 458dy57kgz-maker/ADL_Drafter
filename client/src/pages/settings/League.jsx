import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function League() {
  const [league, setLeague] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setLeague(s.league));
  }, []);

  async function handleRefreshSeason() {
    const s = await api.updateSettings('league', { refreshSeason: true });
    setLeague(s.league);
  }

  async function handleStartNewSeason() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await api.startNewSeason({});
    setConfirming(false);
    const s = await api.getSettings();
    setLeague(s.league);
  }

  if (!league) return null;

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        League
      </div>
      <div className="card stack-gap">
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          League ID: <span className="mono" style={{ color: 'var(--text-primary)' }}>{league.leagueId}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          Season: <span className="mono" style={{ color: 'var(--text-primary)' }}>{league.season}</span>
          <button type="button" className="btn btn-sm" onClick={handleRefreshSeason}>
            Refresh
          </button>
        </div>
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          Team count: <span className="mono" style={{ color: 'var(--text-primary)' }}>{league.teamCount}</span>
        </div>
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          My team:{' '}
          <select className="field-select" style={{ width: 'auto' }} value={league.myTeamId} onChange={() => {}}>
            {(league.teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" style={{ marginTop: 6 }} onClick={handleStartNewSeason}>
          {confirming ? 'Click again to confirm — this archives the current draft' : 'Start New Season — re-pull & archive last draft'}
        </button>
      </div>
    </div>
  );
}
