import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { parseCSV, guessColumn } from '../../lib/parseCsv.js';

// Synonyms are tried as an exact header match first, in order — the
// short/ambiguous-looking ones (e.g. 'p_g', 'p_a') are safe there since
// exact match never risks grabbing the wrong column the way a substring
// scan would. These specific codes match this app's recurring rankings
// export (LWLRANK/PLAYER/TEAM/YPOS/YADP/P_G/P_A/P_PTS/P_PPG/P_SOG/P_W/
// P_SV/P_GAA) so that file auto-maps correctly every time without
// re-mapping by hand.
const REPLACE_FIELDS = [
  { key: 'name', label: 'Player name', synonyms: ['name', 'player'], required: true },
  { key: 'pos', label: 'Position (e.g. "C" or "C,LW" / "C/LW" for dual-eligible)', synonyms: ['pos', 'position', 'ypos'], required: true },
  { key: 'team', label: 'Team', synonyms: ['team', 'tm', 'club'], required: false },
  { key: 'rank', label: 'Overall rank (blank = keep file order)', synonyms: ['rank', 'overall', 'ovr', '#', 'lwlrank'], required: false, type: 'int' },
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

const RANKINGS_FIELDS = [
  { key: 'name', label: 'Player name', synonyms: ['name', 'player'], required: true },
  { key: 'rank', label: 'Your rank/score (optional — overwrites overall rank on match)', synonyms: ['rank', 'score', 'overall', 'ovr'], required: false, type: 'int' },
  { key: 'tier', label: 'Tier (optional — overwrites tier on match)', synonyms: ['tier'], required: false, type: 'int' },
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

function useFileUpload(fields) {
  const [parsed, setParsed] = useState(null); // { headers, dataRows }
  const [mapping, setMapping] = useState(null);
  const inputRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const all = parseCSV(String(reader.result));
      if (all.length < 2) return; // need a header row plus at least one data row
      const [headers, ...dataRows] = all;
      setParsed({ headers, dataRows, fileName: file.name });
      setMapping(guessMapping(headers, fields));
    };
    reader.readAsText(file);
  }

  function reset() {
    setParsed(null);
    setMapping(null);
  }

  return { parsed, mapping, setMapping, inputRef, handleFile, reset };
}

