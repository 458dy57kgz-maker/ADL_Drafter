import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

// Teams entered by hand get a local id; a Yahoo pull replaces them with
// Yahoo's own team keys.
function newTeamId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function League() {
  const [league, setLeague] = useState(null);
  const [yahooConnected, setYahooConnected] = useState(false);
  const [teams, setTeams] = useState([]);
  const [myTeamId, setMyTeamId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setLeague(s.league);
      setTeams(s.league.teams ?? []);
      setMyTeamId(s.league.myTeamId ?? null);
      setYahooConnected(!!s.yahoo?.connected);
    });
  }, []);

  // Yahoo is the source of truth once a pull has happened — hand-editing a
  // roster that the next pull would overwrite is just a way to lose work.
  const fromYahoo = !!league?.teamsFromYahoo;

  function updateTeam(id, name) {
    setTeams((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)));
  }

  function addTeam() {
    setTeams((prev) => [...prev, { id: newTeamId(), name: '' }]);
  }

  function removeTeam(id) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
    if (myTeamId === id) setMyTeamId(null);
  }

  async function handleSave() {
    const cleaned = teams.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name);
    if (cleaned.length === 0) {
      setMessage({ kind: 'error', text: 'Add at least one team before saving.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const mine = cleaned.find((t) => t.id === myTeamId) ? myTeamId : null;
      const updated = await api.updateSettings('league', {
        teams: cleaned,
        teamCount: cleaned.length,
        myTeamId: mine,
        // Draft order is 1-based by list position; default to the first slot
        // until a team is marked as mine.
        myTeamSlot: mine ? cleaned.findIndex((t) => t.id === mine) + 1 : 1,
      });
      setLeague(updated.league);
      setTeams(updated.league.teams);
      setMyTeamId(updated.league.myTeamId);
      setMessage({ kind: 'success', text: `Saved ${cleaned.length} teams.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handlePull() {
    setPulling(true);
    setMessage(null);
    try {
      const result = await api.pullLeagueTeams();
      setLeague(result.league);
      setTeams(result.league.teams);
      setMyTeamId(result.league.myTeamId);
      setMessage({ kind: 'success', text: `Pulled ${result.teamCount} teams from Yahoo.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setPulling(false);
    }
  }

  if (!league) return null;

  const dirty =
    JSON.stringify(teams.map((t) => [t.id, t.name])) !==
      JSON.stringify((league.teams ?? []).map((t) => [t.id, t.name])) || myTeamId !== league.myTeamId;

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="settings-section-header">
        <div className="settings-section-title">League</div>
        <button type="button" className="btn btn-sm" onClick={handlePull} disabled={pulling || !yahooConnected}>
          {pulling ? 'Pulling…' : 'Pull teams from Yahoo'}
        </button>
      </div>

      <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 12 }}>
        {yahooConnected
          ? 'Pulling from Yahoo replaces the team list below with the league\'s real rosters.'
          : 'Not connected to Yahoo — set up the connection on the Yahoo Connection page to pull real teams. Until then, enter them by hand.'}
      </div>

      {message && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            background: message.kind === 'success' ? 'var(--success-bg)' : 'var(--danger-bg-alt)',
            borderColor: message.kind === 'success' ? 'var(--success-border)' : 'var(--danger-border)',
            color: message.kind === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
            font: '600 12.5px var(--font-ui)',
          }}
        >
          {message.text}
        </div>
      )}

      <div className="card">
        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Teams ({teams.length})
          </div>
          {fromYahoo && (
            <div style={{ font: '500 11.5px var(--font-ui)', color: 'var(--text-faint)' }}>
              From Yahoo — re-pull to update
            </div>
          )}
        </div>

        {teams.length === 0 && (
          <div style={{ font: '500 12.5px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 10 }}>
            No teams yet. Add one for each team in your league, in draft order.
          </div>
        )}

        {teams.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div className="mono" style={{ width: 22, font: '500 12px var(--font-mono)', color: 'var(--text-faint)' }}>
              {i + 1}
            </div>
            <input
              className="field-input"
              style={{ flex: 1 }}
              placeholder={`Team ${i + 1}`}
              value={t.name}
              disabled={fromYahoo}
              onChange={(e) => updateTeam(t.id, e.target.value)}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                font: '600 11.5px var(--font-ui)',
                color: myTeamId === t.id ? 'var(--accent)' : 'var(--text-faint)',
                whiteSpace: 'nowrap',
              }}
            >
              <input type="radio" name="myTeam" checked={myTeamId === t.id} onChange={() => setMyTeamId(t.id)} />
              Mine
            </label>
            {!fromYahoo && (
              <button type="button" className="btn btn-sm" onClick={() => removeTeam(t.id)}>
                Remove
              </button>
            )}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {!fromYahoo && (
            <button type="button" className="btn btn-sm" onClick={addTeam}>
              + Add Team
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save Teams'}
          </button>
        </div>
      </div>
    </div>
  );
}
