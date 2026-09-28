import { useMemo, useState } from 'react';
import { useSeason, formatRosterDate, formatImportedAt } from '../lib/useSeason.js';
import './SeasonWarRoom.css';

// The in-season War Room. For now one table: every team's totals in each
// category, ranked, actual by default with the draft-style projection one
// click away. "Cat pts" is a rotisserie reading — ten for first in a
// category down to one for last — which is a quick way to see who is strong
// across the board and who is winning on one or two categories.

const VIEWS = [
  { key: 'actual', label: 'Actual' },
  { key: 'projected', label: 'Projected' },
];

export default function SeasonWarRoom({ onNavigate }) {
  const { data, error } = useSeason();
  const [view, setView] = useState('actual');

  const table = useMemo(() => {
    if (!data) return [];
    const n = data.teams.length;
    const ranksKey = view === 'actual' ? 'actualRanks' : 'projectedRanks';
    return data.teams
      .map((t) => ({
        ...t,
        totals: t[view],
        ranks: t[ranksKey],
        catPts: data.categories.reduce((sum, c) => sum + (n + 1 - t[ranksKey][c.key]), 0),
      }))
      .sort((a, b) => b.catPts - a.catPts || a.num - b.num);
  }, [data, view]);

  if (error) {
    return (
      <div className="swr">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }
  if (!data) return <div className="swr swr__loading">Loading season…</div>;

  const { meta, categories, teams, benchWeight } = data;
  const hasStats = meta.statsCount > 0;
  const n = teams.length;

  return (
    <div className="swr">
      <header className="swr__head">
        <div>
          <div className="swr__title">Season</div>
          <div className="swr__sub">
            {teams.length
              ? `Rosters as of ${formatRosterDate(meta.rosterDate) ?? 'an unknown date'} · ${
                  hasStats ? `stats imported ${formatImportedAt(meta.statsImportedAt)}` : 'no actual stats yet'
                }`
              : 'Nothing to total yet'}
          </div>
        </div>
        {teams.length > 0 && (
          <div className="swr__views" role="radiogroup" aria-label="Totals">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="radio"
                aria-checked={view === v.key}
                className={`swr__view${view === v.key ? ' swr__view--on' : ''}`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {teams.length === 0 && (
        <div className="card swr__empty">
          <div className="card-title">Start with the rosters</div>
          <div className="card-subtitle">
            Import Yahoo’s Starting Rosters page on Teams. Then import a sheet of actual stats on Players and this
            table fills in.
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('teams')}>
            Go to Teams
          </button>
        </div>
      )}

      {teams.length > 0 && view === 'actual' && !hasStats && (
        <div className="swr__notice">
          No actual stats imported yet, so every total reads zero.{' '}
          <button type="button" className="swr__link" onClick={() => onNavigate('season-players')}>
            Import them on Players
          </button>{' '}
          or switch to Projected.
        </div>
      )}

      {teams.length > 0 && (
        <div className="swr__table-wrap">
          <table className="swr__table">
            <thead>
              <tr>
                <th className="swr__team-col">Team</th>
                {categories.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th className="swr__pts-col" title={`${n} points for first in a category, down to 1 for last`}>
                  Cat pts
                </th>
              </tr>
            </thead>
            <tbody>
              {table.map((t, i) => (
                <tr key={t.num} className={t.isMine ? 'swr__row--mine' : undefined}>
                  <td className="swr__team-col">
                    <div className="swr__team">
                      <span className="swr__place">{i + 1}</span>
                      <span className="swr__team-name">{t.name}</span>
                      {t.isMine && <span className="swr__you">YOU</span>}
                    </div>
                  </td>
                  {categories.map((c) => {
                    const rank = t.ranks[c.key];
                    return (
                      <td key={c.key} className={rank === 1 ? 'swr__cell--lead' : undefined}>
                        <span className="swr__value">{t.totals[c.key].toLocaleString()}</span>
                        <span className="swr__rank">{rank}</span>
                      </td>
                    );
                  })}
                  <td className="swr__pts-col">{t.catPts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {teams.length > 0 && (
        <p className="swr__footnote">
          {view === 'actual'
            ? 'Actual: season-to-date stats of the players on each roster today, IR, IR+ and not-active excepted. A player’s numbers follow him when he changes teams, so this is the strength of each roster, not Yahoo’s official standings.'
            : `Projected: each roster’s full-season projections from your draft sheet — starters in full, bench at ${Math.round(
                benchWeight * 100
              )}%, injured lists left out. Players you never ranked add nothing.`}{' '}
          The small number is the team’s rank in that category.
        </p>
      )}
    </div>
  );
}
