import { Router } from 'express';
import { db, getSetting, logDebug } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';
import { rankDeltaStyle } from '../lib/rankDelta.js';
import { scarcityStyle } from '../lib/scarcity.js';
import { round, nextPickForSlot, slotForPick } from '../lib/draftMath.js';
import { poolCoverage, poolVersion } from './players.js';
import {
  POS_ORDER,
  BENCH_WEIGHT,
  TARGET_CATEGORIES,
  assignRoster,
  buildTeamSummaries,
  categoryTotals,
  pctOf,
  overallPct,
} from '../lib/roster.js';

export const draftRouter = Router();

// Settings > Roster names targets after the thing you count; the value engine
// names them after the stat column. `plusMinus` is deliberately absent: a
// season target only means something for a stat that accumulates toward one,
// and the engine's own guidance is to omit non-cumulative categories. Points
// is absent for the same reason it has no target in the UI — it is g + a.
const TARGET_TO_CATEGORY = {
  goals: 'g',
  assists: 'a',
  ppp: 'ppp',
  shots: 'shots',
  blocks: 'blocks',
  wins: 'w',
  saves: 'saves',
};

// Targets calibrate the opponent model rather than entering the score, so a
// zero or a blank is not "aim for nothing" — it is "no information", and the
// engine should keep its pool-derived estimate for that category.
function seasonTargets(targets) {
  const out = {};
  for (const [settingKey, categoryKey] of Object.entries(TARGET_TO_CATEGORY)) {
    const value = targets?.[settingKey];
    if (typeof value === 'number' && value > 0) out[categoryKey] = value;
  }
  return out;
}

function contribText(p) {
  if (p.posList.includes('G')) return `W${p.w} GAA${p.gaa}`;
  const bits = [];
  if (p.g) bits.push(`+${p.g}G`);
  if (p.ppp) bits.push(`+${p.ppp}PPP`);
  return bits.join(' ');
}

