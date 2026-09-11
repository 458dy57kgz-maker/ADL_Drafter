import { useEffect, useRef, useState } from 'react';
import { scarcityStyle } from '../lib/scarcity.js';
import './DraftBoard.css';

// The four wait states, in the mockup's own language. `overdue` and `gone`
// share the same accent-strong red in the Modernist palette — the source
// design spends red on exactly two things (the cliff, and value like this),
// so overdue and danger read the same color and the numeric gutter carries
// the real distinction between them.
const WAIT = {
  overdue: { cls: 'value', label: 'Already overdue' },
  gone: { cls: 'danger', label: 'Likely gone' },
  risky: { cls: 'risk', label: 'Wait = risky' },
  safe: { cls: 'safe', label: 'Safe to wait' },
};

// Where an off-night share stops being ordinary and starts being a reason to
// prefer a player — matches the mockup, which highlights 44% and up.
const ONG_HIGH = 44;

function tierClass(tier) {
  if (tier == null) return null;
  return `t${Math.min(tier, 3)}`;
}

function adpLine(card) {
  if (card.adp == null) return <span className="adp-line">ADP —</span>;
  return (
    <span className="adp-line">
      ADP <span className="adp-num">{card.adp}</span>
      {card.picksAgo != null
        ? ` · ${card.picksAgo} pick${card.picksAgo === 1 ? '' : 's'} ago`
        : card.overallRank != null
          ? ` · you ${card.overallRank}`
          : ''}
    </span>
  );
}

// How much of this position's board is still on it, as a ring that drains
// toward empty. The colour is the same three-step scarcity scale the app has
// always used, so the ring reads at a glance even before the number does.
function LeftRing({ left, taken, pos }) {
  const total = left + taken;
  const pct = total ? Math.round((left / total) * 100) : 0;
  const style = scarcityStyle(left);
  return (
    <span
      className="left-ring"
      style={{ '--pct': pct, '--ring-color': style.fg }}
      title={`${left} of ${total} still available at ${pos}${taken ? ` — ${taken} drafted` : ''}`}
      role="img"
      aria-label={`${left} players left at ${pos}`}
    >
      <span className="left-ring__inner">
        <span className="left-ring__num mono">{left}</span>
        <span className="left-ring__label">LEFT</span>
      </span>
    </span>
  );
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
      className={`card-copy${copied ? ' card-copy--done' : ''}`}
      onClick={handleCopy}
      title={copied ? 'Copied' : `Copy "${name}" to the clipboard`}
      aria-label={copied ? `Copied ${name}` : `Copy ${name} to the clipboard`}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M3 8.6 6.2 12 13 4.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <rect x="5.5" y="2.5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 13.5H4a1.5 1.5 0 0 1-1.5-1.5V5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function Card({ card, tracked, onToggleTrack }) {
  const wait = card.status ? WAIT[card.status] : null;
  const classes = ['card'];
  if (card.status === 'overdue') classes.push('value');
  else if (card.suggested) classes.push('suggested');

  return (
    <div className={classes.join(' ')}>
      <div className="card-top">
        <span className="rank-badge">#{card.rank}</span>
        <span className="name" title={card.name}>
          {card.name}
        </span>
        <CopyName name={card.name} />
        {card.tier != null && <span className={`tier-chip ${tierClass(card.tier)}`}>T{card.tier}</span>}
        {card.status === 'overdue' && <span className="value-flag">★ VALUE</span>}
        {/* Not in the mockup. The board replaced the only place in the app
            that could star a player, and the Tracked Players panel would have
            had no way to fill up without it. */}
        <button
          type="button"
          className={`card-star${tracked ? ' card-star--on' : ''}`}
          onClick={() => onToggleTrack(card.id, tracked)}
          title={tracked ? 'Stop tracking' : 'Track this player'}
          aria-pressed={tracked}
        >
          {tracked ? '★' : '☆'}
        </button>
      </div>

      <div className="card-mid">
        <span className="cat-tags">
          {card.cats.map((c) => (
            <span className="cat-tag" key={c.key}>
              {c.text}
            </span>
          ))}
        </span>
        {/* Dropped entirely rather than shown as 0% when the player has no
            off-night data — a wrong percentage reads exactly like a real one. */}
        {card.ongPct != null && (
          <span className={`ong${card.ongPct >= ONG_HIGH ? ' high' : ''}`}>ONG {card.ongPct}%</span>
        )}
      </div>

      <div className="card-bottom">
        {adpLine(card)}
        {wait && <span className={`wait-chip ${wait.cls}`}>{wait.label}</span>}
      </div>
    </div>
  );
}

export default function DraftBoard({ board, trackedFor, onToggleTrack }) {
  if (!board) return null;

  return (
    <div className="draft-board">
      <div className="board">
        {board.columns.map((col) => (
          <div className="col" key={col.pos}>
            <div className="col-head">
              <div className="col-head-row">
                <span className="pos">{col.pos}</span>
                {/* Only tiers that still have somebody in them. "0 T1" was a
                    fact about the past taking up room that the next live tier
                    can use. */}
                <span className="scarcity-pills">
                  {col.counts.tiers.map((t) => (
                    <span className={`mini-pill ${tierClass(t.tier)}`} key={t.tier}>
                      {t.count} T{t.tier}
                    </span>
                  ))}
                </span>
                <LeftRing left={col.counts.total} taken={col.counts.taken} pos={col.pos} />
              </div>
              <div className="sub">{col.sub.text}</div>
            </div>
            <div className="cards">
              {col.cards.map((card, i) => (
                <div className="card-slot" key={card.id}>
                  <Card card={card} tracked={trackedFor(card)} onToggleTrack={onToggleTrack} />
                  {col.cliffAfter === i && (
                    <div className="cliff">
                      <span className="line" />
                      <span className="label">TALENT CLIFF</span>
                      <span className="line" />
                    </div>
                  )}
                </div>
              ))}
              {col.cards.length === 0 && <div className="col-empty">Nobody left at {col.pos}</div>}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
