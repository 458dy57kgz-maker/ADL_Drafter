import './PlayerFlag.css';

// My own note on a player, set in the Players grid and drawn beside his name
// everywhere in the War Room. Three shapes rather than three colours: the
// accent red already means "opportunity" on this page, and a red "avoid"
// would say the opposite of everything else painted red.

export const PLAYER_FLAGS = [
  { key: 'sleeper', label: 'Sleeper' },
  { key: 'avoid', label: 'Avoid' },
  { key: 'favourite', label: 'Favourite' },
];

const LABEL = Object.fromEntries(PLAYER_FLAGS.map((f) => [f.key, f.label]));

// Two z's, the smaller trailing off — the drowsy shorthand, drawn as strokes
// so it stays crisp at 11px rather than relying on a text glyph.
function SleeperIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M7 2.5h6l-6 6h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 9.5h4l-4 4h4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The road sign: a triangle standing on its point.
function AvoidIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path d="M1.6 2.4h12.8L8 14z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 5.4v3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r="0.85" fill="currentColor" />
    </svg>
  );
}

// Filled, so the one flag that means "I want him" is the one that reads
// solid at a glance.
function FavouriteIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M8 1.3 10.1 5.6 14.8 6.3 11.4 9.6 12.2 14.3 8 12.1 3.8 14.3 4.6 9.6 1.2 6.3 5.9 5.6z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS = { sleeper: SleeperIcon, avoid: AvoidIcon, favourite: FavouriteIcon };

export default function PlayerFlag({ flag }) {
  const Icon = flag ? ICONS[flag] : null;
  if (!Icon) return null;
  return (
    <span className={`pflag pflag--${flag}`} title={LABEL[flag]} aria-label={LABEL[flag]} role="img">
      <Icon />
    </span>
  );
}
