import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import './Players.css';

// Every column except the name is editable in place. `name` stays fixed
// because imports match on it — renaming here would detach the player from
// the next import of the same sheet. Status is derived from draft state
// (drafted / by whom), which the draft itself owns.
const COLUMNS = [
  { key: 'pos', label: 'Pos', type: 'text', width: 62 },
  { key: 'team', label: 'Team', type: 'text', width: 58 },
  { key: 'overallRank', label: 'Overall', type: 'int', width: 58 },
  { key: 'rank', label: 'Pos Rank', type: 'int', width: 58 },
  { key: 'adp', label: 'ADP', type: 'int', width: 52 },
  // Derived on the server from overall rank, ADP and the league's team
  // count — editable only by changing one of those, which is why it's the
  // one numeric column with no input.
  { key: 'diff', label: 'Diff', type: 'float', width: 54, readOnly: true },
  { key: 'tier', label: 'Tier', type: 'int', width: 48, accent: true },
  { key: 'g', label: 'G', type: 'int', width: 48 },
  { key: 'a', label: 'A', type: 'int', width: 48 },
  { key: 'p', label: 'P', type: 'int', width: 48 },
  { key: 'ppp', label: 'PPP', type: 'int', width: 48 },
  { key: 'plusMinus', label: '+/-', type: 'int', width: 48 },
  { key: 'shots', label: 'Sh', type: 'int', width: 52 },
  { key: 'blocks', label: 'Blk', type: 'int', width: 52 },
  { key: 'ong', label: 'ONG', type: 'int', width: 52 },
  { key: 'vorp', label: 'VORP', type: 'float', width: 62, step: '0.001' },
  { key: 'w', label: 'W', type: 'int', width: 48 },
  { key: 'gaa', label: 'GAA', type: 'float', width: 54 },
  { key: 'saves', label: 'SV', type: 'int', width: 56 },
];

const SORT_COLUMNS = [{ key: 'name', label: 'Name' }, ...COLUMNS, { key: 'status', label: 'Status' }];

function draftedText(p) {
  if (!p.drafted) return 'Available';
  return p.mine ? 'You' : p.draftedBy;
}

function draftedColor(p) {
  if (!p.drafted) return 'var(--success-text)';
  return p.mine ? 'var(--gold)' : 'var(--text-muted)';
}

// Green is the bargain direction. A negative DIFF means the field drafts the
// player later than I rate him — I can get my own #5 at pick 20 — while a
// positive one means he goes before I'd ever want him, so he's someone
// else's reach, not mine.
function diffColor(diff) {
  if (diff == null) return 'var(--text-faint)';
  if (diff < 0) return 'var(--success-text)';
  if (diff > 0) return 'var(--danger-text)';
  return 'var(--text-muted)';
}

function coerce(type, raw) {
  if (raw === '' || raw == null) return null;
  if (type === 'float') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'int') {
    const n = Number(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return String(raw).trim() || null;
}

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posFilter, setPosFilter] = useState('ALL');
  const [draftedFilter, setDraftedFilter] = useState('hide');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ col: 'overallRank', dir: 'asc' });
  const [saveError, setSaveError] = useState(null);
  // Value at focus time, so blur only sends a PATCH when something actually
  // changed — tabbing through a row shouldn't fire a dozen requests.
  const focusValue = useRef(null);

  useEffect(() => {
    api
      .getPlayers()
      .then(setPlayers)
      .finally(() => setLoading(false));
  }, []);

  function handleCellChange(id, key, type, raw) {
    const value = coerce(type, raw);
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: value } : p)));
  }

  async function handleCellBlur(id, key, type, raw) {
    const value = coerce(type, raw);
    if (value === focusValue.current) return;
    setSaveError(null);
    try {
      const updated = await api.updatePlayer(id, { [key]: value });
      // Take the server's copy back: it normalises things like "c/lw" into
      // the stored form, so the grid shows what's actually saved.
      setPlayers((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (err) {
      setSaveError(err.message);
    }
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
      const av = sort.col === 'status' ? draftedText(a) : a[sort.col];
      const bv = sort.col === 'status' ? draftedText(b) : b[sort.col];
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
        <div style={{ font: '500 11.5px var(--font-ui)', color: 'var(--text-faint)' }}>
          Every field except the name and Diff is editable — changes save when you leave the cell. Diff is (Overall − ADP) ÷ teams, recalculated as you edit.
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
        {saveError && (
          <div style={{ font: '600 11.5px var(--font-ui)', color: 'var(--danger-text)' }}>{saveError}</div>
        )}
      </div>

      <div className="players-page__table-wrap">
        <table className="players-table">
          <thead>
            <tr>
              {SORT_COLUMNS.map((col) => (
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
                  {COLUMNS.map((col) =>
                    col.readOnly ? (
                      <td key={col.key} className="players-table__derived" style={{ color: diffColor(p.diff) }}>
                        {p[col.key] == null ? '–' : p[col.key].toFixed(1)}
                      </td>
                    ) : (
                      <td key={col.key}>
                        <input
                          className={`cell-input${col.accent ? ' cell-input--accent' : ''}`}
                          style={{ width: col.width }}
                          type={col.type === 'text' ? 'text' : 'number'}
                          step={col.step ?? (col.type === 'float' ? '0.01' : '1')}
                          value={p[col.key] ?? ''}
                          onFocus={() => {
                            focusValue.current = coerce(col.type, p[col.key] ?? '');
                          }}
                          onChange={(e) => handleCellChange(p.id, col.key, col.type, e.target.value)}
                          onBlur={(e) => handleCellBlur(p.id, col.key, col.type, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        />
                      </td>
                    )
                  )}
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
