// Season mode's one picture of the league: every player worth listing, who
// owns him, what I projected for him and what he's actually done. Built from
// three sources that were never designed to line up — my draft pool, Yahoo's
// rosters and whatever stats sheet I import — so everything here is about
// joining them by name without inventing matches. Pure, like draftBoard.js,
// so it's tested without a database.

import { matchPlayer, parseFeedName } from './pickFeed.js';
import { normalizePosList, PROFILE_FIELDS } from './mapPlayer.js';
import { BENCH_WEIGHT } from './roster.js';
import { SEASON_SLOTS, INACTIVE_SLOTS } from './yahooRosters.js';

// The stat line both halves of a player carry, projected and actual.
export const STAT_KEYS = ['gp', 'g', 'a', 'p', 'ppp', 'plusMinus', 'shots', 'blocks', 'w', 'gaa', 'saves'];

const STARTING_SLOTS = ['C', 'LW', 'RW', 'D', 'G', 'Util'];

// The league's head-to-head categories as season mode scores them — the
// ones I find predictable. +/- is scored by the league but left out on
// purpose: it says more about a player's linemates than about him. Points
// sits beside goals and assists because the league counts it separately.
// GAA is the odd one: an average, not a total, and lower wins.
export const SEASON_CATEGORIES = [
  { key: 'g', label: 'Goals', side: 'skater' },
  { key: 'a', label: 'Assists', side: 'skater' },
  { key: 'p', label: 'Points', side: 'skater' },
  { key: 'ppp', label: 'PPP', side: 'skater' },
  { key: 'shots', label: 'Shots', side: 'skater' },
  { key: 'blocks', label: 'Blocks', side: 'skater' },
  { key: 'w', label: 'Wins', side: 'goalie' },
  { key: 'saves', label: 'Saves', side: 'goalie' },
  { key: 'gaa', label: 'GAA', side: 'goalie', average: true, lowerIsBetter: true, decimals: 2 },
];

function isGoalie(line) {
  return (line.posList ?? []).includes('G');
}

// A team's number in each category. Counting categories add up, the bench
// at `benchWeight`. GAA is the team's goalies' GAA averaged by games played
// — Yahoo divides goals against by minutes, which no sheet here carries, so
// this is the close stand-in. A goalie with no games played yet is left out
// of it rather than dragging the average to zero; with no goalie at all the
// team has no GAA (null).
export function seasonTotals(starters, bench, benchWeight = BENCH_WEIGHT) {
  const lines = [
    ...starters.map((line) => ({ line, weight: 1 })),
    ...bench.map((line) => ({ line, weight: benchWeight })),
  ];
  const totals = {};
  for (const cat of SEASON_CATEGORIES) {
    const side = lines.filter(({ line }) => (cat.side === 'goalie') === isGoalie(line));
    if (cat.average) {
      let sum = 0;
      let games = 0;
      for (const { line, weight } of side) {
        const value = line[cat.key];
        const gp = (line.gp ?? 1) * weight;
        if (value == null || !(gp > 0)) continue;
        sum += value * gp;
        games += gp;
      }
      totals[cat.key] = games > 0 ? sum / games : null;
    } else {
      totals[cat.key] = side.reduce((sum, { line, weight }) => sum + (line[cat.key] || 0) * weight, 0);
    }
  }
  return totals;
}

// Reputation and luck, as the preseason sheet had them; null when the sheet
// carried none of it for this player.
function profileLine(source) {
  const line = {};
  let any = false;
  for (const { key } of PROFILE_FIELDS) {
    line[key] = source[key] ?? null;
    if (line[key] != null) any = true;
  }
  return any ? line : null;
}

function statLine(source) {
  const line = {};
  let any = false;
  for (const key of STAT_KEYS) {
    const value = source[key] ?? null;
    line[key] = value;
    if (value != null) any = true;
  }
  return any ? line : null;
}

