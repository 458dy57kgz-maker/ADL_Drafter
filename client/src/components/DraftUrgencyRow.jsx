import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/copyText.js';
import PlayerFlag from './PlayerFlag.jsx';
import './DraftUrgencyRow.css';

// Draft Urgency Row — ten cards, each counting the picks left until the clock
// reaches my own rank for a player (ME) and his average draft position (AV).
// Colour builds as either number closes in and flips once the clock passes it.
// Under the cards, the next ten picks in snake order slide left on every pick.
//
// Which ten players show, how long a drafted player lingers and the carousel's
// pick range all come from the server (server/src/routes/draft.js) — the only
// state here is what the user has dismissed by hand and the slide animation.

const PIPS = 10;
// One cell of eleven: the track sits one cell to the left at rest, so a new
// pick can be rendered from the previous one and animated into place.
const REST_SHIFT = 'translateX(-9.0909%)';

// Tone of the lit pips and, past due, of the whole cell. The bands are the
// design's: a fortnight of picks away is grey, the last round warms up, the
// last five are hot, and the pick itself and everything past it are red.
function tone(d) {
  if (d > 15) return 'var(--text-faint)';
  if (d > 5) return 'var(--accent-400)';
  if (d > 0) return 'var(--accent)';
  if (d === 0) return 'var(--accent-strong)';
  return 'var(--accent-900)';
}

function numeral(d) {
  if (d == null) return '—';
  if (d > 0) return String(d);
  if (d === 0) return '0';
  return `+${-d}`;
}

// Transparent until the clock reaches the number, then the cell itself fills:
// past due is loud on purpose, and it's the one state you can't miss.
function cellClass(d) {
  if (d == null) return '';
  if (d < 0) return ' urg__cell--past';
  if (d === 0) return ' urg__cell--now';
  return '';
}

