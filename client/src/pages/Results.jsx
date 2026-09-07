import { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import './Results.css';

// The export. One row per drafted player, carrying every stat the app holds
// plus who took him and where he landed — the header order is the reading
// order of the Players grid, so a re-import of this file needs no reshuffling.
const CSV_COLUMNS = [
  ['Pick', (r) => r.player.pickNum],
  ['Round', (r) => r.player.round],
  ['Team', (r) => r.team],
  ['Draft Slot', (r) => r.slot],
  ['Roster Slot', (r) => r.pos],
  ['Bench', (r) => (r.onBench ? 'Y' : 'N')],
  ['Player', (r) => r.player.name],
  ['Pos', (r) => r.player.pos],
  ['NHL Team', (r) => r.player.team],
  ['Overall Rank', (r) => r.player.overallRank],
  ['Pos Rank', (r) => r.player.rank],
  ['ADP', (r) => r.player.adp],
  ['Diff', (r) => r.player.diff],
  ['Tier', (r) => r.player.tier],
  ['G', (r) => r.player.g],
  ['A', (r) => r.player.a],
  ['P', (r) => r.player.p],
  ['PPP', (r) => r.player.ppp],
  ['+/-', (r) => r.player.plusMinus],
  ['Shots', (r) => r.player.shots],
  ['Blocks', (r) => r.player.blocks],
  ['ONG', (r) => r.player.ong],
  ['GP', (r) => r.player.gp],
  ['VORP', (r) => r.player.vorp],
  ['W', (r) => r.player.w],
  ['GAA', (r) => r.player.gaa],
  ['SV', (r) => r.player.saves],
];

// Quote anything that could break a cell boundary. Names carry commas
// ("Smith, Jr.") often enough that this isn't theoretical.
function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(teams, orphanPicks) {
  const rows = [];
  for (const team of teams) {
    for (const row of team.rows) {
      if (row.player) rows.push({ ...row, team: team.name, slot: team.slot });
    }
  }
  for (const p of orphanPicks ?? []) {
    rows.push({ player: p, pos: '?', onBench: false, team: p.draftedBy, slot: '' });
  }
  // Draft order, not roster order — the file reads as a record of the draft.
  rows.sort((a, b) => (a.player.pickNum ?? Infinity) - (b.player.pickNum ?? Infinity));

  const lines = [CSV_COLUMNS.map(([label]) => csvCell(label)).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(','));
  return lines.join('\n');
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Results() {
  // Slower than the War Room's own poll: this page is a record, not a
  // decision surface, and it re-reads the whole pool each time.
  const { data, error } = usePolling(api.getDraftResults, 15, []);
  const [pending, setPending] = useState(false);

  const csv = useMemo(() => (data ? buildCsv(data.teams, data.orphanPicks) : ''), [data]);

  function handleDownload() {
    setPending(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      download(`adl-draft-results-${stamp}.csv`, csv);
    } finally {
      setPending(false);
    }
  }

  if (error) {
    return (
      <div className="results-page">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }

  if (!data) return <div className="results-page results-page__loading">Loading draft results…</div>;

  const { teams, totalPicks, benchWeight, orphanPicks } = data;

  return (
    <div className="results-page">
      <header className="results-page__header">
        <div>
          <div className="results-page__title">Results</div>
          <div className="results-page__sub">
            {totalPicks === 0
              ? 'No picks yet — this fills in as the draft runs, and empties again on reset.'
              : `${totalPicks} pick${totalPicks === 1 ? '' : 's'} across ${teams.length} teams · bench counts at ${Math.round(benchWeight * 100)}%`}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={pending || totalPicks === 0}
          title={totalPicks === 0 ? 'Nothing drafted yet' : 'Download every pick with full stats as CSV'}
        >
          Download CSV
        </button>
      </header>

      {teams.length === 0 && (
        <div className="card">No teams set up yet — add them in Settings &gt; League.</div>
      )}

      <div className="results-grid">
        {teams.map((team) => (
          <div className={`card results-team${team.isMine ? ' results-team--mine' : ''}`} key={team.slot}>
            <div className="results-team__head">
              <div className="results-team__name">
                <span className="mono results-team__slot">{team.slot}</span>
                {team.name}
                {team.isMine && <span className="results-team__you">YOU</span>}
              </div>
              <div className="mono results-team__pct" title="Average progress across the seven tracked categories">
                {team.overallPct}%
              </div>
            </div>
            {team.rows.map((row, i) => (
              <div className={`results-row${row.pos === 'BN' ? ' results-row--bench' : ''}`} key={i}>
                <div className="mono results-row__pos">{row.pos}</div>
                <div className="results-row__name" style={{ color: row.player ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                  {row.player ? row.player.name : 'empty'}
                </div>
                <div className="mono results-row__meta">{row.player ? row.player.pos : ''}</div>
                <div className="mono results-row__pick">{row.player?.pickNum ? `#${row.player.pickNum}` : ''}</div>
              </div>
            ))}
            {team.pickCount === 0 && <div className="results-team__empty">No picks yet</div>}
          </div>
        ))}
      </div>

      {orphanPicks?.length > 0 && (
        <div className="card results-orphans">
          <div className="card-title">Picks with no matching team</div>
          <div className="card-subtitle">
            These were drafted under a team name that is no longer in Settings &gt; League. They are still in the
            CSV export.
          </div>
          {orphanPicks.map((p) => (
            <div className="results-row" key={p.id}>
              <div className="mono results-row__pos">—</div>
              <div className="results-row__name">{p.name}</div>
              <div className="mono results-row__meta">{p.draftedBy}</div>
              <div className="mono results-row__pick">{p.pickNum ? `#${p.pickNum}` : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