// The pickFeed matcher, but indexed by surname first so a sheet of a
// thousand players against a pool of hundreds stays quick. Returns the
// player or null; an ambiguity the name, team and position can't settle is
// left unmatched rather than guessed.
export function makeMatcher(players, aliases = new Map()) {
  const bySurname = new Map();
  for (const p of players) {
    const parsed = parseFeedName(p.name);
    if (!parsed) continue;
    if (!bySurname.has(parsed.last)) bySurname.set(parsed.last, []);
    bySurname.get(parsed.last).push(p);
  }
  return function match({ name, team, pos }) {
    const parsed = parseFeedName(name);
    if (!parsed) return null;
    // An alias is me saying outright which pool name a sheet name means.
    const aliased = aliases.get(parsed.full);
    const lookup = aliased ? parseFeedName(aliased) : parsed;
    const candidates = bySurname.get(lookup?.last) ?? [];
    if (!candidates.length) return null;
    return matchPlayer({ player: aliased ?? name, nhlTeam: team, position: pos }, candidates)?.player ?? null;
  };
}

// Seats in reading order: starters as Yahoo lists them, then the bench,
// then the injury lists. Within a slot, Yahoo's own order.
export function seatOrder(a, b) {
  const rank = (slot) => {
    const i = SEASON_SLOTS.indexOf(slot);
    return i === -1 ? SEASON_SLOTS.length : i;
  };
  return rank(a.slot) - rank(b.slot) || a.seat - b.seat;
}

// 1 = best. Tied totals share a rank, so two teams level on wins are both
// 3rd and the next one is 5th. Lower wins for GAA; a team with no number at
// all (no goalie, so no GAA) ranks behind every team that has one.
export function rankTotals(teams, key) {
  const ranks = {};
  for (const cat of SEASON_CATEGORIES) {
    const better = (a, b) => (cat.lowerIsBetter ? a < b : a > b);
    for (const t of teams) {
      const mine = t[key][cat.key];
      if (!ranks[t.num]) ranks[t.num] = {};
      ranks[t.num][cat.key] =
        1 +
        teams.filter((o) => {
          const theirs = o[key][cat.key];
          if (theirs == null) return false;
          return mine == null || better(theirs, mine);
        }).length;
    }
  }
  return ranks;
}

/**
 * @param pool        my draft pool, already through mapPlayerRow
 * @param rosterRows  season_rosters rows
 * @param statsRows   season_stats rows, stat keys in camelCase
 * @param teamNames   Map of Yahoo team number -> name
 * @param myTeamNum   which of those is mine, or null
 */
