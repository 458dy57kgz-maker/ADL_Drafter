import { Router } from 'express';
import { db, logDebug } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';

export const playersRouter = Router();

playersRouter.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM players ORDER BY overall_rank ASC').all();
  res.json(rows.map(mapPlayerRow));
});

const PATCHABLE_FIELDS = { tier: 'tier', tracked: 'tracked' };

playersRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'player not found' });

  const sets = [];
  const values = {};
  for (const [key, column] of Object.entries(PATCHABLE_FIELDS)) {
    if (key in req.body) {
      sets.push(`${column} = @${column}`);
      values[column] = typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key];
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'no patchable fields provided' });

  db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = @id`).run({ ...values, id });
  const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  logDebug(`Player ${updated.name} updated (${Object.keys(req.body).join(', ')})`, 'OK', 'app');
  res.json(mapPlayerRow(updated));
});
