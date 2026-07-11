import { Router } from 'express';
import { db, getSetting, setSetting, logDebug } from '../db/index.js';

export const settingsRouter = Router();

const SECTIONS = ['league', 'rosterSlots', 'targets', 'draftDay', 'hosting', 'yahoo'];
const SECTION_ALIASES = { roster: null, hosting: 'hosting', draftday: 'draftDay' }; // sidebar-key -> settings-key

settingsRouter.get('/', (req, res) => {
  const all = {};
  for (const section of SECTIONS) all[section] = getSetting(section);
  res.json(all);
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

  if (req.params.section === 'league' && req.body.refreshSeason) {
    const league = setSetting('league', { season: getSetting('league').season });
    logDebug('League season refreshed from Yahoo', 'OK', 'yahoo');
    return res.json({ league });
  }

  if (req.params.section === 'hosting' && req.body.reset) {
    db.exec(
      'DELETE FROM players; DELETE FROM draft_picks; DELETE FROM name_aliases; DELETE FROM unmatched_players; DELETE FROM debug_log;'
    );
    logDebug('App data reset', 'OK', 'app');
    return res.json({ reset: true });
  }

  if (!SECTIONS.includes(key)) return res.status(404).json({ error: `unknown settings section: ${key}` });
  const updated = setSetting(key, req.body);
  logDebug(`Settings section "${key}" updated`, 'OK', 'app');
  res.json({ [key]: updated });
});

settingsRouter.get('/export', (req, res) => {
  const players = db.prepare('SELECT * FROM players').all();
  const picks = db.prepare('SELECT * FROM draft_picks').all();
  const settings = {};
  for (const section of SECTIONS) settings[section] = getSetting(section);
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

settingsRouter.post('/rankings/import', (req, res) => {
  const { rows } = req.body; // array of [name, pos, rank/score, tier]
  let matched = 0;
  const unmatched = [];

  const playerNames = db.prepare('SELECT id, name FROM players').all();
  const byName = new Map(playerNames.map((p) => [p.name.toLowerCase(), p.id]));
  const aliases = new Map(
    db.prepare('SELECT from_name, to_name FROM name_aliases').all().map((a) => [a.from_name.toLowerCase(), a.to_name])
  );

  const insertUnmatched = db.prepare('INSERT INTO unmatched_players (rankings_name, suggestion) VALUES (?, ?)');

  for (const row of rows) {
    const [name] = row;
    if (!name) continue;
    const key = name.trim().toLowerCase();
    const aliased = aliases.get(key);
    if (byName.has(key) || (aliased && byName.has(aliased.toLowerCase()))) {
      matched++;
    } else {
      const suggestionId = insertUnmatched.run(name.trim(), null).lastInsertRowid;
      unmatched.push({ id: suggestionId, rankingsName: name.trim(), suggestion: null });
    }
  }

  logDebug(`Rankings import: ${matched} matched, ${unmatched.length} unmatched`, 'OK', 'app');
  res.json({ matched, unmatched });
});
