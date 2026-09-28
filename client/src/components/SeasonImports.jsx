import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { parseCSV, guessColumn } from '../lib/parseCsv.js';
import './SeasonImports.css';

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Yahoo's "Starting Rosters" page, saved from the browser, is the roster
// source until the Yahoo API works. One button: pick the file, it's in.
export function RosterImportButton({ onImported, primary = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.importRosters(await readText(file));
      const missing = result.unmatched.length;
      setMessage({
        ok: true,
        text: `${result.rostered} players on ${result.teams} teams${missing ? ` · ${missing} not in your player list` : ''}`,
        detail: missing ? result.unmatched.join(', ') : null,
      });
      onImported?.(result);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="season-import">
      <button
        type="button"
        className={`btn btn-sm${primary ? ' btn-primary' : ''}`}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="The Starting Rosters page from Yahoo, saved as HTML"
      >
        {busy ? 'Importing…' : 'Import Yahoo rosters'}
      </button>
      <input ref={inputRef} type="file" accept=".html,.htm,text/html" hidden onChange={handleFile} />
      {message && (
        <span className={`season-import__msg${message.ok ? '' : ' season-import__msg--error'}`} title={message.detail ?? undefined}>
          {message.text}
        </span>
      )}
    </div>
  );
}

// Actual stats come from whatever sheet I keep during the season. Exact
// header matches first (so 'g' and 'a' never grab "Name"), like the
// rankings import; 's' is NHL.com's shots column.
export const STAT_FIELDS = [
  { key: 'name', label: 'Player', synonyms: ['player', 'name', 'player name'], required: true },
  { key: 'team', label: 'NHL team', synonyms: ['team', 'tm', 'nhl team'] },
  { key: 'pos', label: 'Position', synonyms: ['pos', 'position'] },
  { key: 'gp', label: 'GP', synonyms: ['gp', 'games played', 'games'], type: 'int' },
  { key: 'g', label: 'Goals', synonyms: ['g', 'goals'], type: 'int' },
  { key: 'a', label: 'Assists', synonyms: ['a', 'assists'], type: 'int' },
  { key: 'p', label: 'Points', synonyms: ['p', 'pts', 'points'], type: 'int' },
  { key: 'ppp', label: 'PPP', synonyms: ['ppp', 'power play points', 'powerplay points'], type: 'int' },
  { key: 'plusMinus', label: '+/-', synonyms: ['+/-', 'plusminus', 'plus/minus'], type: 'int' },
  { key: 'shots', label: 'Shots', synonyms: ['sog', 'shots', 's', 'shots on goal'], type: 'int' },
  { key: 'blocks', label: 'Blocks', synonyms: ['blk', 'blocks', 'blocked shots', 'bks'], type: 'int' },
  { key: 'w', label: 'Wins', synonyms: ['w', 'wins'], type: 'int' },
  { key: 'gaa', label: 'GAA', synonyms: ['gaa', 'goals against average'], type: 'float' },
  { key: 'saves', label: 'Saves', synonyms: ['sv', 'saves'], type: 'int' },
];

function parseValue(field, raw) {
  if (raw === '' || raw == null) return null;
  if (!field.type) return String(raw).trim() || null;
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return field.type === 'int' ? Math.round(n) : n;
}

export function StatsImportPanel({ onImported, onClose }) {
  const inputRef = useRef(null);
  const [parsed, setParsed] = useState(null); // { headers, rows, fileName }
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    const all = parseCSV(await readText(file));
    if (all.length < 2) {
      setParsed(null);
      setMessage({ ok: false, text: 'That file has a header row at most — nothing to import.' });
      return;
    }
    const [headers, ...rows] = all;
    setParsed({ headers, rows, fileName: file.name });
    setMapping(Object.fromEntries(STAT_FIELDS.map((f) => [f.key, guessColumn(headers, f.synonyms)])));
  }

  async function handleImport() {
    const rows = parsed.rows
      .map((row) => {
        const out = {};
        for (const f of STAT_FIELDS) {
          const idx = mapping[f.key];
          out[f.key] = idx >= 0 ? parseValue(f, row[idx]) : null;
        }
        return out;
      })
      .filter((r) => r.name);
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.importSeasonStats(rows, parsed.fileName);
      setMessage({ ok: true, text: `${result.rows} players imported · ${result.matched} matched to your player list` });
      setParsed(null);
      onImported?.(result);
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const mappedCount = STAT_FIELDS.filter((f) => f.type && mapping[f.key] >= 0).length;

  return (
    <div className="card stats-import">
      <div className="stats-import__head">
        <div>
          <div className="card-title">Import actual stats</div>
          <div className="card-subtitle">
            A CSV with one row per player, season to date. Each import replaces the last one. Players are matched to
            your list by name, NHL team and position; anyone who isn’t in it is still listed.
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="stats-import__actions">
        <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>
          {parsed ? 'Choose another file' : 'Choose CSV'}
        </button>
        <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
        {parsed && (
          <span className="stats-import__file">
            {parsed.fileName} · {parsed.rows.length} rows · {mappedCount} stat columns found
          </span>
        )}
        {message && <span className={`season-import__msg${message.ok ? '' : ' season-import__msg--error'}`}>{message.text}</span>}
      </div>

      {parsed && (
        <>
          <div className="stats-import__grid">
            {STAT_FIELDS.map((f) => (
              <label key={f.key} className="stats-import__field">
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                <select
                  className="field-select"
                  value={mapping[f.key]}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
                >
                  <option value={-1}>— not in file —</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleImport}
            disabled={busy || mapping.name < 0}
            title={mapping.name < 0 ? 'Pick the column with player names first' : undefined}
          >
            {busy ? 'Importing…' : `Import ${parsed.rows.length} players`}
          </button>
        </>
      )}
    </div>
  );
}
