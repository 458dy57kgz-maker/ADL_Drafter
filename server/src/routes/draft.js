import { Router } from 'express';
import { db, getSetting, logDebug } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';
import { rankDeltaStyle } from '../lib/rankDelta.js';
import { scarcityStyle } from '../lib/scarcity.js';
import { round, nextPickForSlot, slotForPick } from '../lib/draftMath.js';
import { poolCoverage, poolVersion } from './players.js';

export const draftRouter = Router();

const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];

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

  // Single pass so a dual-eligible player (e.g. C/LW) only ever fills one
  // physical roster slot, not both — POS_ORDER decides which of their
  // eligible positions gets first claim on them.
  const mine = players.filter((p) => p.mine);
  const rosterSlotRows = [];
  const assignedIds = new Set();
  POS_ORDER.forEach((pos) => {
    const count = rosterSlots[pos] ?? 0;
    const eligible = mine.filter((p) => p.posList.includes(pos) && !assignedIds.has(p.id));
    for (let i = 0; i < count; i++) {
      const player = eligible[i] ?? null;
      if (player) assignedIds.add(player.id);
      rosterSlotRows.push({ pos, player });
    }
  });

  // Anyone left over once the starting slots are full sits on the bench —
  // a third centre in a two-C league doesn't vanish from the roster view, he
  // just shows up here. The row count is the configured bench size, but it
  // stretches if more players are somehow assigned than there are seats, so
  // a drafted player is never invisible.
  const benched = mine.filter((p) => !assignedIds.has(p.id));
  const benchRows = Math.max(rosterSlots.BENCH ?? 0, benched.length);
  for (let i = 0; i < benchRows; i++) {
    rosterSlotRows.push({ pos: 'BN', player: benched[i] ?? null });
  }

  const sumSkater = (key) => mine.filter((p) => !p.posList.includes('G')).reduce((acc, p) => acc + (p[key] || 0), 0);
  const sumGoalie = (key) => mine.filter((p) => p.posList.includes('G')).reduce((acc, p) => acc + (p[key] || 0), 0);
  const targetRows = [
    { label: 'Goals', current: sumSkater('g'), goal: targets.goals },
    { label: 'Assists', current: sumSkater('a'), goal: targets.assists },
    { label: 'PPP', current: sumSkater('ppp'), goal: targets.ppp },
    { label: '+/-', current: sumSkater('plusMinus'), goal: targets.plusMinus },
    { label: 'Shots', current: sumSkater('shots'), goal: targets.shots },
    { label: 'Blocks', current: sumSkater('blocks'), goal: targets.blocks },
    { label: 'Wins', current: sumGoalie('w'), goal: targets.wins },
    { label: 'Saves', current: sumGoalie('saves'), goal: targets.saves },
  ].map((t) => ({ ...t, pct: t.goal ? Math.min(100, Math.round((t.current / t.goal) * 100)) : 0 }));

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
    },
    pollInterval: draftDay.pollInterval,
    mockDraftMode: !!draftDay.mockDraftMode,
    lanes,
    roster: { slots: rosterSlotRows, benchCount: rosterSlots.BENCH, irCount: rosterSlots.IR },
    targets: targetRows,
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
