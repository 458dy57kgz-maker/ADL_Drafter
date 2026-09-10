import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import DraftBoard from '../components/DraftBoard.jsx';
import { useLivePickFeed } from '../lib/useLivePickFeed.jsx';
import './WarRoom.css';

const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];

// Anything pushed within two minutes counts as live: the tracker only pushes
// when a pick lands, and a quiet stretch mid-round is normal.
const FEED_LIVE_MS = 120000;

function FeedChip({ feed, push }) {
  const pushedRecently = push && Date.now() - push.at < FEED_LIVE_MS;

  if (push?.blocked) {
    return (
      <div className="feed-chip feed-chip--blocked" title={`${push.blocked} — ${push.received} picks waiting. Fix it in Settings > Live Pick Feed.`}>
        <span className="status-dot status-dot--off" />
        Feed blocked
      </div>
    );
  }

  if (pushedRecently || feed.connected) {
    const lastPick = push?.lastPick ?? feed.report?.lastPick ?? 0;
    return (
      <div
        className="feed-chip feed-chip--live"
        title={push ? `Picks pushed from the draft room — through pick ${lastPick}` : `Reading ${feed.fileName ?? 'the pick file'}`}
      >
        <span className="status-dot" />
        Live feed · {lastPick}
      </div>
    );
  }

  // Nothing arriving. Offer the one-click reconnect only if this browser has a
  // file to go back to; otherwise say so and leave setup to Settings.
  if (feed.supported && feed.hasHandle) {
    return (
      <button type="button" className="feed-chip" onClick={feed.connect} disabled={feed.busy} title="Click to give the pick file permission again">
        <span className="status-dot status-dot--off" />
        Reconnect feed
      </button>
    );
  }

  return (
    <div className="feed-chip" title={push ? `Last push ${Math.round((Date.now() - push.at) / 1000)}s ago` : 'Set this up in Settings > Live Pick Feed'}>
      <span className="status-dot status-dot--off" />
      {push ? 'Feed quiet' : 'No live feed'}
    </div>
  );
}

// The category leader, shown under my own ring. Nobody leads a category
// nobody has scored in yet, so before the draft starts this is a dash rather
// than an arbitrary team name.
function TargetLeader({ leader, suffix }) {
  if (!leader) {
    return <div className="target-leader target-leader--none">—</div>;
  }
  const label = leader.isMine ? 'You' : leader.team;
  return (
    <div
      className={`target-leader${leader.isMine ? ' target-leader--mine' : ''}`}
      title={`Leader: ${label} — ${leader.current ?? leader.pct}${suffix}`}
    >
      <span className="target-leader__team">{label}</span>
      <span className="mono target-leader__value">
        {leader.current ?? leader.pct}
        {suffix}
      </span>
    </div>
  );
}