function buildState() {
  const league = getSetting('league');
  const rosterSlots = getSetting('rosterSlots');
  const targets = getSetting('targets');
  const draftDay = getSetting('draftDay');
  const yahoo = getSetting('yahoo');

  const teamCount = league.teamCount;
  const players = db
    .prepare('SELECT * FROM players ORDER BY overall_rank ASC')
    .all()
    .map((row) => mapPlayerRow(row, teamCount));

  const pickCount = db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n;
  const currentPick = pickCount + 1;
  const currentRound = round(currentPick, teamCount);
  const mySlot = league.myTeamSlot ?? 1;
  const isMyTurnNow = slotForPick(currentPick, teamCount) === mySlot;
  const myNextPick = isMyTurnNow ? currentPick : nextPickForSlot(currentPick + 1, teamCount, mySlot);
  const picksUntilMe = isMyTurnNow ? 0 : myNextPick - currentPick;

  const lanes = {};
  POS_ORDER.forEach((pos) => {
    // A dual-eligible player (e.g. C/LW) legitimately appears in more than
    // one lane — sorted by overall rank rather than the stored positional
    // `rank`, since that single column can't hold two different ranks (one
    // per eligible position) for the same player.
    const avail = players
      .filter((p) => p.posList.includes(pos) && !p.drafted)
      .sort((a, b) => a.overallRank - b.overallRank);
    const left = avail.length;
    // How many the league still needs at this position, from the actual
    // roster settings rather than a hardcoded guess.
    const total = (rosterSlots[pos] ?? 0) * teamCount;
    // Counted directly rather than derived as (total - left): subtracting
    // only holds if the pool happens to be exactly `total` players deep, so
    // it reported a full sweep of phantom picks whenever the pool was
    // smaller — an empty pool showed every position as fully drafted.
    const taken = players.filter((p) => p.posList.includes(pos) && p.drafted).length;
    lanes[pos] = {
      scarcity: { left, taken, takenPct: total ? Math.round((taken / total) * 100) : 0, ...scarcityStyle(left) },
      players: avail.map((p) => ({
        id: p.id,
        name: p.name,
        overallRank: p.overallRank,
        tracked: p.tracked,
        contribText: contribText(p),
        rankDelta: rankDeltaStyle(p.overallRank - currentPick),
      })),
    };
  });

  // My own roster, shaped by the same code the Results page uses for the
  // other nine — see server/src/lib/roster.js.
  const mine = players.filter((p) => p.mine);
  const myRoster = assignRoster(mine, rosterSlots);
  const rosterSlotRows = myRoster.rows;

  // Target Progress compares my weighted totals against whoever currently
  // leads each category, so the bar is the room rather than the calendar.
  // Bench players count at BENCH_WEIGHT for every manager alike.
  const teamSummaries = buildTeamSummaries(players, league, rosterSlots, targets);
  const myTotals = categoryTotals(myRoster.starters, myRoster.bench);

  const targetRows = TARGET_CATEGORIES.map((cat) => {
    const goal = targets[cat.goalKey];
    // Only a team that has actually accumulated something leads a category —
    // ten teams tied on zero before the draft starts has no leader, and
    // naming whichever one sorts first would read as real information.
    let leader = null;
    for (const t of teamSummaries) {
      if (t.totals[cat.key] > 0 && (!leader || t.totals[cat.key] > leader.total)) {
        leader = { team: t.name, total: t.totals[cat.key], isMine: t.isMine };
      }
    }
    return {
      label: cat.label,
      key: cat.key,
      current: Math.round(myTotals[cat.key]),
      goal,
      pct: pctOf(myTotals[cat.key], goal),
      leader: leader
        ? { team: leader.team, current: Math.round(leader.total), pct: pctOf(leader.total, goal), isMine: leader.isMine }
        : null,
    };
  });

  const myOverall = overallPct(myTotals, targets);
  let overallLeader = null;
  for (const t of teamSummaries) {
    if (t.pickCount > 0 && (!overallLeader || t.overallPct > overallLeader.pct)) {
      overallLeader = { team: t.name, pct: t.overallPct, isMine: t.isMine };
    }
  }
  const overallRow = { label: 'Overall', pct: myOverall, leader: overallLeader };

  const scarcity = {};
  POS_ORDER.forEach((pos) => {
    scarcity[pos] = lanes[pos].scarcity;
  });

  const liveFeed = db
    .prepare('SELECT * FROM draft_picks ORDER BY pick_num DESC LIMIT 6')
    .all()
    .map((r) => ({ pickNum: r.pick_num, team: r.team, playerName: r.player_name, pos: r.pos }));

  const tracked = players
    .filter((p) => p.tracked)
    .map((p) => ({ id: p.id, name: p.name, pos: p.pos, drafted: p.drafted, draftedBy: p.draftedBy }));

  const onTheClockSlot = slotForPick(currentPick, teamCount);
  const onTheClockTeam = league.teams?.[onTheClockSlot - 1] ?? null;

  return {
    pickInfo: {
      pickNum: currentPick,
      round: currentRound,
      picksUntilMe,
      onTheClock: onTheClockTeam?.name ?? null,
      isMyTurnNow,
    },
    yahooConnected: !!yahoo.connected,
    // Everything the client-side value engine needs to decide whether to
    // rebuild its context, plus the data-quality warnings the panel shows.
    poolVersion: poolVersion(),
    coverage: poolCoverage(),
    engineConfig: {
      teamCount,
      mySlot,
      slots: { C: rosterSlots.C, LW: rosterSlots.LW, RW: rosterSlots.RW, D: rosterSlots.D, G: rosterSlots.G },
      benchSlots: rosterSlots.BENCH ?? 0,
      // Draft rounds are starters plus bench: IR isn't drafted into.
      totalRounds:
        (rosterSlots.C ?? 0) + (rosterSlots.LW ?? 0) + (rosterSlots.RW ?? 0) +
        (rosterSlots.D ?? 0) + (rosterSlots.G ?? 0) + (rosterSlots.BENCH ?? 0),
      // Sent on every poll so editing a target in Settings > Roster reaches
      // the engine without a rebuild — the client diffs this and pushes just
      // the new targets into the existing context.
      seasonTargets: seasonTargets(targets),
    },
    pollInterval: draftDay.pollInterval,
    mockDraftMode: !!draftDay.mockDraftMode,
    lanes,
    roster: { slots: rosterSlotRows, benchCount: rosterSlots.BENCH, irCount: rosterSlots.IR },
    targets: targetRows,
    overall: overallRow,
    benchWeight: BENCH_WEIGHT,
    scarcity,
    liveFeed,
    tracked,
  };
}

draftRouter.get('/state', (req, res) => {
  res.json(buildState());
});

draftRouter.get('/picks', (req, res) => {
  const rows = db.prepare('SELECT * FROM draft_picks ORDER BY pick_num DESC').all();
  res.json(
    rows.map((r) => ({ pickNum: r.pick_num, round: r.round, team: r.team, playerName: r.player_name, pos: r.pos }))
  );
});

