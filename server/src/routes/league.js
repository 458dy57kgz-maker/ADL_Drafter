import { Router } from 'express';
import { db, getSetting, setSetting, logDebug } from '../db/index.js';
import { reconcileLeague } from '../lib/leagueSync.js';
import { fetchLeagueTeams } from '../lib/yahooOAuth.js';

export const leagueRouter = Router();

// Yahoo league keys are "<game>.l.<leagueId>" — the NHL game code is stable
// enough to assume here, and the league ID comes from Settings > Yahoo
// Connection.
function leagueKeyFor(leagueId) {
  return `nhl.l.${String(leagueId).trim()}`;
}

// Pulls the league's team list from Yahoo and overwrites whatever is stored.
// The League settings page only allows hand-editing teams while no Yahoo
// pull has happened, so this is the authoritative source once it works.
leagueRouter.post('/pull-teams', async (req, res) => {
  const league = getSetting('league');
  const yahoo = getSetting('yahoo');

  if (!yahoo.connected || !yahoo.accessToken) {
    return res.status(400).json({ error: 'Not connected to Yahoo — connect on the Yahoo Connection page first.' });
  }
  if (!league.leagueId || !String(league.leagueId).trim()) {
    return res.status(400).json({ error: 'No League ID saved — set one on the Yahoo Connection page first.' });
  }

  const result = await fetchLeagueTeams(yahoo.accessToken, leagueKeyFor(league.leagueId));
  if (!result.ok) {
    logDebug(`Yahoo league team pull failed: ${result.status} ${result.statusText} — ${result.body}`, 'ERROR', 'yahoo');
    return res.status(502).json({
      error: `Yahoo rejected the request (${result.status} ${result.statusText})`,
      detail: result.body,
    });
  }
  if (result.teams.length === 0) {
    logDebug('Yahoo league team pull returned no teams', 'ERROR', 'yahoo');
    return res.status(502).json({ error: 'Yahoo returned no teams for that league ID.' });
  }

  // Keep "my team" pointing at the same team across a re-pull when the team
  // key still exists; otherwise it needs picking again on the League page.
  const stillThere = result.teams.some((t) => t.id === league.myTeamId);
  const myTeamId = stillThere ? league.myTeamId : null;
  const myTeamSlot = stillThere ? result.teams.findIndex((t) => t.id === myTeamId) + 1 : 1;

  const updated = setSetting('league', {
    teams: result.teams,
    teamCount: result.teams.length,
    myTeamId,
    myTeamSlot,
    teamsFromYahoo: true,
  });
  reconcileLeague(db, league, updated);

  logDebug(`Pulled ${result.teams.length} teams from Yahoo league ${league.leagueId}`, 'OK', 'yahoo');
  res.json({ league: updated, teamCount: result.teams.length });
});
