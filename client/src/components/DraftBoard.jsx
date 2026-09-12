import { useEffect, useRef, useState } from 'react';
import './DraftBoard.css';

// Best Available, drawn as the wireframe's option 2a: five flat columns of
// ruled rows rather than boxed cards, with a left "price gutter" that prints
// how far your own rank for a player sits from where the room takes him, in
// rounds. That figure is what separates a player worth chasing from one the
// room is simply bidding past you on, so it gets the biggest type on the card;
// everything that says "take someone else" recedes.

// Two independent readings per card — will he last (availability) and is he
// worth it (price) — crossed into one verdict on the server. Weight, not hue:
// Modernist is mono red on a light ground, and here red is spent on
// opportunity, so a named pick carries it, plain availability is ink, and
// anything to leave alone recedes to grey.
const WAIT = {
  takehim: { cls: 'lastcall', label: 'TAKE HIM' },
  gone: { cls: 'gone', label: 'LIKELY GONE' },
  risky: { cls: 'risky', label: 'WAIT = RISKY' },
  safe: { cls: 'safe', label: 'SAFE TO WAIT' },
  letgo: { cls: 'letgo', label: 'LET HIM GO' },
};

// 'takeat' names one of your own picks, so its label is built per card. Only
// one player on the whole board ever carries a given pick number — the plan
// hands each pick to exactly one man.
function waitFor(card) {
  if (card.status === 'takeat' && card.takeAt != null) {
    return { cls: 'takeat', label: `TAKE AT ${card.takeAt}` };
  }
  return card.status ? WAIT[card.status] ?? null : null;
}

// Signed, one decimal, in rounds. Only ever printed outside the fair band —
// inside half a round you and the room agree, and a mark there is noise.
function priceText(diff) {
  return diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
}

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
  const wait = waitFor(card);
  const showOng = card.ongPct != null && card.ongPct >= ONG_FLOOR;
  // Inside the fair band the card carries no price mark at all.
  const showPrice = card.diff != null && card.band && card.band !== 'fair';
  const bargain = card.band === 'steal' || card.band === 'value';
  const strong = card.band === 'steal' || card.band === 'overpay';
  const priceCls = showPrice
    ? ` bcard__price--${bargain ? 'good' : 'bad'}${strong ? ' bcard__price--strong' : ''}`
    : '';
  // "Safe to wait" and "let him go" are the same instruction: spend this pick
  // on someone else.
  const quiet = card.status === 'safe' || card.status === 'letgo';

  return (
    <div className={`bcard${quiet ? ' bcard--quiet' : ''}`}>
      <div className="bcard__gutter">
        <span className={`bcard__price${priceCls}`}>{showPrice ? priceText(card.diff) : ''}</span>
        <span className="bcard__price-label">{showPrice ? 'RD' : ''}</span>
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
