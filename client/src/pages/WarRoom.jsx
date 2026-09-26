import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import DraftBoard, { ONG_FLOOR } from '../components/DraftBoard.jsx';
import DraftUrgencyRow from '../components/DraftUrgencyRow.jsx';
import PlayerFlag from '../components/PlayerFlag.jsx';
import { useLivePickFeed } from '../lib/useLivePickFeed.jsx';
import './WarRoom.css';

// War Room, built to option 2a of the War Room Redesign wireframe: a red
// command band, the value-gutter board, a Season Totals strip, and a fixed
// two-panel band for My Roster and Live Picks. Tracked Players is gone.

// Anything pushed within two minutes counts as live: the tracker only pushes
// when a pick lands, and a quiet stretch mid-round is normal.
const FEED_LIVE_MS = 120000;

// A category at under this share of the leader's total is one you're losing,
// so its ring and caption go red. The wireframe's threshold.
const LOSING_PCT = 65;

// Shaded "still to come" rows at the top of Live Picks. The wireframe shows
// the three picks between now and yours; at the turn of a round that can be
// eighteen, which would bury the history, so it's capped.
const MAX_UPCOMING = 4;

const SLOT_ORDER = ['C', 'LW', 'RW', 'D', 'G', 'BN'];

// My Roster reads as two lists, not a row of pairs: forwards and goalies on
// the left, defence and bench on the right.
const ROSTER_LEFT = ['C', 'RW', 'LW', 'G'];
const ROSTER_RIGHT = ['D', 'BN'];

function rosterColumn(slots, order) {
  return order.flatMap((pos) => slots.filter((s) => s.pos === pos));
}

function FeedStatus({ feed, push }) {
  const pushedRecently = push && Date.now() - push.at < FEED_LIVE_MS;

  if (push?.blocked) {
    return (
      <div className="cmd__line" title={`${push.blocked} — ${push.received} picks waiting. Fix it in Settings > Live Pick Feed.`}>
        <span className="cmd__mark cmd__mark--off" />
        FEED BLOCKED
      </div>
    );
  }

  if (pushedRecently || feed.connected) {
    const lastPick = push?.lastPick ?? feed.report?.lastPick ?? 0;
    return (
      <div
        className="cmd__line cmd__line--strong"
        title={push ? `Picks pushed from the draft room — through pick ${lastPick}` : `Reading ${feed.fileName ?? 'the pick file'}`}
      >
        <span className="cmd__mark" />
        LIVE FEED · {lastPick}
      </div>
    );
  }

  // Nothing arriving. Offer the one-click reconnect only if this browser has a
  // file to go back to; otherwise say so and leave setup to Settings.
  if (feed.supported && feed.hasHandle) {
    return (
      <button
        type="button"
        className="cmd__line cmd__line--button"
        onClick={feed.connect}
        disabled={feed.busy}
        title="Click to give the pick file permission again"
      >
        <span className="cmd__mark cmd__mark--off" />
        RECONNECT FEED
      </button>
    );
  }

  return (
    <div className="cmd__line" title={push ? `Last push ${Math.round((Date.now() - push.at) / 1000)}s ago` : 'Set this up in Settings > Live Pick Feed'}>
      <span className="cmd__mark cmd__mark--off" />
      {push ? 'FEED QUIET' : 'NO LIVE FEED'}
    </div>
  );
}

function CommandBand({ pickInfo, data, feed, pollInterval, mockDraftMode, onToggleMock, onReset }) {
  const { pickNum, round, totalRounds, picksUntilMe, isMyTurnNow, myPicks = [], upcoming = [], onTheClock } = pickInfo;
  const clockTeam = isMyTurnNow ? 'You' : onTheClock;
  const then = upcoming.slice(1).map((u) => `${u.isMine ? 'YOU' : u.team ?? 'Pick'} ${u.pickNum}`);

  return (
    <header className="cmd">
      <div className="cmd__left">
        <div className="cmd__main">
          <div className="cmd__meta">
            <span>PICK {pickNum}</span>
            <span className="cmd__dot">·</span>
            <span>
              ROUND {round}
              {totalRounds ? ` OF ${totalRounds}` : ''}
            </span>
            {myPicks.length > 0 && (
              <>
                <span className="cmd__dot">·</span>
                <span>YOU PICK AT {myPicks.join(' & ')}</span>
              </>
            )}
          </div>
          <div className="cmd__count">
            {isMyTurnNow ? (
              <span className="cmd__num cmd__num--now">YOUR PICK</span>
            ) : (
              <>
                <span className="cmd__num">{picksUntilMe}</span>
                <span className="cmd__count-label">{picksUntilMe === 1 ? 'PICK UNTIL YOU' : 'PICKS UNTIL YOU'}</span>
              </>
            )}
          </div>
        </div>
        {clockTeam && (
          <div className="cmd__clock">
            <div className="cmd__clock-label">ON THE CLOCK</div>
            <div className="cmd__clock-team">{clockTeam}</div>
            {then.length > 0 && <div className="cmd__clock-then">Then {then.join(' · ')}</div>}
          </div>
        )}
      </div>

      <div className="cmd__status">
        {/* One indicator for both ways picks arrive: the Yahoo tracker
            pushing to the server, or this browser watching a file. */}
        <FeedStatus feed={feed} push={data.feed} />
        <div className="cmd__line">
          <span className={`cmd__mark${data.yahooConnected ? '' : ' cmd__mark--off'}`} />
          {data.yahooConnected ? 'YAHOO CONNECTED' : 'YAHOO DISCONNECTED'}
        </div>
        <div className="cmd__line">POLL {pollInterval}s</div>
        <label className="cmd__toggle" title="Mock Draft mode — switching either way starts a fresh draft">
          <input type="checkbox" checked={mockDraftMode} onChange={onToggleMock} />
          <span className="cmd__toggle-track">
            <span className="cmd__toggle-thumb" />
          </span>
          MOCK DRAFT
        </label>
        {mockDraftMode && (
          <button type="button" className="cmd__reset" onClick={onReset}>
            RESET DRAFT
          </button>
        )}
      </div>
    </header>
  );
}

