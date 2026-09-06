import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Errors' },
  { key: 'yahoo', label: 'Yahoo calls' },
];

// Collapsible so it can sit at the bottom of the Yahoo Connection page
// without burying the setup steps above it. Collapsed by default — the
// header still surfaces whether anything errored, which is the only part
// worth seeing at a glance.
export default function DebugLog() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getDebugLog().then(setRows).catch(() => setRows([]));
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

  const errorCount = rows.filter((r) => r.status === 'ERROR').length;

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          textAlign: 'left',
        }}
      >
        <span className="mono" style={{ color: 'var(--text-faint)', font: '600 11px var(--font-mono)' }}>
          {open ? '▾' : '▸'}
        </span>
        <span className="card-title" style={{ marginBottom: 0 }}>
          Debug Log
        </span>
        <span style={{ font: '500 11.5px var(--font-ui)', color: 'var(--text-faint)' }}>
          {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        </span>
        <div style={{ flex: 1 }} />
        {errorCount > 0 && (
          <span
            className="mono"
            style={{
              font: '700 11px var(--font-mono)',
              background: 'var(--danger-bg-alt)',
              color: 'var(--danger-text)',
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
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

          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
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
      )}
    </div>
  );
}
