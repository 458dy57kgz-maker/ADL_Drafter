import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import './ManualDraftOverlay.css';

// Lenient, last-name-focused match: exact last name beats "starts with"
// beats "full name contains somewhere" — this is what lets a search like
// "mcdavid" or even just "mc" surface the right player without requiring
// the exact spelling of a full name.
function matchScore(name, query) {
  const lower = name.toLowerCase();
  const last = lower.trim().split(/\s+/).pop();
  if (last === query) return 3;
  if (last.startsWith(query)) return 2;
  if (lower.includes(query)) return 1;
  return 0;
}

export default function ManualDraftOverlay({ open, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const [league, setLeague] = useState(null);
  const [teamNames, setTeamNames] = useState([]);
  const [myTeamIndex, setMyTeamIndex] = useState(0);
  const [savingSetup, setSavingSetup] = useState(false);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState(null);

  const { data: draftState, refetch: refetchDraft } = usePolling(api.getDraftState, open ? 10 : 0, [open]);
  const { data: players, refetch: refetchPlayers } = usePolling(api.getPlayers, open ? 10 : 0, [open]);

  useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => {
      setLeague(s.league);
      setTeamNames((s.league.teams ?? []).map((t) => t.name));
      const idx = (s.league.teams ?? []).findIndex((t) => t.id === s.league.myTeamId);
      setMyTeamIndex(idx >= 0 ? idx : 0);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const results = useMemo(() => {
    if (!players || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => !p.drafted)
      .map((p) => ({ p, score: matchScore(p.name, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.p.overallRank - b.p.overallRank)
      .slice(0, 8);
  }, [players, search]);

  async function handleSaveSetup() {
    if (teamNames.some((n) => !n.trim())) {
      setActionError('Every team needs a name.');
      return;
    }
    setSavingSetup(true);
    setActionError(null);
    try {
      const teams = league.teams.map((t, i) => ({ ...t, name: teamNames[i].trim() }));
      const myTeamId = teams[myTeamIndex].id;
      const updated = await api.updateSettings('league', {
        teams,
        myTeamId,
        myTeamSlot: myTeamIndex + 1,
        teamsConfigured: true,
      });
      setLeague(updated.league);
      refetchDraft();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSavingSetup(false);
    }
  }

  async function handlePick(playerId) {
    setActionError(null);
    try {
      await api.pickPlayer(playerId);
      setSearch('');
      refetchDraft();
      refetchPlayers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleUndo() {
    setActionError(null);
    try {
      await api.undoPick();
      refetchDraft();
      refetchPlayers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (!open) return null;

  return (
    <div className={`manual-draft${minimized ? ' manual-draft--minimized' : ''}`}>
      <div className="manual-draft__header">
        <div className="manual-draft__title">Manual Draft Mode</div>
        <div className="manual-draft__header-actions">
          <button type="button" className="manual-draft__icon-btn" onClick={() => setMinimized((m) => !m)}>
            {minimized ? '▢' : '—'}
          </button>
          <button type="button" className="manual-draft__icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {!minimized && league && !league.teamsConfigured && (
        <div className="manual-draft__body">
          <div className="manual-draft__hint">Set up your 10 teams and pick which one is yours.</div>
          {teamNames.map((name, i) => (
            <div key={i} className="manual-draft__team-row">
              <input
                className="field-input manual-draft__team-input"
                value={name}
                onChange={(e) => setTeamNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))}
              />
              <label className="manual-draft__my-team">
                <input type="radio" name="myTeam" checked={myTeamIndex === i} onChange={() => setMyTeamIndex(i)} />
                Me
              </label>
            </div>
          ))}
          {actionError && <div className="manual-draft__error">{actionError}</div>}
          <button type="button" className="btn btn-primary manual-draft__save" onClick={handleSaveSetup} disabled={savingSetup}>
            {savingSetup ? 'Saving…' : 'Start Draft'}
          </button>
        </div>
      )}

      {!minimized && league && league.teamsConfigured && (
        <div className="manual-draft__body">
          <div className="manual-draft__status">
            {draftState ? (
              <>
                <span className="mono">Pick {draftState.pickInfo.pickNum}</span> · Round {draftState.pickInfo.round}
                {draftState.pickInfo.onTheClock && <> · On the clock: <strong>{draftState.pickInfo.onTheClock}</strong></>}
              </>
            ) : (
              'Loading…'
            )}
          </div>
          <input
            className="field-input manual-draft__search"
            placeholder="Search by last name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="manual-draft__results">
            {results.map(({ p }) => (
              <button type="button" key={p.id} className="manual-draft__result" onClick={() => handlePick(p.id)}>
                <span>{p.name}</span>
                <span className="mono manual-draft__result-meta">
                  {p.pos} · #{p.overallRank}
                </span>
              </button>
            ))}
            {search.trim() && results.length === 0 && (
              <div className="manual-draft__no-results">No undrafted players match "{search.trim()}"</div>
            )}
          </div>
          {actionError && <div className="manual-draft__error">{actionError}</div>}
          <button type="button" className="btn btn-sm manual-draft__undo" onClick={handleUndo}>
            Undo last pick
          </button>
        </div>
      )}
    </div>
  );
}
