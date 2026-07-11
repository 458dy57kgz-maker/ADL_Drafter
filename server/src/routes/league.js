import { Router } from 'express';
import { db, logDebug } from '../db/index.js';
import { buildMockPlayers } from '../lib/mockData.js';
import { round } from '../lib/draftMath.js';
import { getSetting, setSetting } from '../db/index.js';

export const leagueRouter = Router();

// "Start New Season" from Settings > League: archives the current draft and
// re-pulls fresh league/team/player data. Real Yahoo integration will
// replace buildMockPlayers() with actual API calls; the archive + reset
// sequencing stays the same.
leagueRouter.post('/new-season', (req, res) => {
  const archiveTable = `draft_picks_archive_${Date.now()}`;
  db.exec(`CREATE TABLE "${archiveTable}" AS SELECT * FROM draft_picks`);

  db.exec('DELETE FROM draft_picks; DELETE FROM players;');

  const players = buildMockPlayers();
  const insertPlayer = db.prepare(`
    INSERT INTO players
      (id, name, pos, team, rank, overall_rank, adp, tier, g, a, p, ppp, plus_minus, shots, w, gaa, saves, drafted, drafted_by, mine, tracked)
    VALUES
      (@id, @name, @pos, @team, @rank, @overallRank, @adp, @tier, @g, @a, @p, @ppp, @plusMinus, @shots, @w, @gaa, @saves, 0, NULL, 0, 0)
  `);
  const insertMany = db.transaction((rows) => {
    for (const p of rows) insertPlayer.run(p);
  });
  insertMany(players);

  const league = getSetting('league');
  setSetting('league', { season: `${Number(league.season.slice(0, 4)) + 1} (nhl)` });

  logDebug(`New season started — previous draft archived to ${archiveTable}`, 'OK', 'app');
  res.json({ archived: archiveTable, playerCount: players.length });
});
