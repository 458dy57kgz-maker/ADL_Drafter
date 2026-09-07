import './DraftBoard.css';

// The four wait states, in the mockup's own language. `overdue` is gold rather
// than red on purpose: a player who has fallen past his ADP is a value signal,
// not a warning.
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
              </div>
              <div className="scarcity-pills">
                <span className="mini-pill t1">{col.counts.t1} T1</span>
                <span className="mini-pill t2">{col.counts.t2} T2</span>
                <span className="mini-pill total">{col.counts.total} left</span>
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

      <div className="legend">
        <b>Reading it:</b>
        <span className="lg-item">
          <span className="dot dot--tier1" /> Already overdue — ADP has already passed; he fell, grab or flip him now
        </span>
        <span className="lg-item">
          <span className="dot dot--danger" /> Likely gone by your next pick — ADP sits between now and then
        </span>
        <span className="lg-item">
          <span className="dot dot--risk" /> Wait = risky — ADP is close to that gap's edge
        </span>
        <span className="lg-item">
          <span className="dot dot--safe" /> Safe to wait — ADP has real room past your next pick
        </span>
        <span className="lg-item">Tags = top 2 categories this player moves most</span>
        <span className="lg-item">ONG = share of games on off-nights (higher starts more often)</span>
        <span className="lg-item">
          <span className="dot dot--cliff" /> Dashed line = talent cliff
        </span>
      </div>
    </div>
  );
}