// One ring in the Season Totals strip. The arc is my total against my season
// target; the caption underneath is my total against the room's leader, and
// that's what turns it red — "on pace" and "winning" are different questions.
function TotalItem({ label, current, goal, arcPct, pctOfLeader, leader, overall = false }) {
  const losing = pctOfLeader != null && pctOfLeader < LOSING_PCT;
  const arcColor = overall ? 'var(--text-primary)' : losing ? 'var(--accent)' : 'var(--text-muted)';
  const leaderText = leader ? `${leader.isMine ? 'You' : leader.team} lead${leader.isMine ? '' : 's'} with ${leader.current ?? `${leader.pct}%`}` : 'Nobody has scored here yet';

  let caption;
  if (pctOfLeader == null) caption = 'no leader yet';
  else if (leader?.isMine) caption = 'you lead';
  else caption = `${pctOfLeader}% of leader`;

  return (
    <div className={`totals__item${overall ? ' totals__item--overall' : ''}`} title={leaderText}>
      <div
        className="totals__ring"
        style={{ background: `conic-gradient(${arcColor} ${Math.min(arcPct, 100)}%, var(--track-bg) 0)` }}
        role="img"
        aria-label={`${label}: ${current}${overall ? '' : ` of ${goal}`}, ${caption}`}
      >
        <div className="totals__ring-inner">{current}</div>
      </div>
      <div className="totals__text">
        <span className="totals__label">{label}</span>
        <span className="totals__goal">{overall ? 'all seven cats' : `of ${goal}`}</span>
        <span className={`totals__pct${losing && !overall ? ' totals__pct--losing' : ''}`}>{caption}</span>
      </div>
    </div>
  );
}

function stillToFill(slots) {
  const empty = {};
  for (const s of slots) if (!s.player) empty[s.pos] = (empty[s.pos] ?? 0) + 1;
  const parts = SLOT_ORDER.filter((pos) => empty[pos]).map((pos) => `${empty[pos]}${pos}`);
  return parts.length ? `Still to fill ${parts.join(' · ')}` : 'Every seat filled';
}

