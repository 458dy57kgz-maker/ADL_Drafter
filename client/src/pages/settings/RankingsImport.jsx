import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function RankingsImport() {
  const [aliases, setAliases] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [newAliasFrom, setNewAliasFrom] = useState('');
  const [newAliasTo, setNewAliasTo] = useState('');

  useEffect(() => {
    api.getAliases().then(setAliases);
    api.getUnmatched().then(setUnmatched);
  }, []);

  async function handleAddAlias() {
    if (!newAliasFrom.trim() || !newAliasTo.trim()) return;
    const alias = await api.addAlias({ from: newAliasFrom.trim(), to: newAliasTo.trim() });
    setAliases((prev) => [...prev, alias]);
    setNewAliasFrom('');
    setNewAliasTo('');
  }

  async function handleResolve(id, decision) {
    await api.resolveUnmatched(id, decision);
    setUnmatched((prev) => prev.filter((u) => u.id !== id));
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const rows = String(reader.result)
        .split('\n')
        .map((line) => line.split(','))
        .filter((r) => r.length > 1);
      const result = await api.importRankings(rows);
      setUnmatched(result.unmatched ?? []);
    };
    reader.readAsText(file);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Rankings Import
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Upload CSV or paste from Google Sheet</div>
        <label className="btn" style={{ display: 'inline-block' }}>
          Choose File
          <input type="file" accept=".csv" onChange={handleFileChosen} style={{ display: 'none' }} />
        </label>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginTop: 10 }}>
          Column mapping — name → col A · position → col B · rank/score → col C · tier → col D
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Alias / Exceptions Table</div>
        {aliases.map((a) => (
          <div key={a.id} className="mono" style={{ font: '500 12.5px var(--font-mono)', color: 'var(--text-secondary)', padding: '6px 0', display: 'flex', justifyContent: 'space-between' }}>
            <span>
              "{a.from}" → "{a.to}"
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                await api.deleteAlias(a.id);
                setAliases((prev) => prev.filter((x) => x.id !== a.id));
              }}
            >
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="field-input"
            placeholder="Yahoo name"
            value={newAliasFrom}
            onChange={(e) => setNewAliasFrom(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            className="field-input"
            placeholder="Rankings name"
            value={newAliasTo}
            onChange={(e) => setNewAliasTo(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-sm" onClick={handleAddAlias}>
            + Add Row
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            Unmatched at import
          </div>
          <div
            className="mono"
            style={{
              font: '700 11px var(--font-mono)',
              background: 'var(--danger-bg-alt)',
              color: 'var(--danger-text)',
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {unmatched.length}
          </div>
        </div>
        {unmatched.map((u) => (
          <div key={u.id} style={{ font: '500 12.5px var(--font-ui)', color: 'var(--text-secondary)', padding: '6px 0' }}>
            "{u.rankingsName}" — suggest: <span style={{ color: 'var(--text-primary)' }}>{u.suggestion}</span>{' '}
            <button type="button" onClick={() => handleResolve(u.id, 'accept')} style={btnGlyphStyle('var(--success)')}>
              ✓
            </button>{' '}
            <button type="button" onClick={() => handleResolve(u.id, 'reject')} style={btnGlyphStyle('var(--danger-text)')}>
              ✗
            </button>
          </div>
        ))}
        {unmatched.length === 0 && (
          <div style={{ font: '500 12.5px var(--font-ui)', color: 'var(--text-faint)' }}>
            Nothing unmatched — everything lined up.
          </div>
        )}
      </div>
    </div>
  );
}

function btnGlyphStyle(color) {
  return { background: 'transparent', border: 'none', color, font: '600 13px var(--font-ui)', cursor: 'pointer' };
}
