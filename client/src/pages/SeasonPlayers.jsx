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

// Per start, from the goalie three-year totals: the sheet has wins and
// saves over three seasons, which only compare across goalies once divided
// by the starts they came from.
const perStart = (key) => (p) => {
  const r = p.profile;
  return r?.[key] != null && r.gs3y > 0 ? r[key] / r.gs3y : null;
};
const profile = (key) => (p) => p.profile?.[key] ?? null;

// Column groups, each switchable. Projected and Actual are the everyday
// pair; Reputation (what other managers see) and Luck (how much of last
// season was the bounces) are for sizing up a trade.
const GROUPS = [
  { key: 'proj', label: 'Projected', cols: STATS.map((s) => ({ ...s, key: `proj.${s.key}`, get: (p) => p.proj?.[s.key] ?? null })) },
  {
    key: 'rep',
    label: 'Reputation',
    title: 'Yahoo ADP and ownership, and three-year rates per 82 games — what other managers see',
    cols: [
      { key: 'rep.adp', label: 'YADP', get: (p) => p.adp ?? null, smallIsBest: true },
      { key: 'rep.yown', label: 'Own%', get: profile('yown') },
      { key: 'rep.gp3y', label: 'GP', get: profile('gp3y') },
      { key: 'rep.g3y', label: 'G/82', get: profile('g3y') },
      { key: 'rep.a3y', label: 'A/82', get: profile('a3y') },
      { key: 'rep.pts3y', label: 'P/82', get: profile('pts3y') },
      { key: 'rep.bs3y', label: 'BLK/82', get: profile('bs3y') },
      { key: 'rep.sogCareer', label: 'SOG/82', get: profile('sogCareer'), title: 'Career' },
      { key: 'rep.wPerStart', label: 'W/GS', get: perStart('w3y'), decimals: 2 },
      { key: 'rep.svPerStart', label: 'SV/GS', get: perStart('sv3y'), decimals: 1 },
      { key: 'rep.gaa3y', label: 'GAA', get: profile('gaa3y'), decimals: 2, smallIsBest: true },
    ],
  },
  {
    key: 'luck',
    label: 'Luck',
    title: 'Last season against the career rate — a big gap usually comes back to earth',
    cols: [
      { key: 'luck.shsv', label: 'SHSV', get: profile('shsv'), title: 'On-ice shooting % + save %; 1000 is neutral' },
      { key: 'luck.lyShPct', label: 'SH% LY', get: profile('lyShPct') },
      { key: 'luck.cShPct', label: 'SH% car', get: profile('cShPct') },
      { key: 'luck.lyIpp', label: 'IPP LY', get: profile('lyIpp') },
      { key: 'luck.cIpp', label: 'IPP car', get: profile('cIpp') },
    ],
  },
  { key: 'act', label: 'Actual', cols: STATS.map((s) => ({ ...s, key: `act.${s.key}`, get: (p) => p.act?.[s.key] ?? null })) },
];
const COLUMN = new Map(GROUPS.flatMap((g) => g.cols).map((c) => [c.key, c]));
const DEFAULT_GROUPS = ['proj', 'act'];
const GROUPS_STORAGE = 'adl.seasonPlayers.groups';

function loadGroups() {
  try {
    const saved = JSON.parse(localStorage.getItem(GROUPS_STORAGE));
    if (Array.isArray(saved) && saved.length) return saved.filter((k) => GROUPS.some((g) => g.key === k));
  } catch {
    // Private window or blocked storage: the defaults will do.
  }
  return DEFAULT_GROUPS;
}

const INFO = [
  { key: 'name', label: 'Player' },
  { key: 'pos', label: 'Pos' },
  { key: 'team', label: 'NHL' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'slot', label: 'Seat' },
  { key: 'overallRank', label: 'My Rk' },
];

function valueFor(p, col) {
  const column = COLUMN.get(col);
  return column ? column.get(p) : p[col] ?? null;
}

// Sheet numbers arrive as whatever the sheet had — 31.4 goals per 82, 0.112
// shooting — so anything without set decimals gets a sensible amount.
function formatStat(stat, value) {
  if (value == null) return '–';
  if (stat.decimals != null) return value.toFixed(stat.decimals);
  if (Number.isInteger(value)) return value;
  return Math.abs(value) < 1 ? value.toFixed(3) : value.toFixed(1);
}

export default function SeasonPlayers() {
  const { data, error, refetch } = useSeason();
  const [posFilter, setPosFilter] = useState('ALL');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [groupKeys, setGroupKeys] = useState(loadGroups);
  const groups = GROUPS.filter((g) => groupKeys.includes(g.key));

  function toggleGroup(key) {
    setGroupKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      if (!next.length) return prev;
      try {
        localStorage.setItem(GROUPS_STORAGE, JSON.stringify(next));
      } catch {
        // Not remembered next time; still switched now.
      }
      return next;
    });
  }

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
      const smallIsBest = col === 'overallRank' || col.endsWith('.gaa') || COLUMN.get(col)?.smallIsBest;
      return { col, dir: numeric && !smallIsBest ? 'desc' : 'asc' };
    });
  }

  function header(col, label, numeric, extraClass = '', title) {
    const on = activeSort.col === col;
    return (
      <th
        key={col}
        className={extraClass}
        title={title}
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
        <div className="season-groups" role="group" aria-label="Column groups">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={groupKeys.includes(g.key)}
              className={`season-groups__chip${groupKeys.includes(g.key) ? ' season-groups__chip--on' : ''}`}
              title={g.title}
              onClick={() => toggleGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="players-page__count">{data ? `${rows.length} players shown` : ''}</div>
      </div>

      <div className="players-page__table-wrap">
        <table className="players-table season-table">
          <thead>
            <tr className="season-table__groups">
              <th colSpan={INFO.length} className="season-table__group-blank" />
              {groups.map((g) => (
                <th key={g.key} colSpan={g.cols.length} title={g.title} className={`season-table__group season-table__group--${g.key}`}>
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="season-table__cols">
              {INFO.map((c) => header(c.key, c.label, c.key === 'overallRank', c.key === 'name' ? 'season-table__sticky' : ''))}
              {groups.flatMap((g) => g.cols.map((c, i) => header(c.key, c.label, true, i === 0 ? 'season-table__edge' : '', c.title)))}
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
                  {groups.flatMap((g) =>
                    g.cols.map((c, i) => (
                      <td
                        key={c.key}
                        className={`${g.key === 'act' ? 'season-table__act' : 'season-table__proj'}${i === 0 ? ' season-table__edge' : ''}`}
                      >
                        {formatStat(c, c.get(p))}
                      </td>
                    ))
                  )}
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