// A filled row can be picked up and dropped on an empty seat he's eligible
// for, or on the bench. `drag` is whoever's in hand right now.
function RosterRow({ slot, drag, onDragStart, onDragEnd, onDrop }) {
  const p = slot.player;
  const ongHigh = p?.ongPct != null && p.ongPct >= ONG_FLOOR;
  const [over, setOver] = useState(false);
  // Players not in my list have no record to remember a seat on.
  const movable = !!p && !p.unknown;
  const target =
    !!drag && !p && slot.pos !== drag.pos && (slot.pos === 'BN' || (drag.player.posList ?? []).includes(slot.pos));

  let cls = 'wr-roster__row';
  if (movable) cls += ' wr-roster__row--movable';
  if (drag?.player.id === p?.id && p) cls += ' wr-roster__row--lifted';
  if (target) cls += ' wr-roster__row--target';
  if (target && over) cls += ' wr-roster__row--over';

  return (
    <div
      className={cls}
      draggable={movable}
      title={movable ? `Drag ${p.name} to an empty seat he can play, or to the bench` : undefined}
      onDragStart={
        movable
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(p.id));
              onDragStart({ player: p, pos: slot.pos });
            }
          : undefined
      }
      onDragEnd={movable ? onDragEnd : undefined}
      onDragOver={
        target
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (!over) setOver(true);
            }
          : undefined
      }
      onDragLeave={target ? () => setOver(false) : undefined}
      onDrop={
        target
          ? (e) => {
              e.preventDefault();
              setOver(false);
              onDrop(slot.pos);
            }
          : undefined
      }
    >
      <span className="wr-roster__pos">{slot.pos}</span>
      <span
        className={`wr-roster__name${p ? '' : ' wr-roster__name--empty'}`}
        title={p?.unknown ? 'Drafted from the room but not in your player list — no projections for him' : p?.name}
      >
        {p ? p.name : 'empty'}
        <PlayerFlag flag={p?.flag} />
        {p?.unknown && <span className="wr-roster__nostats">NO STATS</span>}
      </span>
      <span className={`wr-roster__num${p?.tier != null ? ' wr-roster__num--ink' : ''}`}>{p?.tier != null ? `T${p.tier}` : '—'}</span>
      <span className={`wr-roster__num${ongHigh ? ' wr-roster__num--hot' : ''}`}>{p?.ongPct != null ? `${p.ongPct}%` : '—'}</span>
      <span className={`wr-roster__num wr-roster__num--pts${p?.p != null ? ' wr-roster__num--ink' : ''}`}>{p?.p ?? '—'}</span>
    </div>
  );
}

function RosterHeader() {
  return (
    <div className="wr-roster__row wr-roster__row--head">
      <span />
      <span>NAME</span>
      <span className="wr-roster__num">TIER</span>
      <span className="wr-roster__num">ONG</span>
      <span className="wr-roster__num">PTS</span>
    </div>
  );
}

function LivePicks({ pickInfo, liveFeed }) {
  const { upcoming = [], isMyTurnNow, pickCount, totalPicks, pickNum } = pickInfo;
  // The picks still to come before mine, shaded. When I'm on the clock the
  // only one worth showing is my own.
  const ahead = (isMyTurnNow ? upcoming.slice(0, 1) : upcoming.filter((u) => !u.isMine)).slice(0, MAX_UPCOMING);

  return (
    <section className="wr-panel wr-feed">
      <div className="wr-panel__head">
        <span className="wr-panel__title">LIVE PICKS</span>
        <span className="wr-panel__note">
          {pickCount}
          {totalPicks ? ` of ${totalPicks}` : ''}
          {ahead.length ? ` · next ${ahead.length === 1 ? 'one' : ahead.length} shaded` : ''}
        </span>
      </div>
      <div className="wr-feed__grid">
        {ahead.map((u) => (
          <div className="wr-feed__row wr-feed__row--ahead" key={`u${u.pickNum}`}>
            <span className="wr-feed__num">#{u.pickNum}</span>
            <span className="wr-feed__team wr-feed__team--ahead">{u.isMine ? 'You' : u.team ?? '—'}</span>
            <span className={`wr-feed__player${u.pickNum === pickNum ? ' wr-feed__player--clock' : ' wr-feed__player--wait'}`}>
              {u.pickNum === pickNum ? 'ON THE CLOCK' : '—'}
            </span>
          </div>
        ))}
        {liveFeed.map((f) => (
          <div className={`wr-feed__row${f.isMine ? ' wr-feed__row--mine' : ''}`} key={f.pickNum}>
            <span className="wr-feed__num">#{f.pickNum}</span>
            <span className="wr-feed__team">{f.isMine ? 'You' : f.team}</span>
            <span className="wr-feed__player">
              {f.playerName}
              {f.pos ? ` (${f.pos})` : ''}
              <PlayerFlag flag={f.flag} />
            </span>
          </div>
        ))}
        {liveFeed.length === 0 && ahead.length === 0 && <div className="wr-feed__empty">No picks yet</div>}
      </div>
    </section>
  );
}

