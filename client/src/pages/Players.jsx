import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import './Players.css';

const GRID_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'pos', label: 'Pos' },
  { key: 'team', label: 'Team' },
  { key: 'rank', label: 'Rank' },
  { key: 'adp', label: 'ADP' },
  { key: 'tier', label: 'Tier' },
  { key: 'g', label: 'G' },
  { key: 'a', label: 'A' },
  { key: 'p', label: 'P' },
  { key: 'ppp', label: 'PPP' },
  { key: 'plusMinus', label: '+/-' },
  { key: 'shots', label: 'Sh' },
  { key: 'goalieLine', label: 'W/GAA/SV' },
  { key: 'status', label: 'Status' },
];

function draftedText(p) {
  if (!p.drafted) return 'Available';
  return p.mine ? 'You' : p.draftedBy;
}

function draftedColor(p) {
  if (!p.drafted) return 'var(--success-text)';
  return p.mine ? 'var(--gold)' : 'var(--text-muted)';
}

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState('ALL');
  const [draftedFilter, setDraftedFilter] = useState('hide');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'rank', dir: 'asc' });

  useEffect(() => {
    api
      .getPlayers()
      .then(setPlayers)
      .finally(() => setLoading(false));
  }, []);

  async function handleTierChange(id, value) {
    const tier = Number(value) || 0;
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, tier } : p)));
    await api.updatePlayer(id, { tier });
  }

  function toggleSort(col) {
    setSort((prev) => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }

  const rows = useMemo(() => {
    let filtered = players;
    if (posFilter !== 'ALL') filtered = filtered.filter((p) => p.posList?.includes(posFilter));
    if (draftedFilter === 'hide') filtered = filtered.filter((p) => !p.drafted);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
    }
    const sorted = [...filtered].sort((a, b) => {
      const av = a[sort.col];
      const bv = b[sort.col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return sorted;
  }, [players, posFilter, draftedFilter, search, sort]);

  return (
    <div className="players-page">
      <div className="players-page__header">
        <div className="players-page__title">Players — Full Data</div>
        <div className="players-page__actions">
          <button type="button" className="btn">
            Manage Columns
          </button>
          <button type="button" className="btn btn-primary">
            Save
          </button>
        </div>
      </div>

      <div className="players-page__filters">
        <select className="pill-select" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="ALL">Pos: All</option>
          <option value="C">C</option>
          <option value="LW">LW</option>
          <option value="RW">RW</option>
          <option value="D">D</option>
          <option value="G">G</option>
        </select>
        <select className="pill-select" value={draftedFilter} onChange={(e) => setDraftedFilter(e.target.value)}>
          <option value="hide">Drafted: hide</option>
          <option value="show">Drafted: show</option>
        </select>
        <input
          type="text"
          className="pill-input players-page__search"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="players-page__count">{rows.length} players shown</div>
      </div>

      <div className="players-page__table-wrap">
        <table className="players-table">
          <thead>
            <tr>
              {GRID_COLUMNS.map((col) => (
                <th key={col.key} onClick={() => toggleSort(col.key)}>
                  {col.label}
                  {sort.col === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading &&
              rows.map((p, i) => (
                <tr key={p.id} style={{ background: i % 2 === 1 ? 'var(--bg-row-alt)' : 'transparent' }}>
                  <td className="players-table__name">{p.name}</td>
                  <td className="mono players-table__pos">{p.pos}</td>
                  <td className="mono players-table__team">{p.team}</td>
                  <td className="mono">{p.rank}</td>
                  <td className="mono">{p.adp}</td>
                  <td>
                    <input
                      type="number"
                      className="mono tier-input"
                      value={p.tier}
                      onChange={(e) => handleTierChange(p.id, e.target.value)}
                    />
                  </td>
                  <td className="mono">{p.g ?? '–'}</td>
                  <td className="mono">{p.a ?? '–'}</td>
                  <td className="mono">{p.p ?? '–'}</td>
                  <td className="mono">{p.ppp ?? '–'}</td>
                  <td className="mono">{p.plusMinus ?? '–'}</td>
                  <td className="mono">{p.shots ?? '–'}</td>
                  <td className="mono">{p.posList?.includes('G') ? `${p.w}/${p.gaa}/${p.saves}` : '–'}</td>
                  <td className="players-table__status" style={{ color: draftedColor(p) }}>
                    {draftedText(p)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading && <div className="players-page__loading">Loading players…</div>}
      </div>
    </div>
  );
}
