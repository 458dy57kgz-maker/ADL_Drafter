import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Errors' },
  { key: 'yahoo', label: 'Yahoo calls' },
];

export default function DebugLog() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.getDebugLog().then(setRows);
  }, []);

  async function handleClear() {
    await api.clearDebugLog();
    setRows([]);
  }

  function handleCopy() {
    const text = rows.map((r) => `${r.time}\t${r.msg}\t${r.status}`).join('\n');
    navigator.clipboard?.writeText(text);
  }

  const filtered = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'error') return r.status === 'ERROR';
    if (filter === 'yahoo') return r.type === 'yahoo';
    return true;
  });

  const hasErrors = rows.some((r) => r.status === 'ERROR');

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="settings-section-header">
        <div className="settings-section-title">Debug Log</div>
        <div
          className="status-pill"
          style={
            hasErrors
              ? { background: 'var(--danger-bg-alt)', borderColor: 'var(--danger-border)', color: 'var(--danger-text)' }
              : undefined
          }
        >
          <span className="status-dot" style={hasErrors ? { background: 'var(--danger-text)' } : undefined} />
          {hasErrors ? 'Errors present' : 'All systems ok'}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="filter-chip"
            style={
              filter === f.key
                ? { background: 'var(--accent)', color: 'var(--accent-on-text)' }
                : { background: 'var(--bg-row)', color: 'var(--text-secondary)' }
            }
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" className="btn btn-sm" onClick={handleClear}>
          Clear
        </button>
        <button type="button" className="btn btn-sm" onClick={handleCopy}>
          Copy Log
        </button>
      </div>

      <div className="card" style={{ padding: 6 }}>
        {filtered.map((r, i) => (
          <div
            key={i}
            className="mono"
            style={{
              display: 'flex',
              gap: 10,
              font: '500 12px var(--font-mono)',
              padding: '7px 10px',
              borderRadius: 6,
              background: r.status === 'ERROR' ? 'rgba(232,131,122,0.08)' : 'transparent',
              marginBottom: 2,
            }}
          >
            <div style={{ color: 'var(--text-faint)' }}>{r.time}</div>
            <div style={{ color: 'var(--text-muted)', flex: 1 }}>{r.msg}</div>
            <div style={{ color: r.status === 'ERROR' ? 'var(--danger-text)' : 'var(--success)' }}>{r.status}</div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 12, font: '500 12px var(--font-ui)', color: 'var(--text-faint)' }}>
            No log entries.
          </div>
        )}
      </div>
    </div>
  );
}
