import { Router } from 'express';
import { db } from '../db/index.js';

export const debugRouter = Router();

debugRouter.get('/log', (req, res) => {
  const rows = db.prepare('SELECT * FROM debug_log ORDER BY id DESC LIMIT 200').all();
  res.json(rows.map((r) => ({ time: r.time, msg: r.msg, status: r.status, type: r.type })));
});

debugRouter.delete('/log', (req, res) => {
  db.exec('DELETE FROM debug_log');
  res.status(204).end();
});
