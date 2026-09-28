import { useMemo, useState } from 'react';
import { useSeason, formatImportedAt } from '../lib/useSeason.js';
import { StatsImportPanel } from '../components/SeasonImports.jsx';
import PlayerFlag from '../components/PlayerFlag.jsx';
import './Players.css';
import './SeasonPlayers.css';

// One stat line, drawn twice: what I projected at the draft and what he has
// actually done. Same columns in the same order on both sides so the eye can
// jump straight across.
const STATS = [
  { key: 'gp', label: 'GP' },
  { key: 'g', label: 'G' },
  { key: 'a', label: 'A' },
  { key: 'p', label: 'P' },
  { key: 'ppp', label: 'PPP' },
  { key: 'shots', label: 'SOG' },
  { key: 'blocks', label: 'BLK' },
  { key: 'w', label: 'W' },
  { key: 'gaa', label: 'GAA', decimals: 2 },
  { key: 'saves', label: 'SV' },
];

const INFO = [
  { key: 'name', label: 'Player' },
  { key: 'pos', label: 'Pos' },
  { key: 'team', label: 'NHL' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'slot', label: 'Seat' },
  { key: 'overallRank', label: 'My Rk' },
];

function valueFor(p, col) {
  if (col.startsWith('proj.')) return p.proj?.[col.slice(5)] ?? null;
  if (col.startsWith('act.')) return p.act?.[col.slice(4)] ?? null;
  return p[col] ?? null;
}

function formatStat(stat, value) {
  if (value == null) return '–';
  return stat.decimals ? value.toFixed(stat.decimals) : value;
}

export default function SeasonPlayers() {
  const { data, error, refetch } = useSeason();
  const [posFilter, setPosFilter] = useState('ALL');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  const hasStats = (data?.meta.statsCount ?? 0) > 0;
  // Points so far once there are any, otherwise the projection — the list
  // opens on "who's producing" either way.
  const activeSort = sort ?? { col: hasStats ? 'act.p' : 'proj.p', dir: 'desc' };

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.players;
    if (posFilter !== 'ALL') list = list.filter((p) => p.posList?.includes(posFilter));
    if (ownerFilter === 'rostered') list = list.filter((p) => p.owner != null);
    else if (ownerFilter === 'available') list = list.filter((p) => p.owner == null);
    else if (ownerFilter !== 'all') list = list.filter((p) => String(p.owner) === ownerFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    const { col, dir } = activeSort;
    return [...list].sort((a, b) => {
      const av = valueFor(a, col);
      const bv = valueFor(b, col);
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === 'asc' ? av - bv : bv - av;
    });
  }, [data, posFilter, ownerFilter, search, activeSort.col, activeSort.dir]);

  function toggleSort(col, numeric) {
    setSort((prev) => {
      const current = prev ?? activeSort;
      if (current.col === col) return { col, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      // Numbers open best-first: biggest for counting stats, smallest for my
      // rank and GAA. Names and teams open A to Z.
      const smallIsBest = col === 'overallRank' || col.endsWith('.gaa');
      return { col, dir: numeric && !smallIsBest ? 'desc' : 'asc' };
    });
  }

  function header(col, label, numeric, extraClass = '') {
    const on = activeSort.col === col;
    return (
      <th
        key={col}
        className={extraClass}
        onClick={() => toggleSort(col, numeric)}
        aria-sort={on ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        {on ? (activeSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  }

  if (error) {
    return (
      <div className="players-page">
        <div className="card">Could not reach the API server. Is it running? ({error.message})</div>
      </div>
    );
  }

  const { meta, teams } = data ?? { meta: {}, teams: [] };

  return (
    <div className="players-page">
      <div className="players-page__header">
        <div>
          <div className="players-page__title">Players — Season</div>
          <div className="season-players__sub">
            {meta.rostersImportedAt ? `Rosters imported ${formatImportedAt(meta.rostersImportedAt)}` : 'No rosters imported yet (Teams)'}
            {' · '}
            {hasStats
              ? `actual stats for ${meta.statsCount} players, imported ${formatImportedAt(meta.statsImportedAt)}${meta.statsFile ? ` from ${meta.statsFile}` : ''}`
              : 'no actual stats yet'}
          </div>
        </div>
        <button type="button" className={`btn btn-sm${hasStats ? '' : ' btn-primary'}`} onClick={() => setImportOpen((o) => !o)}>
          Import actual stats
        </button>
      </div>

      {importOpen && (
        <StatsImportPanel
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setSort(null);
            refetch();
          }}
        />
      )}

      <div className="players-page__filters">
        <select className="pill-select" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="ALL">Pos: All</option>
          <option value="C">C</option>
          <option value="LW">LW</option>
          <option value="RW">RW</option>
          <option value="D">D</option>
          <option value="G">G</option>
        </select>
        <select className="pill-select" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">Owner: All</option>
          <option value="rostered">Rostered</option>
          <option value="available">Available (free agents)</option>
          {teams.map((t) => (
            <option key={t.num} value={String(t.num)}>
              {t.name}
              {t.isMine ? ' (you)' : ''}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="pill-input players-page__search"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="players-page__count">{data ? `${rows.length} players shown` : ''}</div>
      </div>

      <div className="players-page__table-wrap">
        <table className="players-table season-table">
          <thead>
            <tr className="season-table__groups">
              <th colSpan={INFO.length} className="season-table__group-blank" />
              <th colSpan={STATS.length} className="season-table__group season-table__group--proj">
                Projected
              </th>
              <th colSpan={STATS.length} className="season-table__group season-table__group--act">
                Actual
              </th>
            </tr>
            <tr className="season-table__cols">
              {INFO.map((c) => header(c.key, c.label, c.key === 'overallRank', c.key === 'name' ? 'season-table__sticky' : ''))}
              {STATS.map((s, i) => header(`proj.${s.key}`, s.label, true, i === 0 ? 'season-table__edge' : ''))}
              {STATS.map((s, i) => header(`act.${s.key}`, s.label, true, i === 0 ? 'season-table__edge' : ''))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const mine = p.owner != null && teams.find((t) => t.num === p.owner)?.isMine;
              return (
                <tr key={p.key} className={mine ? 'season-table__mine' : undefined}>
                  <td className="players-table__name season-table__sticky">
                    <span className="season-table__name">
                      {p.name}
                      <PlayerFlag flag={p.flag} />
                      {p.status && <span className="season-table__status">{p.status}</span>}
                    </span>
                  </td>
                  <td>{p.pos ?? '–'}</td>
                  <td>{p.team ?? '–'}</td>
                  <td className={`season-table__owner${p.owner == null ? ' season-table__owner--free' : ''}`}>
                    {p.ownerName ?? 'Available'}
                  </td>
                  <td>{p.slot ?? ''}</td>
                  <td>{p.overallRank ?? '–'}</td>
                  {STATS.map((s, i) => (
                    <td key={`p${s.key}`} className={`season-table__proj${i === 0 ? ' season-table__edge' : ''}`}>
                      {formatStat(s, p.proj?.[s.key])}
                    </td>
                  ))}
                  {STATS.map((s, i) => (
                    <td key={`a${s.key}`} className={`season-table__act${i === 0 ? ' season-table__edge' : ''}`}>
                      {formatStat(s, p.act?.[s.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data && <div className="players-page__loading">Loading players…</div>}
      </div>
    </div>
  );
}