export default function WarRoom() {
  // Seed with the draft-day default (server/src/db/index.js) and switch to
  // whatever Draft-Day Behavior actually has saved once the first poll
  // lands — passing it back into `deps` restarts the interval timer so a
  // changed slider value takes effect without a page reload.
  const [pollInterval, setPollInterval] = useState(8);
  const { data, error, refetch } = usePolling(api.getDraftState, pollInterval, [pollInterval]);

  const [pending, setPending] = useState(null); // 'toggle' | 'reset'
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState(null);
  const mockDraftMode = !!data?.mockDraftMode;
  const feed = useLivePickFeed();
  // Drafted players I've cleared by hand with ×, shared by the board columns
  // and the urgency row. Kept in memory: each one clears itself five picks
  // after he went anyway.
  const [removedIds, setRemovedIds] = useState(() => new Set());
  const removePlayer = (id) => setRemovedIds((prev) => new Set(prev).add(id));
  // A reset or an undo walks the draft backwards; anyone cleared before that
  // could be taken again, and his locked card should show when he is.
  const lastPick = useRef(null);
  const pickNum = data?.pickInfo?.pickNum ?? null;
  useEffect(() => {
    if (pickNum != null && lastPick.current != null && pickNum < lastPick.current) setRemovedIds(new Set());
    lastPick.current = pickNum;
  }, [pickNum]);
  // The roster player being dragged, and the seat he came from.
  const [drag, setDrag] = useState(null);
  // The hidden-position list as I've just clicked it, shown until the
  // server's copy (and the urgency row and plan built from it) catches up.
  const [pendingHidden, setPendingHidden] = useState(null);

  useEffect(() => {
    if (data?.pollInterval && data.pollInterval !== pollInterval) {
      setPollInterval(data.pollInterval);
    }
  }, [data, pollInterval]);

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

  const serverHidden = data?.board?.columns?.filter((c) => c.hidden).map((c) => c.pos) ?? [];
  const hiddenPositions = pendingHidden ?? serverHidden;

  async function handleToggleHidden(pos) {
    const next = hiddenPositions.includes(pos) ? hiddenPositions.filter((p) => p !== pos) : [...hiddenPositions, pos];
    setPendingHidden(next);
    try {
      await api.updateSettings('draftday', { hiddenPositions: next });
      await refetch();
    } catch (err) {
      setResetError(err.message);
    } finally {
      setPendingHidden(null);
    }
  }

  async function handleRosterDrop(slot) {
    const moving = drag;
    setDrag(null);
    if (!moving) return;
    try {
      await api.moveRosterPlayer(moving.player.id, slot);
      await refetch();
    } catch (err) {
      setResetError(err.message);
    }
  }

  if (error) {
    return (
      <div className="war-room war-room--empty">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }

  if (!data) {
    return <div className="war-room war-room--empty">Loading draft state…</div>;
  }

  const { pickInfo, board, roster, targets, overall, liveFeed, urgency } = data;

  return (
    <div className="war-room">
      <CommandBand
        pickInfo={pickInfo}
        data={data}
        feed={feed}
        pollInterval={pollInterval}
        mockDraftMode={mockDraftMode}
        onToggleMock={() => setPending('toggle')}
        onReset={() => setPending('reset')}
      />

      {resetError && <div className="wr-error">{resetError}</div>}

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

      <div className="wr-board">
        <DraftBoard
          board={board}
          hiddenPositions={hiddenPositions}
          onToggleHidden={handleToggleHidden}
          removedIds={removedIds}
          onRemove={removePlayer}
        />
      </div>

      {/* Draft Urgency. Ten targets counting down to my rank and to ADP,
          over the next ten picks in snake order. */}
      <DraftUrgencyRow urgency={urgency} currentPick={pickInfo.pickNum} removedIds={removedIds} onRemove={removePlayer} />

      {/* Season Totals. Arc = my total against my target; caption = my total
          against whoever leads the room, which is what turns a ring red.
          Bench players count at 75% for every manager — server/src/lib/roster.js. */}
      <div className="totals">
        <div className="totals__title">
          SEASON
          <br />
          TOTALS
        </div>
        <div className="totals__items">
          {targets.map((t) => (
            <TotalItem
              key={t.key}
              label={t.label.toUpperCase()}
              current={t.current}
              goal={t.goal}
              arcPct={t.pct}
              pctOfLeader={t.pctOfLeader}
              leader={t.leader}
            />
          ))}
          <TotalItem
            overall
            label="OVERALL"
            current={`${overall.pct}%`}
            arcPct={overall.pct}
            pctOfLeader={overall.pctOfLeader}
            leader={overall.leader}
          />
        </div>
      </div>

      <div className="wr-bottom">
        <section className="wr-panel wr-roster">
          <div className="wr-panel__head">
            <span className="wr-panel__title">MY ROSTER</span>
            <span className="wr-panel__note">{stillToFill(roster.slots)}</span>
          </div>
          <div className="wr-roster__grid wr-roster__grid--head">
            <RosterHeader />
            <RosterHeader />
          </div>
          <div className="wr-roster__grid wr-roster__grid--body">
            {[ROSTER_LEFT, ROSTER_RIGHT].map((order) => (
              <div className="wr-roster__col" key={order.join('')}>
                {rosterColumn(roster.slots, order).map((slot, i) => (
                  <RosterRow
                    key={`${slot.pos}-${i}`}
                    slot={slot}
                    drag={drag}
                    onDragStart={setDrag}
                    onDragEnd={() => setDrag(null)}
                    onDrop={handleRosterDrop}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
        <LivePicks pickInfo={pickInfo} liveFeed={liveFeed} />
      </div>
    </div>
  );
}
