import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playersRouter } from './routes/players.js';
import { draftRouter } from './routes/draft.js';
import { settingsRouter } from './routes/settings.js';
import { yahooRouter } from './routes/yahoo.js';
import { debugRouter } from './routes/debug.js';
import { leagueRouter } from './routes/league.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/players', playersRouter);
app.use('/api/draft', draftRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/yahoo', yahooRouter);
app.use('/api/debug', debugRouter);
app.use('/api/league', leagueRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// In production the Docker image builds the client and drops it next to the
// server; serve it directly so one container/one port covers the whole app.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'not found' });
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`ADL Drafter server listening on :${PORT}`);
});