export function buildSeason({ pool, rosterRows, statsRows, teamNames, myTeamNum = null, aliases = new Map() }) {
  const entities = new Map();
  const add = (entity) => {
    entities.set(entity.key, entity);
    return entity;
  };

  for (const p of pool) {
    add({
      key: `p${p.id}`,
      id: p.id,
      name: p.name,
      pos: p.pos,
      posList: p.posList,
      team: p.team,
      flag: p.flag,
      overallRank: p.overallRank,
      adp: p.adp ?? null,
      proj: statLine(p),
      profile: profileLine(p),
      act: null,
      owner: null,
      slot: null,
      status: null,
    });
  }

  // Rosters. A player I never ranked still belongs on his team's card and in
  // the player list — he's just one with no projection.
  const keyForRow = new Map();
  for (const r of rosterRows) {
    if (!r.player_name) continue;
    const entity =
      (r.player_id != null && entities.get(`p${r.player_id}`)) ||
      add({
        key: `y${r.yahoo_player_id ?? r.id}`,
        id: null,
        name: r.player_name,
        pos: r.pos,
        posList: normalizePosList(r.pos),
        team: r.nhl_team,
        flag: null,
        overallRank: null,
        adp: null,
        proj: null,
        profile: null,
        act: null,
      });
    keyForRow.set(r.id, entity.key);
    entity.owner = r.team_num;
    entity.slot = r.slot;
    entity.status = r.status ?? null;
    // Yahoo's team is today's; my sheet's is whenever I built it. A trade
    // since the draft shows up here.
    if (r.nhl_team) entity.team = r.nhl_team;
  }

  // Stats. Matched to the pool on import; anyone who wasn't gets a second
  // chance against the rostered players I never ranked, and failing that is
  // listed on his own — a free agent with real numbers is exactly the
  // waiver-wire candidate this page is for.
  const unranked = [...entities.values()].filter((e) => e.id == null);
  const matchUnranked = makeMatcher(unranked, aliases);
  const matchPool = makeMatcher(pool, aliases);
  for (const s of statsRows) {
    let entity = s.player_id != null ? entities.get(`p${s.player_id}`) : null;
    // A stored id that no longer exists means the pool was replaced since
    // the import; the name still knows who he is.
    if (!entity && s.player_id != null) {
      const p = matchPool({ name: s.name, team: s.team, pos: s.pos });
      entity = p ? entities.get(`p${p.id}`) : null;
    }
    if (!entity) {
      entity = matchUnranked({ name: s.name, team: s.team, pos: s.pos });
    }
    if (!entity || entity.act) {
      entity = add({
        key: `s${s.id}`,
        id: null,
        name: s.name,
        pos: s.pos,
        posList: normalizePosList(s.pos),
        team: s.team,
        flag: null,
        overallRank: null,
        adp: null,
        proj: null,
        profile: null,
        act: null,
        owner: null,
        slot: null,
        status: null,
      });
    }
    entity.act = statLine(s);
  }

  const players = [...entities.values()].map((e) => ({
    ...e,
    ownerName: e.owner != null ? teamNames.get(e.owner) ?? `Team ${e.owner}` : null,
  }));
  const byKey = new Map(players.map((p) => [p.key, p]));
  const entityForRow = (r) => byKey.get(keyForRow.get(r.id)) ?? null;

  const nums = [...teamNames.keys()].sort((a, b) => a - b);
  const teams = nums.map((num) => {
    const seats = rosterRows.filter((r) => r.team_num === num).sort(seatOrder);
    const rows = seats.map((r) => ({ slot: r.slot, player: entityForRow(r) }));
    const active = rows.filter((row) => row.player && !INACTIVE_SLOTS.includes(row.slot)).map((row) => row.player);

    // Actual: everything the players on the roster today have produced, IR
    // and not-active excepted. It's already happened, so no bench discount.
    const actualLines = active.filter((p) => p.act).map((p) => ({ posList: p.posList, ...p.act }));
    // Projected: the draft's own convention — starters in full, the bench at
    // BENCH_WEIGHT — so it reads like the War Room's Season Totals did.
    const withProj = (slotFilter) =>
      rows
        .filter((row) => row.player?.proj && slotFilter(row.slot))
        .map((row) => ({ posList: row.player.posList, ...row.player.proj }));
    const projected = seasonTotals(
      withProj((slot) => STARTING_SLOTS.includes(slot)),
      withProj((slot) => slot === 'BN')
    );

    return {
      num,
      name: teamNames.get(num),
      isMine: num === myTeamNum,
      rows,
      playerCount: rows.filter((row) => row.player).length,
      actual: roundTotals(seasonTotals(actualLines, [])),
      projected: roundTotals(projected),
    };
  });

  const actualRanks = rankTotals(teams, 'actual');
  const projectedRanks = rankTotals(teams, 'projected');
  for (const t of teams) {
    t.actualRanks = actualRanks[t.num];
    t.projectedRanks = projectedRanks[t.num];
  }

  return { teams, players, benchWeight: BENCH_WEIGHT };
}

// Whole numbers for the counting categories, two places for GAA.
function roundTotals(totals) {
  return Object.fromEntries(
    SEASON_CATEGORIES.map((cat) => {
      const v = totals[cat.key];
      if (v == null) return [cat.key, null];
      const f = 10 ** (cat.decimals ?? 0);
      return [cat.key, Math.round(v * f) / f];
    })
  );
}

// Which team is mine, guessed from the draft: the one holding the most of
// the players I drafted. Null when none of them turn up anywhere.
export function guessMyTeam(teams, pool) {
  const mine = new Set(pool.filter((p) => p.mine).map((p) => p.id));
  let best = null;
  for (const t of teams) {
    const count = t.rows.filter((r) => r.player?.id != null && mine.has(r.player.id)).length;
    if (count > 0 && (!best || count > best.count)) best = { num: t.num, count };
  }
  return best?.num ?? null;
}
