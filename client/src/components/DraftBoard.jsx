import { useEffect, useRef, useState } from 'react';
import './DraftBoard.css';

// Best Available, drawn as the wireframe's option 2a: five flat columns of
// ruled rows rather than boxed cards, with a left "value gutter" that prints
// how far past his ADP an overdue player has fallen. That figure is the only
// thing that ranks several overdue players against each other, so it gets the
// biggest type on the card; everything that says "take someone else" recedes.

// Status by weight, not hue — Modernist is mono red on a light ground, so
// "likely gone" and overdue carry the red, risky is ink, safe is quiet grey.
const WAIT = {
  overdue: { cls: 'value', label: 'OVERDUE — VALUE' },
  gone: { cls: 'gone', label: 'LIKELY GONE' },
  risky: { cls: 'risky', label: 'WAIT = RISKY' },
  safe: { cls: 'safe', label: 'SAFE TO WAIT' },
};

// A position this thin is printed in red. Same threshold as the wireframe.
const LOW_LEFT = 7;

// Off-night share worth acting on. Below it the figure isn't printed at all
// rather than printed quietly — the wireframe's rule.
export const ONG_FLOOR = 44;

function tierLine(col) {
  const parts = col.counts.tiers.map((t) => `${t.count} T${t.tier}`);
  const text = parts.length ? `${parts.join(' · ')} left` : '';
  const full = col.sub?.kind === 'roster';
  return full ? `${text}${text ? ' · ' : ''}full` : text;
}

// "30G  50A" — the two categories he moves furthest, packed the way the
// wireframe packs them.
function catsText(cats) {
  return cats.map((c) => c.text.replace(' ', '')).join('   ');
}

// Copy the name so it can go straight into Yahoo's own search box. The
// Clipboard API needs a secure context, which the NAS deployment has over
// Tailscale but a bare-http dev origin does not, so fall back to a hidden
// textarea + execCommand rather than failing silently on http://.
function legacyCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

async function copyText(text) {
  // The Clipboard API can also reject on a secure origin — an unfocused
  // document is enough — so a rejection falls through to the old path rather
  // than ending the attempt.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  return legacyCopy(text);
}

export function CopyIcon({ done = false }) {
  return done ? (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3 8.6 6.2 12 13 4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="5.5" y="2.5" width="8" height="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 13.5H2.5V5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CopyName({ name }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function handleCopy() {
    let ok = false;
    try {
      ok = await copyText(name);
    } catch {
      ok = false;
    }
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 3000);
  }

  return (
    <button
      type="button"
      className={`bcard__copy${copied ? ' bcard__copy--done' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied' : `Copy "${name}" to the clipboard`}
      aria-label={copied ? `Copied ${name}` : `Copy ${name} to the clipboard`}
    >
      <CopyIcon done={copied} />
    </button>
  );
}

function Card({ card }) {
  const wait = card.status ? WAIT[card.status] : null;
  const past = card.status === 'overdue' && card.picksAgo != null;
  const showOng = card.ongPct != null && card.ongPct >= ONG_FLOOR;

  return (
    <div className={`bcard${card.status === 'safe' ? ' bcard--quiet' : ''}`}>
      <div className="bcard__gutter">
        <span className="bcard__value">{past ? `+${card.picksAgo}` : ''}</span>
        <span className="bcard__value-label">{past ? 'PAST' : ''}</span>
        <span className="bcard__rank">{card.overallRank != null ? `#${card.overallRank}` : ''}</span>
      </div>
      <div className="bcard__body">
        <div className="bcard__row">
          <span className="bcard__name" title={card.name}>
            {card.name}
          </span>
          <CopyName name={card.name} />
          <span className="bcard__tier">{card.tier != null ? `T${card.tier}` : ''}</span>
        </div>
        <div className="bcard__row bcard__row--sub">
          <span className="bcard__cats">{catsText(card.cats)}</span>
          {/* Dropped rather than shown as 0% when there's no data — a wrong
              percentage reads exactly like a real one. */}
          {showOng && <span className="bcard__ong">ONG {card.ongPct}%</span>}
        </div>
        <div className="bcard__row bcard__row--sub">
          <span className="bcard__adp">ADP {card.adp ?? '—'}</span>
          {wait && <span className={`bcard__wait bcard__wait--${wait.cls}`}>{wait.label}</span>}
        </div>
      </div>
    </div>
  );
}

export default function DraftBoard({ board }) {
  if (!board) return null;

  return (
    <div className="draft-board">
      {board.columns.map((col) => (
        <div className="bcol" key={col.pos}>
          <div className="bcol__head">
            <span className="bcol__pos">{col.pos}</span>
            <span
              className={`bcol__left${col.counts.total <= LOW_LEFT ? ' bcol__left--low' : ''}`}
              title={`${col.counts.total} still available at ${col.pos} — ${col.counts.taken} drafted`}
            >
              {col.counts.total}
            </span>
            <span className="bcol__left-label">LEFT</span>
            <span className="bcol__spacer" />
            <span className="bcol__tiers" title={col.sub?.text}>
              {tierLine(col)}
            </span>
          </div>
          <div className="bcol__cards">
            {col.cards.map((card, i) => (
              <div key={card.id}>
                <Card card={card} />
                {/* The talent cliff: a solid accent rule under the last card
                    before the tier drops. Red is spent on this and on value,
                    nothing else. */}
                {col.cliffAfter === i && <div className="bcard-cliff" role="separator" aria-label="Talent cliff" />}
              </div>
            ))}
            {col.cards.length === 0 && <div className="bcol__empty">Nobody left at {col.pos}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
