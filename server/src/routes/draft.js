import { Router } from 'express';
import { db, getSetting } from '../db/index.js';
import { mapPlayerRow } from '../lib/mapPlayer.js';
import { rankDeltaStyle } from '../lib/rankDelta.js';
import { scarcityStyle } from '../lib/scarcity.js';
import { round, nextPickForSlot, slotForPick } from '../lib/draftMath.js';

export const draftRouter = Router();

const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];
const POS_TOTAL = { C: 20, LW: 20, RW: 20, D: 30, G: 20 }; // rostered-pool size per position across the league

function contribText(p) {
  if (p.pos === 'G') return `W${p.w} GAA${p.gaa}`;
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

  const players = db.prepare('SELECT * FROM players ORDER BY overall_rank ASC').all().map(mapPlayerRow);

  const pickCount = db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n;
  const currentPick = pickCount + 1;
  const teamCount = league.teamCount;
  const currentRound = round(currentPick, teamCount);
  const mySlot = league.myTeamSlot ?? 1;
  const isMyTurnNow = slotForPick(currentPick, teamCount) === mySlot;
  const myNextPick = isMyTurnNow ? currentPick : nextPickForSlot(currentPick + 1, teamCount, mySlot);
  const picksUntilMe = isMyTurnNow ? 0 : myNextPick - currentPick;

  const lanes = {};
  POS_ORDER.forEach((pos) => {
    const avail = players.filter((p) => p.pos === pos && !p.drafted).sort((a, b) => a.rank - b.rank);
    const left = avail.length;
    const total = POS_TOTAL[pos];
    const taken = Math.max(0, total - left);
    lanes[pos] = {
      scarcity: { left, taken, takenPct: Math.round((taken / total) * 100), ...scarcityStyle(left) },
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

  const mine = players.filter((p) => p.mine);
  const rosterSlotRows = [];
  ['C', 'LW', 'RW', 'D', 'G'].forEach((pos) => {
    const count = rosterSlots[pos] ?? 0;
    const filled = mine.filter((p) => p.pos === pos);
    for (let i = 0; i < count; i++) {
      rosterSlotRows.push({ pos, player: filled[i] ?? null });
    }
  });

  const sumSkater = (key) => mine.filter((p) => p.pos !== 'G').reduce((acc, p) => acc + (p[key] || 0), 0);
  const sumGoalie = (key) => mine.filter((p) => p.pos === 'G').reduce((acc, p) => acc + (p[key] || 0), 0);
  const targetRows = [
    { label: 'Goals', current: sumSkater('g'), goal: targets.goals },
    { label: 'Assists', current: sumSkater('a'), goal: targets.assists },
    { label: 'PPP', current: sumSkater('ppp'), goal: targets.ppp },
    { label: '+/-', current: sumSkater('plusMinus'), goal: targets.plusMinus },
    { label: 'Shots', current: sumSkater('shots'), goal: targets.shots },
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
    .map((p) => ({ id: p.id, name: p.name, pos: p.pos, drafted: p.drafted && !p.mine, draftedBy: p.draftedBy }));

  return {
    pickInfo: { pickNum: currentPick, round: currentRound, picksUntilMe },
    yahooConnected: !!yahoo.connected,
    pollInterval: draftDay.pollInterval,
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
