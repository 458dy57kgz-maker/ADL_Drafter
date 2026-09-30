import './TradeTuning.css';

// The trade finder's knobs, grouped by what they change. Each one is a
// field of DEFAULT_WEIGHTS in server/src/lib/trade.js; the copy says what
// moving it does, not what it's called in the code.
const GROUPS = [
  {
    title: 'What makes a good proposal',
    controls: [
      { key: 'need', label: 'Category need', hint: 'Extra weight on categories where you rank low', min: 0, max: 3, step: 0.1 },
      { key: 'gap', label: 'Market edge', hint: 'Sending players the market overrates, getting ones it underrates', min: 0, max: 3, step: 0.1 },
      { key: 'surplus', label: 'Positional depth', hint: 'Their depth at what you get, yours at what you send', min: 0, max: 3, step: 0.1 },
      { key: 'bench', label: 'Benched talent', hint: 'A good player they’re not starting — a weak signal', min: 0, max: 3, step: 0.1 },
      { key: 'premium', label: 'Owner premium', hint: 'How much more market value an owner needs back', min: 0, max: 0.6, step: 0.05, format: (v) => `+${Math.round(v * 100)}%` },
    ],
  },
  {
    title: 'How the market sees a player',
    controls: [
      { key: 'marketGames', label: 'Market follows this season', hint: 'Games until this season counts as much as reputation', min: 2, max: 40, step: 1, format: (v) => `${v} GP` },
      { key: 'adpShare', label: 'ADP vs three-year line', hint: 'Before the season: share of the market view that is ADP', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}% ADP` },
    ],
  },
  {
    title: 'How I see a player',
    controls: [
      { key: 'trustGames', label: 'Trust actual stats', hint: 'Games until his actual pace counts as much as my projection', min: 10, max: 120, step: 5, format: (v) => `${v} GP` },
      { key: 'luck', label: 'Luck discount', hint: 'How hard a lucky last season marks down my value', min: 0, max: 2, step: 0.1 },
    ],
  },
];

const POSITIONS = ['C', 'LW', 'RW', 'D', 'G'];
const plain = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function Slider({ id, label, hint, value, fallback, min, max, step, format = plain, onChange }) {
  const changed = Math.abs(value - fallback) > 1e-9;
  return (
    <div className="tune-slider">
      <label htmlFor={id} className="tune-slider__label">
        {label}
        {changed && <span className="tune-slider__dot" title={`Default ${format(fallback)}`} />}
      </label>
      <output htmlFor={id} className="tune-slider__value">
        {format(value)}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="tune-slider__hint">{hint}</div>}
    </div>
  );
}

export default function TradeTuning({ weights, defaults, onChange, onReset, pending }) {
  const set = (key, value) => onChange({ ...weights, [key]: value });
  const setPos = (pos, value) => onChange({ ...weights, pos: { ...weights.pos, [pos]: value } });
  const anyChanged =
    Object.keys(defaults).some((k) => k !== 'pos' && weights[k] !== defaults[k]) ||
    POSITIONS.some((p) => weights.pos[p] !== defaults.pos[p]);

  return (
    <section className="tune" aria-label="Tune the trade finder">
      <div className="tune__head">
        <div className="tune__title">Tune the finder</div>
        <span className="tune__status" aria-live="polite">
          {pending ? 'Re-ranking…' : 'Saved — proposals follow every change'}
        </span>
        <button type="button" className="btn btn-sm" onClick={onReset} disabled={!anyChanged}>
          Reset to defaults
        </button>
      </div>
      <div className="tune__groups">
        {GROUPS.map((g) => (
          <div key={g.title} className="tune__group">
            <div className="tune__group-title">{g.title}</div>
            {g.controls.map((c) => (
              <Slider
                key={c.key}
                id={`tune-${c.key}`}
                {...c}
                value={weights[c.key]}
                fallback={defaults[c.key]}
                onChange={(v) => set(c.key, v)}
              />
            ))}
          </div>
        ))}
        <div className="tune__group">
          <div className="tune__group-title">Position weight</div>
          <div className="tune-slider__hint tune__pos-hint">
            Turn a position down if the proposals lean on it too much, up to go looking for it.
          </div>
          {POSITIONS.map((pos) => (
            <Slider
              key={pos}
              id={`tune-pos-${pos}`}
              label={pos}
              value={weights.pos[pos]}
              fallback={defaults.pos[pos]}
              min={0}
              max={2}
              step={0.1}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={(v) => setPos(pos, v)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
