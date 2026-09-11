import { Router } from 'express';
import { db, getSetting, setSetting, logDebug } from '../db/index.js';
import { reconcileLeague } from '../lib/leagueSync.js';

export const settingsRouter = Router();

const SECTIONS = ['league', 'rosterSlots', 'targets', 'draftDay', 'hosting', 'yahoo'];
const SECTION_ALIASES = { roster: null, hosting: 'hosting', draftday: 'draftDay' }; // sidebar-key -> settings-key

// The yahoo section holds the client secret and both OAuth tokens. The
// /api/yahoo routes redact those before responding; this bundle endpoint and
// the export file have to do the same, or the secrets leak out through the
// side door instead.
function readSettingsBundle() {
  const all = {};
  for (const section of SECTIONS) all[section] = getSetting(section);
  const yahoo = all.yahoo ?? {};
  all.yahoo = {
    connected: yahoo.connected,
    username: yahoo.username,
    connectionMode: yahoo.connectionMode,
    publicUrl: yahoo.publicUrl,
    clientId: yahoo.clientId,
    hasClientSecret: !!yahoo.clientSecret,
    lastCall: yahoo.lastCall,
  };
  return all;
}

settingsRouter.get('/', (req, res) => {
  res.json(readSettingsBundle());
});

settingsRouter.patch('/:section', (req, res) => {
  const key = SECTION_ALIASES[req.params.section] ?? req.params.section;

  // The Roster settings page edits two underlying sections (rosterSlots and
  // targets) in one request; route each provided key to its own section.
  if (req.params.section === 'roster') {
    const result = {};
    if (req.body.rosterSlots) result.rosterSlots = setSetting('rosterSlots', req.body.rosterSlots);
    if (req.body.targets) result.targets = setSetting('targets', req.body.targets);
    logDebug('Roster settings updated', 'OK', 'app');
    return res.json(result);
  }

  if (req.params.section === 'hosting' && req.body.reset) {
    db.exec(
      'DELETE FROM players; DELETE FROM draft_picks; DELETE FROM name_aliases; DELETE FROM unmatched_players; DELETE FROM debug_log;'
    );
    logDebug('App data reset', 'OK', 'app');
    return res.json({ reset: true });
  }

  if (!SECTIONS.includes(key)) return res.status(404).json({ error: `unknown settings section: ${key}` });
  const before = key === 'league' ? getSetting('league') : null;
  const updated = setSetting(key, req.body);
  // Picks are stored by team name and `mine` is stamped at pick time, so a
  // rename or a change of "my team" has to be carried through to them.
  if (key === 'league') reconcileLeague(db, before, updated);
  logDebug(`Settings section "${key}" updated`, 'OK', 'app');
  res.json({ [key]: updated });
});

settingsRouter.get('/export', (req, res) => {
  const players = db.prepare('SELECT * FROM players').all();
  const picks = db.prepare('SELECT * FROM draft_picks').all();
  const settings = readSettingsBundle();
  const aliases = db.prepare('SELECT * FROM name_aliases').all();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="adl-drafter-export.json"');
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), players, picks, settings, aliases }, null, 2));
});

// --- Rankings import: aliases, unmatched, CSV import -----------------------

settingsRouter.get('/rankings/aliases', (req, res) => {
  const rows = db.prepare('SELECT * FROM name_aliases ORDER BY id ASC').all();
  res.json(rows.map((r) => ({ id: r.id, from: r.from_name, to: r.to_name })));
});

settingsRouter.post('/rankings/aliases', (req, res) => {
  const { from, to } = req.body;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const result = db.prepare('INSERT INTO name_aliases (from_name, to_name) VALUES (?, ?)').run(from, to);
  logDebug(`Alias added: "${from}" -> "${to}"`, 'OK', 'app');
  res.status(201).json({ id: result.lastInsertRowid, from, to });
});

settingsRouter.delete('/rankings/aliases/:id', (req, res) => {
  db.prepare('DELETE FROM name_aliases WHERE id = ?').run(Number(req.params.id));
  res.status(204).end();
});

settingsRouter.get('/rankings/unmatched', (req, res) => {
  const rows = db.prepare('SELECT * FROM unmatched_players WHERE resolved = 0 ORDER BY id ASC').all();
  res.json(rows.map((r) => ({ id: r.id, rankingsName: r.rankings_name, suggestion: r.suggestion })));
});

settingsRouter.delete('/rankings/unmatched', (req, res) => {
  const { changes } = db.prepare('DELETE FROM unmatched_players WHERE resolved = 0').run();
  logDebug(`Cleared ${changes} unmatched import entries`, 'OK', 'app');
  res.json({ cleared: changes });
});

settingsRouter.post('/rankings/unmatched/:id', (req, res) => {
  const { decision } = req.body; // 'accept' | 'reject'
  const row = db.prepare('SELECT * FROM unmatched_players WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });

  if (decision === 'accept') {
    db.prepare('INSERT INTO name_aliases (from_name, to_name) VALUES (?, ?)').run(row.suggestion, row.rankings_name);
  }
  db.prepare('UPDATE unmatched_players SET resolved = 1 WHERE id = ?').run(row.id);
  logDebug(`Unmatched player "${row.rankings_name}" ${decision}ed`, 'OK', 'app');
  res.status(204).end();
});

// The CSV import itself lives in routes/players.js — one import handles
// adding, updating and removing, so there's no separate rankings-only path.
