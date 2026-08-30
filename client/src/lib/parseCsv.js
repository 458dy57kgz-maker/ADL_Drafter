// Minimal RFC4180-ish CSV parser: handles quoted fields (embedded commas,
// embedded newlines, "" as an escaped quote). The previous `line.split(',')`
// approach broke on any quoted field containing a comma and had no way to
// tell a header row from data.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows
    .map((r) => r.map((cell) => cell.trim()))
    .filter((r) => r.some((cell) => cell !== ''));
}

// Best-effort column guess by header name, tried in priority order.
export function guessColumn(headers, synonyms) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const syn of synonyms) {
    const idx = lower.findIndex((h) => h.includes(syn));
    if (idx !== -1) return idx;
  }
  return -1;
}