// Every team's board, shaped exactly like My Roster on the War Room. Backs
// the Results page, and carries enough per-player detail (full stats plus the
// pick that landed them) for the CSV export to be built client-side without a
// second round trip. It reads live from the players table, so resetting the
// draft empties it on the next poll — there is nothing separate to clear.
draftRouter.get('/results', (req, res) => {
  const league = getSetting('league');
  const rosterSlots = getSetting('rosterSlots');
  const targets = getSetting('targets');
  const teamCount = league.teamCount;

  const players = db
    .prepare('SELECT * FROM players ORDER BY overall_rank ASC')
    .all()
    .map((row) => mapPlayerRow(row, teamCount));

  const pickByPlayer = new Map();
  for (const r of db.prepare('SELECT pick_num, round, player_id FROM draft_picks').all()) {
    if (r.player_id != null) pickByPlayer.set(r.player_id, { pickNum: r.pick_num, round: r.round });
  }

  const summaries = buildTeamSummaries(players, league, rosterSlots, targets);
  const decorate = (p) => (p ? { ...p, ...(pickByPlayer.get(p.id) ?? { pickNum: null, round: null }) } : null);

  const teams = summaries.map((t) => {
    const benchIds = new Set(t.benchIds);
    return {
      slot: t.slot,
      name: t.name,
      isMine: t.isMine,
      pickCount: t.pickCount,
      overallPct: t.overallPct,
      totals: Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, Math.round(v)])),
      rows: t.rows.map((row) => ({
        pos: row.pos,
        onBench: !!row.player && benchIds.has(row.player.id),
        player: decorate(row.player),
      })),
    };
  });

  // Picks made by a name that is no longer in Settings > League would
  // otherwise disappear from the page entirely — surfaced rather than
  // silently dropped, since it means the team list was edited mid-draft.
  const knownTeams = new Set((league.teams ?? []).map((t) => t.name));
  const orphans = players.filter((p) => p.drafted && !knownTeams.has(p.draftedBy));

  res.json({
    teams,
    benchWeight: BENCH_WEIGHT,
    categories: TARGET_CATEGORIES.map((c) => ({ label: c.label, key: c.key })),
    totalPicks: db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n,
    orphanPicks: orphans.map((p) => ({ ...decorate(p), draftedBy: p.draftedBy })),
  });
});

// Manual Draft Mode: hand-assign the next pick to whichever team is on the
// clock. Used both as a draft-day fallback if live Yahoo polling isn't
// available yet, and to run mock drafts that exercise the rest of the app
// (scarcity, roster, targets) against real pick data.
draftRouter.post('/pick', (req, res) => {
  const { playerId } = req.body;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'player not found' });
  if (player.drafted) return res.status(409).json({ error: 'player already drafted' });

  const league = getSetting('league');
  if (!league.teams?.length) {
    return res.status(400).json({ error: 'No teams set up yet — add them in Settings > League first.' });
  }

  const teamCount = league.teamCount;
  const pickNum = db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n + 1;
  const pickRound = round(pickNum, teamCount);
  const slot = slotForPick(pickNum, teamCount);
  const team = league.teams[slot - 1];
  if (!team) return res.status(400).json({ error: `no team configured for slot ${slot}` });
  const isMine = team.id === league.myTeamId;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO draft_picks (pick_num, round, team, player_id, player_name, pos)
       VALUES (@pickNum, @round, @team, @playerId, @playerName, @pos)`
    ).run({ pickNum, round: pickRound, team: team.name, playerId: player.id, playerName: player.name, pos: player.pos });
    db.prepare('UPDATE players SET drafted = 1, drafted_by = @draftedBy, mine = @mine WHERE id = @id').run({
      id: player.id,
      draftedBy: team.name,
      mine: isMine ? 1 : 0,
    });
  })();

  logDebug(`Manual pick #${pickNum}: ${team.name} -> ${player.name} (${player.pos})`, 'OK', 'app');
  const updated = mapPlayerRow(db.prepare('SELECT * FROM players WHERE id = ?').get(player.id), teamCount);
  res.status(201).json({ pickNum, round: pickRound, team: team.name, player: updated });
});

// Single-level undo — reverts only the single most recent pick.
draftRouter.post('/undo', (req, res) => {
  const last = db.prepare('SELECT * FROM draft_picks ORDER BY pick_num DESC LIMIT 1').get();
  if (!last) return res.status(400).json({ error: 'no picks to undo' });

  db.transaction(() => {
    db.prepare('DELETE FROM draft_picks WHERE pick_num = ?').run(last.pick_num);
    if (last.player_id != null) {
      db.prepare('UPDATE players SET drafted = 0, drafted_by = NULL, mine = 0 WHERE id = ?').run(last.player_id);
    }
  })();

  logDebug(`Undo pick #${last.pick_num} (${last.player_name})`, 'OK', 'app');
  res.json({ undonePickNum: last.pick_num, playerId: last.player_id });
});

// Clears every pick and hands all players back to the pool, leaving the
// player list itself untouched — that's the whole point when mock drafting,
// where you re-run the same board over and over.
draftRouter.post('/reset', (req, res) => {
  const clearedPicks = db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n;

  db.transaction(() => {
    db.exec('DELETE FROM draft_picks');
    db.exec('UPDATE players SET drafted = 0, drafted_by = NULL, mine = 0');
  })();

  logDebug(`Draft reset — ${clearedPicks} picks cleared, player list kept`, 'OK', 'app');
  res.json({ clearedPicks });
});
