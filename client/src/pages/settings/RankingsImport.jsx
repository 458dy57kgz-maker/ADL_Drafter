import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { parseCSV, guessColumn } from '../../lib/parseCsv.js';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

// Synonyms are tried as an exact header match first, in order — the
// short/ambiguous-looking ones (e.g. 'p_g', 'p_a') are safe there since
// exact match never risks grabbing the wrong column the way a substring
// scan would. These specific codes match this app's recurring rankings
// export (LWLRANK/PLAYER/TEAM/YPOS/YADP/P_G/P_A/P_PTS/P_PPG/P_SOG/P_W/
// P_SV/P_GAA) so that file auto-maps correctly every time without
// re-mapping by hand.
//
// Only the name is required: a file that's just names and new rankings is a
// valid update of players already in the pool. Position is only needed for
// rows that turn out to be brand-new players, which the server enforces.
const IMPORT_FIELDS = [
  { key: 'name', label: 'Player name', synonyms: ['name', 'player'], required: true },
  { key: 'pos', label: 'Position — needed for new players ("C,LW" for dual-eligible)', synonyms: ['pos', 'position', 'ypos'], required: false },
  { key: 'team', label: 'Team', synonyms: ['team', 'tm', 'club'], required: false },
  { key: 'rank', label: 'Overall rank', synonyms: ['rank', 'overall', 'ovr', '#', 'lwlrank'], required: false, type: 'int' },
  { key: 'adp', label: 'ADP', synonyms: ['adp', 'yadp'], required: false, type: 'int' },
  { key: 'tier', label: 'Tier', synonyms: ['tier'], required: false, type: 'int' },
  { key: 'g', label: 'Goals', synonyms: ['g', 'goals', 'p_g'], required: false, type: 'int' },
  { key: 'a', label: 'Assists', synonyms: ['a', 'assists', 'p_a'], required: false, type: 'int' },
  { key: 'p', label: 'Points', synonyms: ['p', 'pts', 'points', 'p_pts'], required: false, type: 'int' },
  { key: 'ppp', label: 'Power-play points', synonyms: ['ppp', 'power play points', 'p_ppg'], required: false, type: 'int' },
  { key: 'plusMinus', label: '+/-', synonyms: ['+/-', 'plusminus', 'plus/minus'], required: false, type: 'int' },
  { key: 'shots', label: 'Shots', synonyms: ['shots', 'sog', 'p_sog'], required: false, type: 'int' },
  { key: 'w', label: 'Wins (goalies)', synonyms: ['w', 'wins', 'p_w'], required: false, type: 'int' },
  { key: 'gaa', label: 'GAA (goalies)', synonyms: ['gaa', 'p_gaa'], required: false, type: 'float' },
  { key: 'saves', label: 'Saves (goalies)', synonyms: ['saves', 'sv', 'p_sv'], required: false, type: 'int' },
];

function guessMapping(headers, fields) {
  const mapping = {};
  for (const f of fields) mapping[f.key] = guessColumn(headers, f.synonyms);
  return mapping;
}