export default function RankingsImport() {
  const [aliases, setAliases] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [newAliasFrom, setNewAliasFrom] = useState('');
  const [newAliasTo, setNewAliasTo] = useState('');

  const replaceUpload = useFileUpload(REPLACE_FIELDS);
  const [replaceConfirming, setReplaceConfirming] = useState(false);
  const [replaceResult, setReplaceResult] = useState(null);

  const rankingsUpload = useFileUpload(RANKINGS_FIELDS);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [replaceError, setReplaceError] = useState(null);

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

  async function handleReplaceConfirm() {
    if (!replaceConfirming) {
      setReplaceConfirming(true);
      return;
    }
    setReplaceError(null);
    try {
      const rows = buildRows(replaceUpload.parsed.dataRows, replaceUpload.mapping, REPLACE_FIELDS);
      const result = await api.replacePlayers(rows);
      setReplaceResult({ fileName: replaceUpload.parsed.fileName, playerCount: result.playerCount, skipped: result.skipped });
      setReplaceConfirming(false);
      replaceUpload.reset();
    } catch (err) {
      setReplaceError(err.message);
      setReplaceConfirming(false);
    }
  }

  async function handleRankingsImport() {
    setImportError(null);
    try {
      const rows = buildRows(rankingsUpload.parsed.dataRows, rankingsUpload.mapping, RANKINGS_FIELDS);
      const result = await api.importRankings(rows);
      setUnmatched((prev) => [...prev, ...(result.unmatched ?? [])]);
      setImportResult({ file: rankingsUpload.parsed.fileName, matched: result.matched, unmatched: result.unmatched?.length ?? 0 });
      rankingsUpload.reset();
    } catch (err) {
      setImportError(err.message);
    }
  }

  const replaceMappingValid =
    replaceUpload.mapping && REPLACE_FIELDS.every((f) => !f.required || replaceUpload.mapping[f.key] >= 0);
  const rankingsMappingValid =
    rankingsUpload.mapping && RANKINGS_FIELDS.every((f) => !f.required || rankingsUpload.mapping[f.key] >= 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Rankings Import
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Replace Player List</div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 10 }}>
          Swaps out the current player pool entirely (mock data or otherwise) for your own list. This also clears
          any in-progress draft, since picks reference players that are about to stop existing.
        </div>
        {!replaceUpload.parsed && (
          <button type="button" className="btn" onClick={() => replaceUpload.inputRef.current?.click()}>
            Choose File
          </button>
        )}
        <input
          ref={replaceUpload.inputRef}
          type="file"
          accept=".csv"
          onChange={replaceUpload.handleFile}
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
        />
        {replaceUpload.parsed && (
          <div>
            <div style={{ font: '600 12.5px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 10 }}>
              "{replaceUpload.parsed.fileName}" — {replaceUpload.parsed.dataRows.length} rows. First row treated as
              column headers. Map each field below:
            </div>
            <ColumnMapper
              headers={replaceUpload.parsed.headers}
              fields={REPLACE_FIELDS}
              mapping={replaceUpload.mapping}
              onChange={(key, idx) => replaceUpload.setMapping((prev) => ({ ...prev, [key]: idx }))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={replaceUpload.reset}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!replaceMappingValid}
                onClick={handleReplaceConfirm}
              >
                {replaceConfirming ? 'Click again to confirm — replaces the player pool' : 'Replace Player List'}
              </button>
            </div>
          </div>
        )}
        {replaceResult && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--success)', marginTop: 10 }}>
            Player pool replaced from "{replaceResult.fileName}" — {replaceResult.playerCount} players loaded
            {replaceResult.skipped ? `, ${replaceResult.skipped} rows skipped (missing name or position)` : ''}.
          </div>
        )}
        {replaceError && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--danger-text)', marginTop: 10 }}>
            {replaceError}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">Import Personal Rankings</div>
        <div style={{ font: '500 12px var(--font-ui)', color: 'var(--text-faint)', marginBottom: 10 }}>
          Matches names against the current player pool by exact name or alias. On a match, your rank/tier
          overwrite that player's — it does not add new players (use Replace Player List for that).
        </div>
        {!rankingsUpload.parsed && (
          <button type="button" className="btn" onClick={() => rankingsUpload.inputRef.current?.click()}>
            Choose File
          </button>
        )}
        <input
          ref={rankingsUpload.inputRef}
          type="file"
          accept=".csv"
          onChange={rankingsUpload.handleFile}
          style={{ position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
        />
        {rankingsUpload.parsed && (
          <div>
            <div style={{ font: '600 12.5px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 10 }}>
              "{rankingsUpload.parsed.fileName}" — {rankingsUpload.parsed.dataRows.length} rows. First row treated as
              column headers. Map each field below:
            </div>
            <ColumnMapper
              headers={rankingsUpload.parsed.headers}
              fields={RANKINGS_FIELDS}
              mapping={rankingsUpload.mapping}
              onChange={(key, idx) => rankingsUpload.setMapping((prev) => ({ ...prev, [key]: idx }))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={rankingsUpload.reset}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!rankingsMappingValid}
                onClick={handleRankingsImport}
              >
                Import
              </button>
            </div>
          </div>
        )}
        {importResult && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--text-secondary)', marginTop: 10 }}>
            "{importResult.file}" — {importResult.matched} matched, {importResult.unmatched} unmatched
          </div>
        )}
        {importError && (
          <div style={{ font: '600 12px var(--font-ui)', color: 'var(--danger-text)', marginTop: 10 }}>
            {importError}
          </div>
        )}
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
            "{u.rankingsName}"
            {u.suggestion ? (
              <>
                {' '}
                — suggest: <span style={{ color: 'var(--text-primary)' }}>{u.suggestion}</span>{' '}
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
