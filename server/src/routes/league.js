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
//
// leagueId/season come from the League settings screen, which the operator
// edits directly — this route no longer silently bumps the season year on
// every click, since that left no way to go back to an earlier season.
leagueRouter.post('/new-season', (req, res) => {
  const { leagueId, season } = req.body || {};
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

  const patch = {};
  if (leagueId && leagueId.trim()) patch.leagueId = leagueId.trim();
  if (season && season.trim()) patch.season = season.trim();
  const league = Object.keys(patch).length ? setSetting('league', patch) : getSetting('league');

  logDebug(
    `New season started (league ${league.leagueId}, season ${league.season}) — previous draft archived to ${archiveTable}`,
    'OK',
    'app'
  );
  res.json({ archived: archiveTable, playerCount: players.length, league });
});
