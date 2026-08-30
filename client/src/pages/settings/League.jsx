import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function League() {
  const [league, setLeague] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leagueIdInput, setLeagueIdInput] = useState('');
  const [seasonInput, setSeasonInput] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setLeague(s.league);
      setLeagueIdInput(s.league.leagueId);
      setSeasonInput(s.league.season);
    });
  }, []);

  async function handleRefreshSeason() {
    const s = await api.updateSettings('league', { refreshSeason: true });
    setLeague(s.league);
  }

  async function handleSaveInfo() {
    setSavingInfo(true);
    try {
      const s = await api.updateSettings('league', { leagueId: leagueIdInput.trim(), season: seasonInput.trim() });
      setLeague(s.league);
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleStartNewSeason() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const { league: updated } = await api.startNewSeason({ leagueId: leagueIdInput.trim(), season: seasonInput.trim() });
    setConfirming(false);
    setLeague(updated);
    setLeagueIdInput(updated.leagueId);
    setSeasonInput(updated.season);
  }

  const infoDirty = league && (leagueIdInput !== league.leagueId || seasonInput !== league.season);

  if (!league) return null;

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        League
      </div>
      <div className="card stack-gap">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          League ID:
          <input
            className="field-input mono"
            style={{ width: 120 }}
            value={leagueIdInput}
            onChange={(e) => setLeagueIdInput(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          Season:
          <input
            className="field-input mono"
            style={{ width: 140 }}
            value={seasonInput}
            onChange={(e) => setSeasonInput(e.target.value)}
          />
          <button type="button" className="btn btn-sm" onClick={handleRefreshSeason}>
            Refresh
          </button>
        </div>
        {infoDirty && (
          <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={handleSaveInfo} disabled={savingInfo}>
            {savingInfo ? 'Saving…' : 'Save League ID / Season'}
          </button>
        )}
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
          {confirming
            ? `Click again to confirm — archives the current draft, starts league ${leagueIdInput} / ${seasonInput}`
            : 'Start New Season — re-pull & archive last draft'}
        </button>
      </div>
    </div>
  );
}