export default function WarRoom() {
  // Seed with the draft-day default (server/src/db/index.js) and switch to
  // whatever Draft-Day Behavior actually has saved once the first poll
  // lands — passing it back into `deps` restarts the interval timer so a
  // changed slider value takes effect without a page reload.
  const [pollInterval, setPollInterval] = useState(8);
  const { data, error, refetch } = usePolling(api.getDraftState, pollInterval, [pollInterval]);

  // Instant star feedback: the click flips this local override immediately,
  // rather than waiting for the poll's next tick (up to `pollInterval`
  // seconds away) to reflect the change — that lag was reading as "did my
  // click not register?" and inviting a double-click that undid it.
  const [trackedOverrides, setTrackedOverrides] = useState({});
  const [pending, setPending] = useState(null); // 'toggle' | 'reset'
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState(null);
  const mockDraftMode = !!data?.mockDraftMode;
  const feed = useLivePickFeed();

  useEffect(() => {
    if (data?.pollInterval && data.pollInterval !== pollInterval) {
      setPollInterval(data.pollInterval);
    }
  }, [data, pollInterval]);

  // Drop an override once fresh server data confirms the same value, so the
  // map doesn't grow stale/unbounded across a long draft session.
  useEffect(() => {
    if (!data) return;
    const allPlayers = (data.board?.columns ?? []).flatMap((col) => col.cards);
    setTrackedOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of allPlayers) {
        if (p.id in next && next[p.id] === p.tracked) {
          delete next[p.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [data]);

  function trackedFor(p) {
    return p.id in trackedOverrides ? trackedOverrides[p.id] : p.tracked;
  }

  async function handleToggleTrack(playerId, tracked) {
    const next = !tracked;
    setTrackedOverrides((prev) => ({ ...prev, [playerId]: next }));
    try {
      await api.updatePlayer(playerId, { tracked: next });
      refetch();
    } catch {
      setTrackedOverrides((prev) => ({ ...prev, [playerId]: tracked }));
    }
  }

  // Both switching Mock Draft mode and the in-mode Reset button wipe the
  // draft, so both go through the same confirmation. `pending` is which one
  // asked, so the dialog can say what's actually about to happen.
  async function runPendingAction() {
    setResetBusy(true);
    try {
      if (pending === 'toggle') {
        await api.updateSettings('draftday', { mockDraftMode: !mockDraftMode });
      }
      await api.resetDraft();
      refetch();
      setPending(null);
    } catch (err) {
      setResetError(err.message);
      setPending(null);
    } finally {
      setResetBusy(false);
    }
  }

  if (error) {
    return (
      <div className="war-room war-room--empty">
        <div className="card">
          Could not reach the API server. Is it running? ({error.message})
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="war-room war-room--empty">Loading draft state…</div>;
  }

  const { pickInfo, yahooConnected, board, roster, targets, overall, liveFeed, tracked } = data;

  return (
    <div className="war-room">
      <header className="war-room__header">
        <div className="war-room__header-left">
          <div className="pick-chip mono">PICK {pickInfo.pickNum}</div>
          <div className="war-room__round">Round {pickInfo.round}</div>
          <div className="picks-until-pill">{pickInfo.picksUntilMe} picks until you</div>
        </div>
        <div className="war-room__header-right">
          <label className="mock-toggle" title="Mock Draft mode — switching either way starts a fresh draft">
            <input type="checkbox" checked={mockDraftMode} onChange={() => setPending('toggle')} />
            <span className="mock-toggle__track">
              <span className="mock-toggle__thumb" />
            </span>
            Mock Draft
          </label>
          {mockDraftMode && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setPending('reset')}>
              Reset Draft
            </button>
          )}
          {/* One indicator for both ways picks arrive: the Yahoo tracker
              pushing to the server, or this browser watching a file. The
              server-side push wins, since it's true no matter which tab or
              machine you're looking from. */}
          <FeedChip feed={feed} push={data.feed} />
          <div className="yahoo-status">
            <span className={`status-dot${yahooConnected ? '' : ' status-dot--off'}`} />
            {yahooConnected ? 'Yahoo connected' : 'Yahoo disconnected'}
          </div>
          <div className="poll-chip mono">poll {pollInterval}s</div>
        </div>
      </header>

      {resetError && (
        <div className="card" style={{ marginBottom: 12, color: 'var(--danger-text)', font: '600 12px var(--font-ui)' }}>
          {resetError}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        busy={resetBusy}
        title={pending === 'reset' ? 'Reset the draft?' : mockDraftMode ? 'Turn off Mock Draft mode?' : 'Turn on Mock Draft mode?'}
        body={
          pending === 'reset'
            ? 'Every pick made so far will be cleared and all players returned to the pool. Your player list and rankings are kept.'
            : `Switching Mock Draft mode ${mockDraftMode ? 'off' : 'on'} starts a fresh draft: every pick made so far will be cleared and all players returned to the pool. Your player list and rankings are kept.`
        }
        confirmLabel={pending === 'reset' ? 'Reset draft' : 'Switch and reset'}
        onConfirm={runPendingAction}
        onCancel={() => setPending(null)}
      />

      <div className="war-room__board-section">
        <div className="section-eyebrow">Best Available — next per position</div>
        <DraftBoard board={board} trackedFor={trackedFor} onToggleTrack={handleToggleTrack} />
      </div>

      {/* Targets sit between the board and the roster as a single band. Top
          row is me: a ring filling toward the season goal, with the running
          total in the middle and the goal on hover. The label and the
          category leader sit to the left of each ring rather than stacked
          under it — the same band then buys a noticeably larger ring. The
          leader is whoever currently leads that category, so the number you read is
          "am I ahead in the room", not just "am I on pace". Bench players
          count toward every manager's totals at 75% — see
          server/src/lib/roster.js. Overall on the right is the average of
          the seven percentages. */}
      <div className="card targets-strip">
        <div className="targets-strip__title">
          Target
          <br />
          Progress
        </div>
        <div className="targets-strip__rings">
          {targets.map((t) => (
            <div className="target-ring-wrap" key={t.key}>
              <div className="target-ring-wrap__text">
                <div className="target-ring__label">{t.label}</div>
                <TargetLeader leader={t.leader} suffix="" />
              </div>
              <div
                className="target-ring"
                style={{ '--pct': t.pct }}
                data-goal={`${t.current} of ${t.goal} — ${t.pct}%`}
                role="img"
                aria-label={`${t.label}: ${t.current} of ${t.goal}`}
              >
                <div className="target-ring__inner mono">{t.current}</div>
              </div>
            </div>
          ))}
          <div className="target-ring-wrap target-ring-wrap--overall">
            <div className="target-ring-wrap__text">
              <div className="target-ring__label">Overall</div>
              <TargetLeader leader={overall.leader} suffix="%" />
            </div>
            <div
              className="target-ring target-ring--overall"
              style={{ '--pct': overall.pct }}
              role="img"
              aria-label={`Overall: ${overall.pct}% of target across the seven tracked categories`}
              data-goal="Average across the 7 categories"
            >
              <div className="target-ring__inner mono">{overall.pct}%</div>
            </div>
          </div>
        </div>
      </div>

      <div className="war-room__bottom-grid">
        <div className="card roster-card">
          <div className="card-title">My Roster</div>
          <div className="roster-header">
            <div>SLOT</div>
            <div>PLAYER</div>
            <div>G</div>
            <div>A</div>
            <div>P</div>
            <div>PPP</div>
            <div>+/-</div>
            <div>SH</div>
            <div>BLK</div>
          </div>
          {roster.slots.map((slot, i) => (
            <div className={`roster-row${slot.pos === 'BN' ? ' roster-row--bench' : ''}`} key={i}>
              <div className="mono roster-row__pos">{slot.pos}</div>
              <div
                className={`roster-row__name${slot.player?.unknown ? ' roster-row__name--unknown' : ''}`}
                style={{ color: slot.player ? 'var(--text-primary)' : 'var(--text-faint)' }}
                title={slot.player?.unknown ? 'Drafted from the room but not in your player list — no projections for him' : undefined}
              >
                {slot.player ? slot.player.name : 'empty'}
                {slot.player?.unknown && <span className="roster-row__untracked">no stats</span>}
              </div>
              <div className="mono">{slot.player?.g ?? '–'}</div>
              <div className="mono">{slot.player?.a ?? '–'}</div>
              <div className="mono">{slot.player?.p ?? '–'}</div>
              <div className="mono">{slot.player?.ppp ?? '–'}</div>
              <div className="mono">{slot.player?.plusMinus ?? '–'}</div>
              <div className="mono">{slot.player?.shots ?? '–'}</div>
              <div className="mono">{slot.player?.blocks ?? '–'}</div>
            </div>
          ))}
          <div className="roster-footer">IR x{roster.irCount} — empty</div>
        </div>

        <div className="side-col">
          {/* Side by side, each scrolling in place so the band's height stays
              fixed no matter how long the draft runs. Position Scarcity used
              to sit above them and said nothing the board's own rings don't
              say better, right next to the players it's about. */}
          <div className="side-col__pair">
            <div className="card side-col__scroller">
              <div className="card-title">Live Pick Feed</div>
              {liveFeed.map((f) => (
                <div className="feed-row" key={f.pickNum}>
                  <span className="mono feed-row__num">#{f.pickNum}</span> {f.team} → {f.playerName} ({f.pos})
                </div>
              ))}
              {liveFeed.length === 0 && <div className="feed-row feed-row--empty">No picks yet</div>}
            </div>
            <div className="card side-col__scroller">
              <div className="card-title">Tracked Players</div>
              {tracked.map((tr) => (
                <div className="tracked-row" key={tr.id}>
                  <div>
                    {tr.name} <span className="tracked-row__pos">— {tr.pos}</span>
                  </div>
                  <div
                    className="tracked-row__status"
                    style={{ color: tr.drafted ? 'var(--danger-text)' : 'var(--success-text)' }}
                  >
                    {tr.drafted ? `Taken by ${tr.draftedBy}` : 'Still available'}
                  </div>
                </div>
              ))}
              {tracked.length === 0 && <div className="tracked-row tracked-row--empty">No players tracked yet</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
