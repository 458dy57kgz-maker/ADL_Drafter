import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import TradeTuning from '../components/TradeTuning.jsx';
import { formatRosterDate, formatImportedAt } from '../lib/useSeason.js';
import './SeasonWarRoom.css';
import './TradeFinder.css';

// The trade finder. Proposals down the middle, my trade block and my weak
// categories beside them. Every number here is on one scale — "value", the
// sum of a player's category z-scores — so my value, the market's and the
// gap between them can be read against each other directly.

const TUNE_STORAGE = 'adl.trades.tuneOpen';
// Long enough that dragging a slider doesn't fire a request per pixel.
const RETUNE_DELAY = 300;

function readTuneOpen() {
  try {
    return localStorage.getItem(TUNE_STORAGE) === '1';
  } catch {
    return false;
  }
}

function signed(n, digits = 1) {
  if (n == null) return '–';
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

// The gap from the market's side: "over" when managers rate him above me,
// "under" when below. Whether that's good depends on which way he's going,
// so the caller says which reading to highlight.
function GapChip({ gap, want }) {
  if (gap == null || Math.abs(gap) < 0.3) return <span className="gap-chip gap-chip--even">market agrees</span>;
  const over = gap > 0;
  const good = (want === 'over' && over) || (want === 'under' && !over);
  return (
    <span className={`gap-chip${good ? ' gap-chip--good' : ''}`} title="Market value minus my value">
      {over ? 'overrated' : 'underrated'} {signed(gap)}
    </span>
  );
}

function PlayerLine({ p, want }) {
  return (
    <div className="trade-player">
      <div className="trade-player__name">
        {p.name}
        {p.status && <span className="trade-player__status">{p.status}</span>}
      </div>
      <div className="trade-player__meta">
        {p.pos} · {p.team ?? '–'} · {p.slot ?? '–'}
        <span className="trade-player__values" title="My value / market value">
          {p.myValue?.toFixed(1) ?? '–'} / {p.marketValue?.toFixed(1) ?? '–'}
        </span>
      </div>
      <GapChip gap={p.gap} want={want} />
    </div>
  );
}

function reasonsFor(t) {
  const out = [];
  for (const p of t.get) if (p.gap != null && p.gap <= -1) out.push(`The market underrates ${p.name}`);
  for (const p of t.give) if (p.gap != null && p.gap >= 1) out.push(`The market overrates ${p.name}`);
  for (const p of t.give) if (p.luck != null && p.luck >= 0.5) out.push(`${p.name} is coming off a lucky season`);
  if (t.surplus >= 1) out.push('Depth to spare at the position');
  if (t.bench) out.push('They’re benching a player you’d start');
  for (const p of t.them.dropped) out.push(`They’d have to drop ${p.name}`);
  for (const p of t.me.dropped) out.push(`You’d drop ${p.name}`);
  return out;
}

function Acceptance({ accept, premium }) {
  const needs = `${(1 + premium).toFixed(2)}×`;
  if (accept.ratio == null) {
    return <span title="What they give up is at replacement level in the market's eyes">They lose nothing they’d miss</span>;
  }
  return (
    <span title="Market value they receive ÷ market value they give up">
      Their view: <strong>{accept.ratio.toFixed(2)}×</strong> <span className="trade-card__faint">(needs {needs})</span>
    </span>
  );
}

function ProposalCard({ t, categories, miss = false }) {
  const reasons = reasonsFor(t);
  return (
    <article className={`trade-card${miss ? ' trade-card--miss' : ''}`}>
      <header className="trade-card__head">
        <span className="trade-card__shape">{t.shape}</span>
        <span className="trade-card__team">with {t.team.name}</span>
        {miss && <span className="trade-card__miss">Short of what they’d take</span>}
        <span className="trade-card__gain" title="Change in your expected category points">
          You {signed(t.me.delta)} cat pts
        </span>
      </header>

      <div className="trade-card__sides">
        <div className="trade-card__side">
          <div className="trade-card__label">You get</div>
          {t.get.map((p) => (
            <PlayerLine key={p.key} p={p} want="under" />
          ))}
        </div>
        <div className="trade-card__arrow" aria-hidden="true">⇄</div>
        <div className="trade-card__side">
          <div className="trade-card__label">You send</div>
          {t.give.map((p) => (
            <PlayerLine key={p.key} p={p} want="over" />
          ))}
        </div>
      </div>

      <div className="trade-card__cats" role="table" aria-label="Change in your expected points by category">
        {categories.map((c) => {
          const d = t.me.byCat[c.key] ?? 0;
          const tone = d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat';
          return (
            <div key={c.key} className={`trade-cat trade-cat--${tone}`} role="cell">
              <span className="trade-cat__label">{c.label}</span>
              <span className="trade-cat__value">{signed(d)}</span>
            </div>
          );
        })}
      </div>

      <footer className="trade-card__foot">
        <Acceptance accept={t.accept} premium={t.premium} />
        <span title="Change in their expected category points">
          Their cat pts: <strong className={t.them.delta < 0 ? 'trade-card__neg' : undefined}>{signed(t.them.delta)}</strong>
        </span>
      </footer>
      {reasons.length > 0 && <p className="trade-card__why">{reasons.join(' · ')}</p>}
    </article>
  );
}

function TradeBlock({ sell, onToggleLock, busyKey }) {
  return (
    <section className="trade-panel">
      <div className="trade-panel__title">Your trade block</div>
      <div className="trade-panel__sub">
        Best pieces to offer first: players the market rates above you, and depth at a crowded position. Lock anyone
        you won’t move.
      </div>
      <ol className="trade-block">
        {sell.map((p) => (
          <li key={p.key} className={`trade-block__row${p.locked ? ' trade-block__row--locked' : ''}`}>
            <div className="trade-block__who">
              <span className="trade-block__name">{p.name}</span>
              <span className="trade-block__meta">
                {p.pos}
                {p.surplus > 0 ? ' · depth' : ''}
                {p.samePos ? ' · same position' : ''}
                {p.injured ? ' · injured list' : ''}
              </span>
            </div>
            <GapChip gap={p.gap} want="over" />
            <button
              type="button"
              className="trade-block__lock"
              aria-pressed={p.locked}
              disabled={busyKey === p.key}
              onClick={() => onToggleLock(p.key)}
            >
              {p.locked ? 'Locked' : 'Lock'}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Needs({ need, categories }) {
  const ordered = [...categories].sort((a, b) => (need[b.key] ?? 0) - (need[a.key] ?? 0));
  return (
    <section className="trade-panel">
      <div className="trade-panel__title">Where you’re weakest</div>
      <div className="trade-panel__sub">Weakest first; a longer bar is further from first place. Weak categories count extra in every trade.</div>
      <div className="trade-needs">
        {ordered.map((c) => (
          <div key={c.key} className="trade-needs__row">
            <span className="trade-needs__label">{c.label}</span>
            <span className="trade-needs__track">
              <span className="trade-needs__bar" style={{ width: `${Math.round((need[c.key] ?? 0) * 100)}%` }} />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

const MODES = [
  { key: 'scan', label: 'Open scan' },
  { key: 'target', label: 'Targeted' },
];

// Find the player I'm after: anyone on another team, by name.
function TargetPicker({ targets, onPick }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q ? targets.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8) : [];
  return (
    <div className="target-picker">
      <label htmlFor="target-search" className="trade__section-title">
        Who do you want?
      </label>
      <input
        id="target-search"
        type="text"
        className="pill-input target-picker__input"
        placeholder="Search players on other teams…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {q && (
        <ul className="target-picker__results">
          {matches.length === 0 && <li className="target-picker__none">No one on another team by that name.</li>}
          {matches.map((p) => (
            <li key={p.key}>
              <button type="button" className="target-picker__result" onClick={() => onPick(p.key)}>
                <span className="target-picker__name">{p.name}</span>
                <span className="target-picker__meta">
                  {p.pos} · {p.team ?? '–'} · {p.ownerName}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TargetHeader({ p, onClear }) {
  return (
    <div className="target-head">
      <div className="target-head__who">
        <div className="trade__section-title">Target</div>
        <div className="target-head__name">
          {p.name}
          {p.status && <span className="trade-player__status">{p.status}</span>}
        </div>
        <div className="trade-player__meta">
          {p.pos} · {p.team ?? '–'} · owned by {p.ownerName}
          <span className="trade-player__values" title="My value / market value">
            {p.myValue?.toFixed(1) ?? '–'} / {p.marketValue?.toFixed(1) ?? '–'}
          </span>
        </div>
      </div>
      <GapChip gap={p.gap} want="under" />
      <button type="button" className="btn btn-sm" onClick={onClear}>
        Change player
      </button>
    </div>
  );
}

export default function TradeFinder({ onNavigate, target = null, onTargetChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [tuneOpen, setTuneOpen] = useState(readTuneOpen);
  // The sliders' own copy of the weights: it moves the instant a slider does,
  // while the saved weights (and the proposals) catch up a moment later.
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState(target ? 'target' : 'scan');
  const timer = useRef(null);
  // The target as of the latest render, for requests fired from a timer.
  const targetRef = useRef(target);
  targetRef.current = target;
  // Only the latest request's answer is drawn, so a slow early one can't
  // land on top of a later one.
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++seq.current;
    try {
      const next = await api.getTrades(targetRef.current);
      if (id !== seq.current) return;
      setData(next);
      // A newer slider move still waiting to be saved wins over this answer.
      if (!timer.current) setDraft(next.weights);
      setError(null);
    } catch (err) {
      if (id === seq.current) setError(err);
    }
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  function toggleTune() {
    setTuneOpen((open) => {
      try {
        localStorage.setItem(TUNE_STORAGE, open ? '0' : '1');
      } catch {
        // Not remembered; still toggled.
      }
      return !open;
    });
  }

  function retune(weights) {
    setDraft(weights);
    setPending(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      try {
        await api.updateSettings('trade', { weights });
        await refetch();
      } finally {
        if (!timer.current) setPending(false);
      }
    }, RETUNE_DELAY);
  }

  // A target handed in from Players opens targeted mode on him.
  useEffect(() => {
    if (target) setMode('target');
    refetch();
  }, [target, refetch]);

  function changeMode(next) {
    setMode(next);
    if (next === 'scan' && target) onTargetChange(null);
  }

  async function toggleLock(key) {
    const locked = data.locked.includes(key) ? data.locked.filter((k) => k !== key) : [...data.locked, key];
    setBusyKey(key);
    try {
      await api.updateSettings('trade', { locked });
      await refetch();
    } finally {
      setBusyKey(null);
    }
  }

  if (error) {
    return (
      <div className="trade">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }
  if (!data) return <div className="trade trade__loading">Weighing trades…</div>;

  if (!data.ready) {
    return (
      <div className="trade">
        <header className="trade__head">
          <div className="trade__title">Trades</div>
        </header>
        <div className="card trade__empty">
          <div className="card-title">{data.reason === 'rosters' ? 'Start with the rosters' : 'Which team is yours?'}</div>
          <div className="card-subtitle">
            {data.reason === 'rosters'
              ? 'The trade finder works from every team’s roster. Import Yahoo’s Starting Rosters page on Teams first.'
              : 'Pick your team with the “Your team” selector on Teams, so the finder knows whose trades to find.'}
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('teams')}>
            Go to Teams
          </button>
        </div>
      </div>
    );
  }

  const { meta, me, categories, proposals = [], sell, defaults, targets } = data;
  // The answer on screen may still be for the previous target while the
  // next one loads; only draw it once it matches.
  const shown = data.target && data.target.player?.key === target ? data.target : null;
  return (
    <div className="trade">
      <header className="trade__head trade__head--split">
        <div>
          <div className="trade__title">Trades</div>
          <div className="trade__sub">
            {me.name} · rosters as of {formatRosterDate(meta.rosterDate) ?? 'an unknown date'} ·{' '}
            {meta.statsCount ? `stats imported ${formatImportedAt(meta.statsImportedAt)}` : 'no actual stats yet, so this runs on projections and reputation'}
          </div>
        </div>
        <div className="trade__controls">
          <div className="trade__modes" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={mode === m.key}
                className={`trade__mode${mode === m.key ? ' trade__mode--on' : ''}`}
                onClick={() => changeMode(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button type="button" className={`btn btn-sm${tuneOpen ? ' btn-primary' : ''}`} aria-expanded={tuneOpen} onClick={toggleTune}>
            {tuneOpen ? 'Hide tuning' : 'Tune'}
          </button>
        </div>
      </header>

      {tuneOpen && draft && (
        <TradeTuning weights={draft} defaults={defaults} pending={pending} onChange={retune} onReset={() => retune(defaults)} />
      )}

      <div className={`trade__layout${pending ? ' trade__layout--pending' : ''}`}>
        <section className="trade__proposals" aria-label="Proposals">
          {mode === 'scan' && (
            <>
              <div className="trade__section-title">
                Open scan <span className="trade__count">{proposals.length} proposals</span>
              </div>
              {proposals.length === 0 && (
                <div className="card">
                  No package clears both checks right now — nothing they’d accept that also helps you. Unlocking a player
                  or waiting for more games usually changes that.
                </div>
              )}
              {proposals.map((t, i) => (
                <ProposalCard key={i} t={t} categories={categories} />
              ))}
            </>
          )}

          {mode === 'target' && !target && <TargetPicker targets={targets} onPick={onTargetChange} />}

          {mode === 'target' && target && !shown && data.target?.missing && (
            <div className="card">
              That player isn’t on another team’s roster any more.{' '}
              <button type="button" className="swr__link" onClick={() => onTargetChange(null)}>
                Pick someone else
              </button>
            </div>
          )}
          {mode === 'target' && target && !shown && !data.target?.missing && <div className="trade__loading">Building packages…</div>}

          {mode === 'target' && shown && (
            <>
              <TargetHeader p={shown.player} onClear={() => onTargetChange(null)} />
              <div className="trade__section-title">
                Packages <span className="trade__count">{shown.viable.length} they’d accept that help you</span>
              </div>
              {shown.viable.length === 0 && (
                <div className="card">
                  Nothing from your trade block both clears their premium and helps your categories. The near misses below
                  show how close it gets.
                </div>
              )}
              {shown.viable.map((t, i) => (
                <ProposalCard key={i} t={t} categories={categories} />
              ))}
              {shown.closest.length > 0 && (
                <>
                  <div className="trade__section-title">
                    Near misses <span className="trade__count">would help you, but short of what they’d take</span>
                  </div>
                  {shown.closest.map((t, i) => (
                    <ProposalCard key={i} t={t} categories={categories} miss />
                  ))}
                </>
              )}
            </>
          )}
        </section>
        <aside className="trade__side">
          <Needs need={me.need} categories={categories} />
          <TradeBlock sell={sell} onToggleLock={toggleLock} busyKey={busyKey} />
        </aside>
      </div>
    </div>
  );
}
