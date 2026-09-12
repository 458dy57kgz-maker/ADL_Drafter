import { Router } from 'express';
import { db, getSetting, logDebug } from '../db/index.js';
import { mapPlayerRow, normalizePosList } from '../lib/mapPlayer.js';
import { round, nextPickForSlot, slotForPick } from '../lib/draftMath.js';
import { poolCoverage } from './players.js';
import { buildBoard, offNightShare } from '../lib/draftBoard.js';
import { planSync, normalizeName, PLACEHOLDER_NAME } from '../lib/pickFeed.js';
import { mySlot, myTeamName } from '../lib/league.js';
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

// Cards per column. The 2a layout draws each player as a flat ~70px row
// rather than a boxed card, so a tall monitor fits ten; the column scrolls
// if the window can't show them all.
const BOARD_DEPTH = 10;

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
  const myDraftSlot = mySlot(league) ?? 1;
  const isMyTurnNow = slotForPick(currentPick, teamCount) === myDraftSlot;
  const myNextPick = isMyTurnNow ? currentPick : nextPickForSlot(currentPick + 1, teamCount, myDraftSlot);
  const picksUntilMe = isMyTurnNow ? 0 : myNextPick - currentPick;

  // One round per roster seat (IR isn't drafted into), which is what the
  // header's "ROUND 4 OF 16" and the feed's "46 of 192" count against.
  const totalRounds = [...POS_ORDER, 'BENCH'].reduce((sum, pos) => sum + (rosterSlots[pos] ?? 0), 0);
  const totalPicks = teamCount * totalRounds;
  const teamAtPick = (pick) => league.teams?.[slotForPick(pick, teamCount) - 1]?.name ?? null;
  const myPicks = [myNextPick, nextPickForSlot(myNextPick + 1, teamCount, myDraftSlot)].filter(
    (pk) => !totalPicks || pk <= totalPicks
  );
  // Every pick from now through my next one, named — "then Five Hole 48 ·
  // Blue Line 49 · YOU 50". Capped because at the turn of a round it can
  // be most of two rounds away.
  const upcoming = [];
  for (let pk = currentPick; pk <= myNextPick && upcoming.length < 20; pk++) {
    upcoming.push({ pickNum: pk, team: teamAtPick(pk), isMine: slotForPick(pk, teamCount) === myDraftSlot });
  }

  // Players an opponent drafted who aren't in my list at all. I only import
  // the players I'd consider taking, so most of the room's picks are people
  // I've never rated — and a roster with holes in it where those picks went
  // is worse than useless. They come through as pick rows with no player_id,
  // so they're rebuilt here as stat-less roster entries: the real name, the
  // position the draft room reported, and dashes for everything else.
  const myName = myTeamName(league);
  const unknownPicks = db
    .prepare('SELECT * FROM draft_picks WHERE player_id IS NULL')
    .all()
    .filter((r) => r.player_name !== PLACEHOLDER_NAME)
    .map((r) => ({
      id: `pick-${r.pick_num}`,
      name: r.player_name,
      pos: r.pos,
      posList: normalizePosList(r.pos),
      drafted: true,
      draftedBy: r.team,
      mine: !!myName && r.team === myName,
      // What makes the UI show a name and dashes rather than a name and zeros.
      unknown: true,
      overallRank: null,
      tier: null,
      adp: null,
    }));

  // Rosters count them; the board and its scarcity counts don't, since they
  // were never on my board to begin with.
  const rosterable = [...players, ...unknownPicks];

  // My own roster, shaped by the same code the Results page uses for the
  // other nine — see server/src/lib/roster.js.
  const mine = rosterable.filter((p) => p.mine);
  const myRoster = assignRoster(mine, rosterSlots);
  // Tier, off-night share and points are what the 2a roster table shows, so
  // the off-night share is computed here with the board's own definition
  // rather than re-derived in the browser.
  const rosterSlotRows = myRoster.rows.map((row) =>
    row.player
      ? {
          ...row,
          player: {
            ...row.player,
            ongPct: row.player.unknown ? null : (() => {
              const share = offNightShare(row.player);
              return share == null ? null : Math.round(share * 100);
            })(),
          },
        }
      : row
  );

  // Target Progress compares my weighted totals against whoever currently
  // leads each category, so the bar is the room rather than the calendar.
  // Bench players count at BENCH_WEIGHT for every manager alike.
  const teamSummaries = buildTeamSummaries(rosterable, league, rosterSlots, targets);
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
      // My total as a share of the leader's — "am I ahead in the room",
      // which is the figure the 2a strip prints under each ring.
      pctOfLeader: leader ? (leader.isMine ? 100 : Math.round((myTotals[cat.key] / leader.total) * 100)) : null,
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
  const ledCats = targetRows.filter((t) => t.pctOfLeader != null);
  const overallRow = {
    label: 'Overall',
    pct: myOverall,
    leader: overallLeader,
    pctOfLeader: ledCats.length ? Math.round(ledCats.reduce((s, t) => s + t.pctOfLeader, 0) / ledCats.length) : null,
  };

  // The Best Available board. `nextPick` is always my next turn strictly
  // AFTER the current pick — including while I'm on the clock, since the
  // question every card answers is "if I don't take him now, will he last?"
  // Every remaining turn of mine, which is what the board's pick windows are
  // measured against. Capped so a half-configured roster can't spin it.
  const myPickNumbers = [];
  for (
    let pk = isMyTurnNow ? currentPick : myNextPick;
    (!totalPicks || pk <= totalPicks) && myPickNumbers.length < 40;
    pk = nextPickForSlot(pk + 1, teamCount, myDraftSlot)
  ) {
    myPickNumbers.push(pk);
  }

  const board = buildBoard({
    players,
    positions: POS_ORDER,
    rosterSlots,
    myPlayers: mine,
    currentPick,
    nextPick: nextPickForSlot(currentPick + 1, teamCount, myDraftSlot),
    myPickNumbers,
    teamCount,
    isMyTurn: isMyTurnNow,
    depth: BOARD_DEPTH,
  });

  // Enough history to fill the two-column Live Picks panel on a tall screen;
  // it clips rather than scrolls, like the design.
  const liveFeed = db
    .prepare('SELECT * FROM draft_picks ORDER BY pick_num DESC LIMIT 40')
    .all()
    .map((r) => ({
      pickNum: r.pick_num,
      team: r.team,
      playerName: r.player_name,
      pos: r.pos,
      isMine: !!myName && r.team === myName,
    }));

  const onTheClockSlot = slotForPick(currentPick, teamCount);
  const onTheClockTeam = league.teams?.[onTheClockSlot - 1] ?? null;

  return {
    pickInfo: {
      pickNum: currentPick,
      round: currentRound,
      picksUntilMe,
      onTheClock: onTheClockTeam?.name ?? null,
      isMyTurnNow,
      pickCount,
      totalRounds,
      totalPicks,
      myPicks,
      upcoming,
    },
    yahooConnected: !!yahoo.connected,
    // Liveness for whatever is pushing picks — the Yahoo tracker bookmarklet,
    // or the browser watching a file. Either way the server sees it, so the
    // War Room can show one indicator for both.
    feed: lastFeedPush,
    coverage: poolCoverage(),
    pollInterval: draftDay.pollInterval,
    mockDraftMode: !!draftDay.mockDraftMode,
    board,
    roster: { slots: rosterSlotRows, benchCount: rosterSlots.BENCH, irCount: rosterSlots.IR },
    targets: targetRows,
    overall: overallRow,
    benchWeight: BENCH_WEIGHT,
    liveFeed,
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

  // Same treatment as the War Room: picks that matched nobody in my list are
  // still real players on somebody's roster.
  const unknownPicks = db
    .prepare('SELECT * FROM draft_picks WHERE player_id IS NULL')
    .all()
    .filter((r) => r.player_name !== PLACEHOLDER_NAME)
    .map((r) => ({
      id: `pick-${r.pick_num}`,
      name: r.player_name,
      pos: r.pos,
      posList: normalizePosList(r.pos),
      drafted: true,
      draftedBy: r.team,
      unknown: true,
      pickNum: r.pick_num,
      round: r.round,
    }));

  const summaries = buildTeamSummaries([...players, ...unknownPicks], league, rosterSlots, targets);
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
  const isMine = slot === mySlot(league);

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

// Steps back one pick. The overlay's Go Back button calls this repeatedly to
// walk backwards through the draft, so the response names the player it freed
// up: that's what lands in the search box, ready to be re-picked or replaced.
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
  res.json({
    undonePickNum: last.pick_num,
    playerId: last.player_id,
    playerName: last.player_name,
    team: last.team,
  });
});