function parseFieldValue(field, raw) {
  if (raw === '' || raw == null) return null;
  if (field.type === 'float') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === 'int') {
    const n = Number(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return raw || null;
}

function buildRows(dataRows, mapping, fields) {
  return dataRows
    .map((row) => {
      const obj = {};
      for (const f of fields) {
        const idx = mapping[f.key];
        const raw = idx >= 0 && idx < row.length ? row[idx] : '';
        obj[f.key] = parseFieldValue(f, raw);
      }
      return obj;
    })
    .filter((r) => r.name);
}

function ColumnMapper({ headers, fields, mapping, onChange }) {
  return (
    <div className="stack-gap" style={{ marginBottom: 12 }}>
      {fields.map((f) => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 300, font: '600 12.5px var(--font-ui)', color: 'var(--text-secondary)' }}>
            {f.label}
            {f.required ? ' *' : ''}
          </div>
          <select
            className="field-select"
            style={{ width: 'auto', flex: 1 }}
            value={mapping[f.key]}
            onChange={(e) => onChange(f.key, Number(e.target.value))}
          >
            <option value={-1}>— not in file —</option>
            {headers.map((h, i) => (
              <option key={i} value={i}>
                {h || `Column ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

export default function RankingsImport() {
  const [aliases, setAliases] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [newAliasFrom, setNewAliasFrom] = useState('');
  const [newAliasTo, setNewAliasTo] = useState('');

  const [parsed, setParsed] = useState(null); // { headers, dataRows, fileName }
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api.getAliases().then(setAliases);
    api.getUnmatched().then(setUnmatched);
  }, []);

  function resetUpload() {
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setRemoveMissing(false);
    setError(null);
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const all = parseCSV(String(reader.result));
      if (all.length < 2) {
        setError('That file needs a header row plus at least one data row.');
        return;
      }
      const [headers, ...dataRows] = all;
      setResult(null);
      setError(null);
      setPreview(null);
      setParsed({ headers, dataRows, fileName: file.name });
      setMapping(guessMapping(headers, IMPORT_FIELDS));
    };
    reader.readAsText(file);
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    try {
      const rows = buildRows(parsed.dataRows, mapping, IMPORT_FIELDS);
      const p = await api.previewImport(rows);
      setPreview(p);
      setRemoveMissing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      const rows = buildRows(parsed.dataRows, mapping, IMPORT_FIELDS);
      const r = await api.importPlayers(rows, removeMissing);
      setResult({ ...r, fileName: parsed.fileName });
      setConfirmOpen(false);
      resetUpload();
      api.getUnmatched().then(setUnmatched);
    } catch (err) {
      setError(err.message);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve(id, decision) {
    await api.resolveUnmatched(id, decision);
    setUnmatched((prev) => prev.filter((u) => u.id !== id));
    if (decision === 'accept') api.getAliases().then(setAliases);
  }

  async function handleClearUnmatched() {
    await api.clearUnmatched();
    setUnmatched([]);
  }

  const mappingValid = mapping && IMPORT_FIELDS.every((f) => !f.required || mapping[f.key] >= 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Rankings Import
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Replace / Update Player List</div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 10 }}>
          Matches on player name (using the alias table below). Players in the file that aren't in your list are
          added, ones already there are updated, and you'll be asked what to do with any that the file leaves out.
          A column you don't map is left alone rather than blanked out.
        </div>

        {!parsed && (
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Choose File
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleFile}
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
        />

        {parsed && !preview && (
          <div>
            <div style={{ font: '600 12.5px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 10 }}>
              "{parsed.fileName}" — {parsed.dataRows.length} rows. First row treated as column headers. Map each
              field below:
            </div>
            <ColumnMapper
              headers={parsed.headers}
              fields={IMPORT_FIELDS}
              mapping={mapping}
              onChange={(key, idx) => setMapping((prev) => ({ ...prev, [key]: idx }))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={resetUpload}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!mappingValid || busy}
                onClick={handlePreview}
              >
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {parsed && preview && (
          <div>
            <div style={{ font: '600 12.5px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 8 }}>
              "{parsed.fileName}" — here's what this import will do:
            </div>
            <ul style={{ margin: '0 0 12px 18px', padding: 0, font: '500 12.5px var(--font-ui)', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>
                <strong style={{ color: 'var(--success-text)' }}>{preview.add}</strong>
                {preview.add === 1 ? ' new player added' : ' new players added'}
              </li>
              <li>
                <strong style={{ color: 'var(--text-primary)' }}>{preview.update}</strong>
                {preview.update === 1 ? ' existing player updated' : ' existing players updated'}
              </li>
              {preview.skipped > 0 && (
                <li style={{ color: 'var(--text-faint)' }}>
                  {preview.skipped} rows skipped — not already in your list and no position given
                </li>
              )}
            </ul>

            {preview.missing.count > 0 && (
              <div
                className="card"
                style={{ background: 'var(--warning-bg)', borderColor: 'var(--warning-border)', marginBottom: 12 }}
              >
                <div style={{ font: '600 12.5px var(--font-ui)', color: 'var(--warning-text)', marginBottom: 6 }}>
                  {preview.missing.count === 1
                    ? '1 player in your list isn’t in this file'
                    : `${preview.missing.count} players in your list aren’t in this file`}
                </div>
                <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  For example: {preview.missing.examples.join(', ')}
                  {preview.missing.count > preview.missing.examples.length
                    ? ` — and ${preview.missing.count - preview.missing.examples.length} more`
                    : ''}
                  .
                  {preview.missing.draftedCount > 0 &&
                    ` ${preview.missing.draftedCount} of them have already been drafted; removing those also removes their picks.`}
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: '600 12px var(--font-ui)', color: 'var(--text-secondary)' }}>
                    <input type="radio" checked={!removeMissing} onChange={() => setRemoveMissing(false)} />
                    Keep them
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, font: '600 12px var(--font-ui)', color: 'var(--text-secondary)' }}>
                    <input type="radio" checked={removeMissing} onChange={() => setRemoveMissing(true)} />
                    Remove them
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={resetUpload}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => (removeMissing ? setConfirmOpen(true) : handleApply())}
              >
                {busy ? 'Importing…' : 'Apply Import'}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--success)', marginTop: 10 }}>
            "{result.fileName}" imported — {result.added} added, {result.updated} updated
            {result.removed ? `, ${result.removed} removed` : ''}
            {result.skipped ? `, ${result.skipped} skipped` : ''}
            {result.flagged ? `, ${result.flagged} flagged as possible duplicates below` : ''}.
          </div>
        )}
        {error && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--danger-text)', marginTop: 10 }}>{error}</div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        busy={busy}
        title={`Remove ${preview?.missing.count ?? 0} players?`}
        body={
          `They're in your current list but not in this file, so they'll be deleted outright` +
          (preview?.missing.draftedCount ? `, along with the picks of the ${preview.missing.draftedCount} already drafted` : '') +
          `. For example: ${preview?.missing.examples.join(', ') ?? ''}.`
        }
        confirmLabel="Remove and import"
        onConfirm={handleApply}
        onCancel={() => setConfirmOpen(false)}
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Alias / Exceptions Table</div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 10 }}>
          Ties a name as it appears in an import file to the name stored here, so a differently-spelled row updates
          the right player instead of creating a second copy of them.
        </div>
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
            placeholder="Name in file"
            value={newAliasFrom}
            onChange={(e) => setNewAliasFrom(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            className="field-input"
            placeholder="Name in your list"
            value={newAliasTo}
            onChange={(e) => setNewAliasTo(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              if (!newAliasFrom.trim() || !newAliasTo.trim()) return;
              const alias = await api.addAlias({ from: newAliasFrom.trim(), to: newAliasTo.trim() });
              setAliases((prev) => [...prev, alias]);
              setNewAliasFrom('');
              setNewAliasTo('');
            }}
          >
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
          <div style={{ flex: 1 }} />
          {unmatched.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={handleClearUnmatched}>
              Clear
            </button>
          )}
        </div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 8 }}>
          Names that were added as new players but look a lot like someone already in your list — likely spelling
          variants that just became duplicates. Accepting one records an alias so the next import matches it instead.
        </div>
        {unmatched.map((u) => (
          <div key={u.id} style={{ font: '500 12.5px var(--font-ui)', color: 'var(--text-secondary)', padding: '6px 0' }}>
            "{u.rankingsName}"
            {u.suggestion ? (
              <>
                {' '}
                — did you mean: <span style={{ color: 'var(--text-primary)' }}>{u.suggestion}</span>{' '}
                <button type="button" onClick={() => handleResolve(u.id, 'accept')} style={btnGlyphStyle('var(--success)')}>
                  ✓
                </button>{' '}
              </>
            ) : (
              <span style={{ color: 'var(--text-faint)' }}> — no close match found </span>
            )}
            <button type="button" onClick={() => handleResolve(u.id, 'reject')} style={btnGlyphStyle('var(--danger-text)')}>
              ✗
            </button>
          </div>
        ))}
        {unmatched.length === 0 && (
          <div style={{ font: '500 12.5px var(--font-ui)', color: 'var(--text-faint)' }}>
            Nothing flagged — every imported name lined up.
          </div>
        )}
      </div>
    </div>
  );
}

function btnGlyphStyle(color) {
  return { background: 'transparent', border: 'none', color, font: '600 13px var(--font-ui)', cursor: 'pointer' };
}
