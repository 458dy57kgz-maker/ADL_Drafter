import { api } from '../lib/api.js';
import { useSeason, formatRosterDate, formatImportedAt } from '../lib/useSeason.js';
import { RosterImportButton } from '../components/SeasonImports.jsx';
import PlayerFlag from '../components/PlayerFlag.jsx';
import './Results.css';
import './Teams.css';

// Seats whose players don't count for the team this week.
const INACTIVE = ['IR', 'IR+', 'NA'];

function rowClass(slot) {
  if (slot === 'BN') return ' results-row--bench';
  if (INACTIVE.includes(slot)) return ' results-row--inactive';
  return '';
}

// The right-hand number: points so far once stats are in, otherwise the
// projection, set quieter so the two are never mistaken for each other.
function pointsCell(player, hasStats) {
  if (!player) return null;
  if (hasStats) {
    const p = player.act?.p;
    return <span title="Points this season">{p ?? '–'}</span>;
  }
  const p = player.proj?.p;
  return p == null ? null : (
    <span className="teams-row__proj" title="Projected points">
      {p}
    </span>
  );
}

export function SavePageHelp({ leagueId }) {
  const url = leagueId
    ? `hockey.fantasysports.yahoo.com/hockey/${leagueId}/startingrosters`
    : 'hockey.fantasysports.yahoo.com/hockey/<league>/startingrosters';
  return (
    <ol className="teams-help">
      <li>
        Open <span className="mono">{url}</span> in your browser.
      </li>
      <li>Save the page — File › Save Page As, format “Webpage, HTML Only”.</li>
      <li>Import that file here. Do it again whenever rosters change; each import replaces the last.</li>
    </ol>
  );
}

export default function Teams() {
  const { data, error, refetch } = useSeason();

  if (error) {
    return (
      <div className="results-page">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }
  if (!data) return <div className="results-page results-page__loading">Loading teams…</div>;

  const { meta, teams } = data;
  const hasStats = meta.statsCount > 0;

  async function handleMine(e) {
    const value = e.target.value;
    await api.updateSettings('season', { myTeamNum: value === '' ? null : Number(value) });
    refetch();
  }

  return (
    <div className="results-page">
      <header className="results-page__header">
        <div>
          <div className="results-page__title">Teams</div>
          <div className="results-page__sub">
            {teams.length
              ? `Rosters as of ${formatRosterDate(meta.rosterDate) ?? 'an unknown date'} · imported ${formatImportedAt(meta.rostersImportedAt)} · ${
                  hasStats ? 'points this season' : 'projected points until stats are imported'
                }`
              : 'No rosters yet — import the Starting Rosters page from Yahoo.'}
          </div>
        </div>
        <div className="teams-controls">
          {teams.length > 0 && (
            <label className="teams-mine">
              <span>Your team</span>
              <select className="pill-select" value={meta.myTeamNum ?? ''} onChange={handleMine}>
                <option value="">— not set —</option>
                {teams.map((t) => (
                  <option key={t.num} value={t.num}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <RosterImportButton onImported={refetch} primary={!teams.length} />
        </div>
      </header>

      {teams.length === 0 && (
        <div className="card teams-empty">
          <div className="card-title">Getting rosters from Yahoo</div>
          <SavePageHelp leagueId={meta.leagueId} />
        </div>
      )}

      <div className="results-grid">
        {teams.map((team) => (
          <div className={`card results-team${team.isMine ? ' results-team--mine' : ''}`} key={team.num}>
            <div className="results-team__head">
              <div className="results-team__name">
                <span className="mono results-team__slot">{team.num}</span>
                {team.name}
                {team.isMine && <span className="results-team__you">YOU</span>}
              </div>
              <div className="mono results-team__pct" title="Players on the roster, injured lists included">
                {team.playerCount}
              </div>
            </div>
            {team.rows.map((row, i) => (
              <div className={`results-row teams-row${rowClass(row.slot)}`} key={i}>
                <div className="mono results-row__pos">{row.slot}</div>
                <div
                  className="results-row__name teams-row__name"
                  style={{ color: row.player ? 'var(--text-primary)' : 'var(--text-faint)' }}
                  title={row.player && !row.player.id ? 'Not in your player list — no projections for him' : undefined}
                >
                  <span className="teams-row__text">{row.player ? row.player.name : 'empty'}</span>
                  {row.player && <PlayerFlag flag={row.player.flag} />}
                  {row.player?.status && <span className="teams-row__status">{row.player.status}</span>}
                </div>
                <div className="mono results-row__meta">
                  {row.player ? `${row.player.team ?? ''} ${row.player.pos ?? ''}`.trim() : ''}
                </div>
                <div className="mono results-row__pick">{pointsCell(row.player, hasStats)}</div>
              </div>
            ))}
            {team.playerCount === 0 && <div className="results-team__empty">Nobody on this roster</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