// --- Live pick feed --------------------------------------------------------
//
// A Chrome bookmarklet appends every pick Yahoo announces to a JSON file on
// the drafting machine. The browser reads that file and posts its contents
// here; the server owns the reconciliation. The whole array is sent every
// time rather than a delta, which makes this idempotent and self-healing —
// a pick corrected in the file corrects itself here on the next poll.

// Whether anything is actually feeding us picks, and when. Held in memory
// rather than the database: it describes this process's last few minutes, not
// the draft, and a restart genuinely does mean "nothing has pushed yet".
let lastFeedPush = null;
// The last array anything sent us, kept so the draft order can be recovered
// from Settings even when the sync itself was refused for lacking one.

function aliasMap() {
  const map = new Map();
  for (const row of db.prepare('SELECT from_name, to_name FROM name_aliases').all()) {
    map.set(normalizeName(row.from_name), row.to_name);
  }
  return map;
}

// Takes the tracker's whole pick list and files every pick by the slot its
// number lands on. The feed's own team names are Yahoo's labels for those
// managers and are never read — the names in Settings > League are the
// user's own, and the app does not try to reconcile the two.
draftRouter.post('/feed/sync', (req, res) => {
  const picks = req.body?.picks;
  if (!Array.isArray(picks)) return res.status(400).json({ error: 'picks must be an array' });

  // An empty feed means "I have nothing to report" — a tracker that just
  // started, or a page that hasn't rendered its pick list yet. It must never
  // mean "delete the draft": that is what /draft/reset is for, and a stray
  // empty push wiping a draft mid-round is unrecoverable.
  if (picks.length === 0) {
    return res.json({ picks: db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n, added: 0, noop: true, unmatched: [], gapBefore: 0, lastPick: 0, matched: 0 });
  }

  const league = getSetting('league');

  // The only thing a push can't work without is the seating: how many teams
  // there are, and which seat is mine. Every pick is filed by the slot its
  // number lands on, and the feed's own team names are never read — those are
  // Yahoo's labels, and the names in Settings > League are the user's.
  const blocked = !league.teams?.length
    ? 'no teams set up yet — add them in Settings > League, in draft order'
    : null;
  if (blocked) {
    lastFeedPush = { at: Date.now(), blocked, received: picks.length };
    return res.status(409).json({ error: blocked });
  }

  const players = db
    .prepare('SELECT * FROM players ORDER BY overall_rank ASC')
    .all()
    .map((row) => mapPlayerRow(row, league.teamCount));

  const plan = planSync({
    feedPicks: picks,
    players,
    teams: league.teams,
    teamCount: league.teamCount,
    myTeamSlot: mySlot(league),
    aliases: aliasMap(),
    existingBefore: db.prepare('SELECT * FROM draft_picks').all(),
  });

  const before = db.prepare('SELECT COUNT(*) AS n FROM draft_picks').get().n;

  db.transaction(() => {
    db.exec('DELETE FROM draft_picks');
    const insert = db.prepare(
      `INSERT INTO draft_picks (pick_num, round, team, player_id, player_name, pos)
       VALUES (@pickNum, @round, @team, @playerId, @playerName, @pos)`
    );
    for (const row of plan.rows) {
      insert.run({
        pickNum: row.pickNum,
        round: round(row.pickNum, league.teamCount),
        team: row.team,
        playerId: row.playerId,
        playerName: row.playerName,
        pos: row.pos,
      });
    }
    // Rebuilt from the pick list rather than patched, so a pick removed from
    // the feed hands its player back to the pool without a special case.
    db.exec('UPDATE players SET drafted = 0, drafted_by = NULL, mine = 0');
    const claim = db.prepare('UPDATE players SET drafted = 1, drafted_by = @team, mine = @mine WHERE id = @id');
    for (const row of plan.rows) {
      if (row.playerId == null) continue;
      claim.run({ id: row.playerId, team: row.team, mine: row.mine ? 1 : 0 });
    }
  })();

  const after = plan.rows.length;
  lastFeedPush = { at: Date.now(), picks: after, lastPick: plan.lastPick, unmatched: plan.unmatched.length };
  if (after !== before) {
    logDebug(`Live feed: ${after} picks (${after - before >= 0 ? '+' : ''}${after - before}), ${plan.unmatched.length} unmatched`, 'OK', 'yahoo');
  }

  res.json({
    picks: after,
    added: Math.max(0, after - before),
    lastPick: plan.lastPick,
    gapBefore: plan.gapBefore,
    unmatched: plan.unmatched,
    matched: plan.rows.filter((r) => r.source === 'feed' && r.playerId != null).length,
  });
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
