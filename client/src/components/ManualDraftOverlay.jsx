import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import './ManualDraftOverlay.css';

const POSITION_KEY = 'adl-manual-draft-pos';

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

// Keep the panel on screen. A remembered position can be stranded by a
// smaller window or a disconnected monitor, so it's clamped on read as well
// as on drag.
function clamp(pos, size) {
  const w = size?.width ?? 440;
  const h = size?.height ?? 120;
  return {
    x: Math.max(0, Math.min(pos.x, window.innerWidth - Math.min(w, window.innerWidth))),
    y: Math.max(0, Math.min(pos.y, window.innerHeight - Math.min(h, window.innerHeight))),
  };
}

function readStoredPosition() {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function ManualDraftOverlay({ open, onClose }) {
  const [minimized, setMinimized] = useState(false);
  const [league, setLeague] = useState(null);
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState(null);
  // Picks walked back past, newest first. Purely a session thing — it exists
  // to let Go Forward retrace the steps Go Back just took, and a reload means
  // you're done retracing.
  const [redoStack, setRedoStack] = useState([]);
  // null = parked in the bottom-right corner, where it opens.
  const [pos, setPos] = useState(null);
  // Set to ask for the search box back after the next render. It can't be
  // done inline: the caret has to land in a field whose value React has
  // already committed, or select() would select the value being replaced.
  const [focusRequest, setFocusRequest] = useState(null);

  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const dragRef = useRef(null);

  const { data: draftState, refetch: refetchDraft } = usePolling(api.getDraftState, open ? 10 : 0, [open]);
  const { data: players, refetch: refetchPlayers } = usePolling(api.getPlayers, open ? 10 : 0, [open]);

  // Teams are owned by Settings > League — this overlay used to carry its own
  // setup screen, which meant two places to edit the same list.
  useEffect(() => {
    if (!open) return;
    api.getSettings().then((s) => setLeague(s.league));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const stored = readStoredPosition();
    if (stored) setPos(clamp(stored, panelRef.current?.getBoundingClientRect()));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // --- dragging ----------------------------------------------------------
  // Pointer events rather than mouse events so a trackpad, a pen and a touch
  // screen all drag identically, and pointer capture so a fast drag that
  // outruns the header keeps tracking instead of dropping the panel.
  const handleDragStart = useCallback((e) => {
    if (e.target.closest('button')) return; // minimise / close stay clickable
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const handleDragMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPos(clamp({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, { width: drag.w, height: drag.h }));
  }, []);

  const handleDragEnd = useCallback(
    (e) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      try {
        if (pos) localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
      } catch {
        // A browser with site data blocked just forgets the position.
      }
    },
    [pos]
  );

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

  // The whole point of the search box is that you can keep typing: picking a
  // player clears the field and hands focus straight back rather than leaving
  // it on whichever result button was clicked.
  function focusSearch(value = '') {
    setSearch(value);
    setFocusRequest({ select: !!value, n: Date.now() });
  }

  useEffect(() => {
    if (!focusRequest) return;
    const el = searchRef.current;
    if (el) {
      el.focus();
      // A name put back by Go Back arrives selected, so the next keystroke
      // replaces it — retype to confirm, or type over it to pick someone else.
      if (focusRequest.select) el.select();
    }
    setFocusRequest(null);
  }, [focusRequest]);

  async function handlePick(playerId) {
    setActionError(null);
    try {
      await api.pickPlayer(playerId);
      // A new pick is a new branch of the draft: whatever Go Back had walked
      // past is no longer the future, so Go Forward has nowhere to go.
      setRedoStack([]);
      focusSearch('');
      refetchDraft();
      refetchPlayers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleBack() {
    setActionError(null);
    try {
      const undone = await api.undoPick();
      setRedoStack((prev) => [undone, ...prev]);
      // The name lands in the box selected, so the next keystroke replaces it
      // — either retype it to confirm, or type over it to pick someone else.
      focusSearch(undone.playerName ?? '');
      refetchDraft();
      refetchPlayers();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleForward() {
    const [next, ...rest] = redoStack;
    if (!next) return;
    setActionError(null);
    try {
      await api.pickPlayer(next.playerId);
      setRedoStack(rest);
      focusSearch('');
      refetchDraft();
      refetchPlayers();
    } catch (err) {
      // Most likely someone else took him in the meantime; drop the step
      // rather than leaving a button that can only fail.
      setRedoStack(rest);
      setActionError(err.message);
    }
  }

  if (!open) return null;

  const pickNum = draftState?.pickInfo?.pickNum ?? null;
  const canGoBack = pickNum != null && pickNum > 1;
  const canGoForward = redoStack.length > 0;
  const style = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div
      ref={panelRef}
      className={`manual-draft${minimized ? ' manual-draft--minimized' : ''}`}
      style={style}
    >
      <div
        className="manual-draft__header"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
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

      {!minimized && league && !league.teams?.length && (
        <div className="manual-draft__body">
          <div className="manual-draft__hint">
            No teams set up yet. Add them in Settings → League (in draft order, and mark which one is yours), then
            come back here to make picks.
          </div>
        </div>
      )}

      {!minimized && league && league.teams?.length > 0 && (
        <div className="manual-draft__body">
          <div className="manual-draft__nav">
            <button
              type="button"
              className="btn btn-sm manual-draft__nav-btn"
              onClick={handleBack}
              disabled={!canGoBack}
              title="Step back one pick and put that player back in the search box"
            >
              ← Go Back
            </button>
            <button
              type="button"
              className="btn btn-sm manual-draft__nav-btn"
              onClick={handleForward}
              disabled={!canGoForward}
              title={canGoForward ? `Redo pick ${redoStack[0].undonePickNum}: ${redoStack[0].playerName}` : 'Already at the current pick'}
            >
              Go Forward →
            </button>
          </div>

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
            ref={searchRef}
            className="field-input manual-draft__search"
            placeholder="Search by last name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="manual-draft__results">
            {results.map(({ p }) => (
              <button
                type="button"
                key={p.id}
                className="manual-draft__result"
                // Keeps the caret in the search box through the click, so the
                // refocus afterwards is a no-op rather than a visible jump.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(p.id)}
              >
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
        </div>
      )}
    </div>
  );
}