// "Connor Hellebuyck" -> first "Connor", last "Hellebuyck". The card leads
// with the surname, which is how a draft room calls a player.
function splitName(name) {
  const parts = String(name ?? '').trim().split(/\s+/);
  if (parts.length < 2) return { first: '', last: parts[0] ?? '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-strong)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Pips({ d }) {
  const lit = d == null ? 0 : Math.min(Math.max(PIPS - d, 0), PIPS);
  const colour = d == null ? null : tone(d);
  return (
    <div className="urg__pips">
      {Array.from({ length: PIPS }, (_, i) => (
        <span key={i} className="urg__pip" style={i < lit ? { background: colour } : undefined} />
      ))}
    </div>
  );
}

// One countdown: the pick number it's counting to, how many picks are left,
// and a ten-pip fuse that fills over the last ten.
function Cell({ label, target, d, side }) {
  return (
    <div className={`urg__cell urg__cell--${side}${cellClass(d)}`}>
      <div className="urg__cell-label">
        {label}: {target ?? '—'}
      </div>
      <div className="urg__cell-num">{numeral(d)}</div>
      <Pips d={d} />
    </div>
  );
}

function Card({ card, currentPick, copied, onCopy, onRemove }) {
  const { first, last } = splitName(card.name);
  const dMe = card.myRank - currentPick;
  const dAv = card.adp == null ? null : card.adp - currentPick;
  const dMin = dAv == null ? dMe : Math.min(dMe, dAv);
  const drafted = card.draftedAt != null && card.draftedAt <= currentPick;

  let tint = '';
  if (dMin < 0) tint = ' urg__card--hot';
  else if (dMin <= 5) tint = ' urg__card--warm';

  return (
    <div className={`urg__card${tint}`}>
      <div className="urg__head">
        <div className="urg__name-row">
          <span className="urg__last" title={card.name}>
            {last}
          </span>
          <PlayerFlag flag={card.flag} />
          <button
            type="button"
            className="urg__copy"
            title={copied ? 'Copied' : `Copy "${card.name}" to the clipboard`}
            aria-label={copied ? `Copied ${card.name}` : `Copy ${card.name} to the clipboard`}
            onClick={() => onCopy(card)}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <div className="urg__sub">
          <span className="urg__first">{first}</span>
          <span className="urg__pos">· {card.pos}</span>
        </div>
      </div>

      <div className="urg__cells">
        <Cell label="ME" target={card.myRank} d={dMe} side="me" />
        <Cell label="AV" target={card.adp} d={dAv} side="av" />
      </div>

      {drafted && (
        <div className="urg__locked">
          <div className="urg__locked-top">
            <span className="urg__tag">DRAFTED</span>
            <button
              type="button"
              className="urg__remove"
              title="Remove from the row"
              aria-label={`Remove ${card.name} from the row`}
              onClick={() => onRemove(card.id)}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="urg__locked-name">
            <span className="urg__locked-last">
              {last}
              <PlayerFlag flag={card.flag} />
            </span>
            <span className="urg__locked-first">{first}</span>
          </div>
          <div className="urg__locked-team">→ {card.draftedBy ?? '—'}</div>
          {/* Where he actually went, against the field's number and mine —
              the whole reason a taken player stays up for a few picks. */}
          <div className="urg__locked-foot">
            <span className="urg__locked-pick">Pick {card.draftedAt}</span>
            <span>
              AV {card.adp ?? '—'} · ME {card.myRank}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// `removedIds` / `onRemove` are owned by the War Room so clearing a drafted
// player here clears him from his board column too.
export default function DraftUrgencyRow({ urgency, currentPick, removedIds, onRemove }) {
  const removed = removedIds ?? new Set();
  const [copiedId, setCopiedId] = useState(null);
  // 'rest' and 'run' both sit one cell left; 'reset' is the single frame
  // rendered from the previous pick, before the slide.
  const [phase, setPhase] = useState('rest');
  const prevPick = useRef(currentPick);
  const copyTimer = useRef(null);
  const frames = useRef([]);

  // A pick landed: draw the track one cell to the right (so nothing appears
  // to move), then release it on the next frame and let it slide. Anything
  // other than a single step — a reset, a reconnect, a scrub — snaps.
  useEffect(() => {
    const prev = prevPick.current;
    prevPick.current = currentPick;
    if (currentPick === prev) return;
    if (currentPick !== prev + 1) {
      setPhase('rest');
      return;
    }
    setPhase('reset');
    frames.current.push(
      requestAnimationFrame(() => {
        frames.current.push(requestAnimationFrame(() => setPhase('run')));
      })
    );
  }, [currentPick]);

  useEffect(
    () => () => {
      frames.current.forEach(cancelAnimationFrame);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  if (!urgency) return null;
  const { cards = [], slate = [], shown = 10 } = urgency;

  async function handleCopy(card) {
    let ok = false;
    try {
      ok = await copyText(card.name);
    } catch {
      ok = false;
    }
    // No confirmation tick unless the name actually made it to the clipboard.
    if (!ok) return;
    setCopiedId(card.id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1200);
  }

  const visible = cards.filter((c) => !removed.has(c.id)).slice(0, shown);
  // The grid is always ten columns wide, so a short list pads rather than
  // letting the frame's divider ground show through as a black block.
  const fillers = Math.max(0, shown - visible.length);

  return (
    <section className="urg" aria-label="Draft urgency">
      <div className="urg__grid">
        {visible.map((card) => (
          <Card
            key={card.id}
            card={card}
            currentPick={currentPick}
            copied={copiedId === card.id}
            onCopy={handleCopy}
            onRemove={onRemove}
          />
        ))}
        {Array.from({ length: fillers }, (_, i) => (
          <div className="urg__card urg__card--empty" key={`filler-${i}`} />
        ))}
      </div>

      <div className="urg__carousel">
        <div
          className={`urg__track${phase === 'run' ? ' urg__track--run' : ''}`}
          style={{ transform: phase === 'reset' ? 'translateX(0)' : REST_SHIFT }}
        >
          {slate.map((s) => {
            const onClock = s.pickNum === currentPick;
            let cls = '';
            if (s.isMine) cls = ' urg__seat--mine';
            else if (onClock) cls = ' urg__seat--clock';
            return (
              <div className={`urg__seat${cls}`} key={s.pickNum}>
                <span className="urg__seat-label">{s.team ? (onClock ? 'On the clock' : `Pick ${s.pickNum}`) : ''}</span>
                <span className="urg__seat-team">{s.team ? (s.isMine ? 'You' : s.team) : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
