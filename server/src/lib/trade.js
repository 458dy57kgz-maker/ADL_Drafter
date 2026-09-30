// The trade finder's arithmetic. Pure, like season.js, and run over its
// output: every player gets two numbers and every trade gets two checks.
//
//   my value      what he's worth to me in the league's categories — my
//                 projection, letting his actual pace in only slowly (hot
//                 starts regress), shaded by how lucky last season was.
//   market value  what the other managers think he's worth — Yahoo ADP and
//                 his three-year reputation early on, his season-to-date line
//                 more and more as games pile up. Put on my value's scale by
//                 rank: the market's 30th-best player is worth whatever my
//                 30th-best is.
//
// gap = market − mine. A big gap on my roster is a player to sell; a
// negative one on theirs is a player to buy.
//
// A trade is only worth proposing when both checks pass:
//   will they accept?  their way: the market value coming in beats what goes
//                      out by the owner premium (they overvalue their own).
//   does it help me?   my way: simulate both rosters after the trade and
//                      measure the change in expected category points.

import { BENCH_WEIGHT } from './roster.js';
import { SEASON_CATEGORIES, seasonTotals } from './season.js';
import { INACTIVE_SLOTS } from './yahooRosters.js';

export const DEFAULT_WEIGHTS = {
  need: 1, // extra weight on categories where I rank low
  gap: 1, // sending players the market overrates, getting ones it underrates
  surplus: 1, // positional depth, theirs at what I get and mine at what I send
  bench: 0.2, // their good player sitting on the bench (a weak signal)
  premium: 0.15, // how much more market value they need back
  trustGames: 40, // games before his actual pace counts as much as my projection
  marketGames: 10, // games before the market trusts this season over reputation
  adpShare: 0.6, // of the preseason view, how much is ADP against the three-year line
  luck: 1, // how hard a lucky last season discounts my value
  pos: { C: 1, LW: 1, RW: 1, D: 1, G: 1 },
};

export function mergeWeights(weights = {}) {
  return { ...DEFAULT_WEIGHTS, ...weights, pos: { ...DEFAULT_WEIGHTS.pos, ...(weights.pos ?? {}) } };
}

const SKATER_GAMES = 82;
const GOALIE_GAMES = 55;
// A goalie touches three categories to a skater's six, but there are far
// fewer of them in a lineup; doubling his score keeps a starting goalie in
// the same range as a first-line forward.
const GOALIE_SCALE = 2;
// How much a fully lucky season (luck score 1) takes off each rate.
const LUCK_SHADE = { g: 0.15, a: 0.08, p: 0.08, ppp: 0.08 };
// Owners count a star for more than two decent players adding up to him.
const CONSOLIDATION = 1.3;
const DEFAULT_SLOTS = { C: 2, LW: 2, RW: 2, D: 4, G: 2 };
const LINEUP_POSITIONS = ['C', 'LW', 'RW', 'D', 'G', 'Util'];

const isGoalie = (p) => (p.posList ?? []).includes('G');
// A player's gap in spreads of my value, capped at two: at the edge of a
// position's starters my values fall off a cliff (the 20th goalie is a
// starter, the 25th a backup), and a small disagreement about rank there
// shouldn't swamp everything else.
const gapUnits = (model, p) => clamp((p.gap ?? 0) / model.spread, -2, 2);
const primaryPos = (p) => p.posList?.[0] ?? null;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const catsFor = (p) => SEASON_CATEGORIES.filter((c) => (c.side === 'goalie') === isGoalie(p));

// Standard normal CDF (Abramowitz–Stegun), for the chance one team finishes
// ahead of another in a category.
function phi(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function meanSd(values) {
  if (!values.length) return { mean: 0, sd: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, sd: sd || 1 };
}

// How lucky last season was, -1 (unlucky) to 1 (lucky): on-ice shooting
// plus save % against the neutral 1000, his shooting % against his career,
// his share of his team's goals against his career. Null with nothing to go on.
export function luckScore(profile) {
  if (!profile) return null;
  const parts = [];
  if (profile.shsv > 0) parts.push((profile.shsv - 1000) / 30);
  if (profile.lyShPct != null && profile.cShPct > 0) parts.push((profile.lyShPct / profile.cShPct - 1) / 0.3);
  if (profile.lyIpp != null && profile.cIpp > 0) parts.push((profile.lyIpp / profile.cIpp - 1) / 0.2);
  if (!parts.length) return null;
  return clamp(parts.reduce((a, b) => a + b, 0) / parts.length, -1, 1);
}

function perGame(line, games) {
  if (!line || !(games > 0)) return null;
  const out = {};
  for (const c of SEASON_CATEGORIES) out[c.key] = line[c.key] == null ? null : c.average ? line[c.key] : line[c.key] / games;
  return out;
}

// The three-year line as rates: skater columns are per 82 games, goalie
// columns are three-year totals divided by starts. PPP has no three-year
// column, so it borrows my projection's share of points on the power play.
function reputationRates(p) {
  const r = p.profile;
  if (!r) return null;
  if (isGoalie(p)) {
    if (!(r.gs3y > 0)) return null;
    return { w: r.w3y / r.gs3y, saves: r.sv3y / r.gs3y, gaa: r.gaa3y ?? null };
  }
  if (!(r.gp3y > 0)) return null;
  const pppShare = p.proj?.p > 0 && p.proj?.ppp != null ? p.proj.ppp / p.proj.p : null;
  return {
    g: r.g3y != null ? r.g3y / 82 : null,
    a: r.a3y != null ? r.a3y / 82 : null,
    p: r.pts3y != null ? r.pts3y / 82 : null,
    ppp: r.pts3y != null && pppShare != null ? (r.pts3y * pppShare) / 82 : null,
    shots: r.sogCareer != null ? r.sogCareer / 82 : null,
    blocks: r.bs3y != null ? r.bs3y / 82 : null,
  };
}

// My rates: projection and actual pace blended by games played, then the
// luck shade on the scoring categories.
function myRates(p, w) {
  const proj = perGame(p.proj, p.proj?.gp || (isGoalie(p) ? GOALIE_GAMES : SKATER_GAMES));
  const act = perGame(p.act, p.act?.gp);
  if (!proj && !act) return null;
  const trust = act ? p.act.gp / (p.act.gp + w.trustGames) : 0;
  const luck = luckScore(p.profile) ?? 0;
  const out = {};
  for (const c of catsFor(p)) {
    const a = act?.[c.key];
    const b = proj?.[c.key];
    let v = a != null && b != null ? a * trust + b * (1 - trust) : a ?? b ?? null;
    if (v != null && LUCK_SHADE[c.key]) v *= 1 - LUCK_SHADE[c.key] * w.luck * luck;
    out[c.key] = v;
  }
  return out;
}

// A season's worth of a rate line, in the shape seasonTotals adds up.
function seasonLine(p, rates) {
  const games = p.proj?.gp || (isGoalie(p) ? GOALIE_GAMES : SKATER_GAMES);
  const line = { posList: p.posList, gp: games };
  for (const c of catsFor(p)) line[c.key] = rates[c.key] == null ? null : c.average ? rates[c.key] : rates[c.key] * games;
  return line;
}

// One number per line: z-scores summed across his side's categories. GAA
// counts negatively and in proportion to how much he plays. `stats` are the
// population's means and spreads, per category.
function zParts(line, stats) {
  const parts = {};
  const scale = isGoalie(line) ? GOALIE_SCALE : 1;
  for (const c of catsFor(line)) {
    const v = line[c.key];
    const s = stats[c.key];
    if (v == null || !s) continue;
    let z = (v - s.mean) / s.sd;
    if (c.lowerIsBetter) z = -z * clamp((line.gp ?? GOALIE_GAMES) / GOALIE_GAMES, 0, 1.5);
    parts[c.key] = z * scale;
  }
  return parts;
}

function zScore(line, stats) {
  return Object.values(zParts(line, stats)).reduce((a, b) => a + b, 0);
}

function populationStats(lines) {
  const stats = {};
  for (const c of SEASON_CATEGORIES) {
    const values = lines.filter((l) => (c.side === 'goalie') === isGoalie(l) && l[c.key] != null).map((l) => l[c.key]);
    if (values.length) stats[c.key] = meanSd(values);
  }
  return stats;
}

// A blended rank is fractional (the market has him 1.6th); read the curve
// between its neighbours rather than rounding the difference away.
function valueAtRank(curve, rank) {
  const i = clamp(rank - 1, 0, curve.length - 1);
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, curve.length - 1);
  return curve[lo] + (curve[hi] - curve[lo]) * (i - lo);
}

// Rank 1 = best, for everyone with a score from `scoreFor`.
function rankBy(players, scoreFor, ascending = false) {
  const scored = players.map((p) => [p.key, scoreFor(p)]).filter(([, s]) => s != null && Number.isFinite(s));
  scored.sort((a, b) => (ascending ? a[1] - b[1] : b[1] - a[1]));
  return new Map(scored.map(([key], i) => [key, i + 1]));
}

// Starting seats per position, read off the rosters themselves: the most
// any team has of each. Falls back to the league default before an import.
export function startingSlots(teams) {
  const slots = {};
  for (const t of teams) {
    const counts = {};
    for (const row of t.rows ?? []) if (LINEUP_POSITIONS.includes(row.slot)) counts[row.slot] = (counts[row.slot] ?? 0) + 1;
    for (const [slot, n] of Object.entries(counts)) slots[slot] = Math.max(slots[slot] ?? 0, n);
  }
  return Object.keys(slots).length ? slots : { ...DEFAULT_SLOTS };
}

// Best players start: each, in value order, takes the first open seat his
// eligibility allows (Util takes any skater), otherwise the bench.
export function lineup(players, slots, valueOf) {
  const open = { ...slots };
  const starters = [];
  const bench = [];
  for (const p of [...players].sort((a, b) => valueOf(b) - valueOf(a))) {
    const seat = (p.posList ?? []).find((pos) => open[pos] > 0) ?? (!isGoalie(p) && open.Util > 0 ? 'Util' : null);
    if (seat) {
      open[seat] -= 1;
      starters.push(p);
    } else {
      bench.push(p);
    }
  }
  return { starters, bench };
}

/**
 * Everything the finder needs, computed once per request.
 * @param season  buildSeason's { teams, players }
 */
export function buildTradeModel(season, weights = {}) {
  const w = mergeWeights(weights);

  // My value.
  const withLines = [];
  for (const p of season.players) {
    const rates = myRates(p, w);
    if (rates) withLines.push({ p, line: seasonLine(p, rates) });
  }
  const rostered = withLines.filter(({ p }) => p.owner != null);
  const stats = populationStats((rostered.length ? rostered : withLines).map((x) => x.line));
  const players = new Map();
  for (const p of season.players) players.set(p.key, { ...p, line: null, z: null, myValue: null, marketValue: null, gap: null, luck: luckScore(p.profile) });
  for (const { p, line } of withLines) {
    const z = zParts(line, stats);
    Object.assign(players.get(p.key), { line, z, myValue: Object.values(z).reduce((a, b) => a + b, 0) });
  }

  // Market value: three rankings, blended, read back off my value curve —
  // all within his position. Yahoo drafters take goalies late and my scoring
  // has its own lean between positions, so comparing a goalie's ADP against
  // skaters would call every goalie a bargain. The market's 5th goalie is
  // worth my 5th goalie.
  const all = [...players.values()];
  const repLines = new Map();
  for (const p of all) {
    const rates = reputationRates(p);
    if (rates) repLines.set(p.key, seasonLine(p, rates));
  }
  const repStats = populationStats([...repLines.values()]);
  const actLines = all.filter((p) => p.act?.gp > 0).map((p) => [p.key, { ...p.act, posList: p.posList }]);
  const actStats = populationStats(actLines.map(([, l]) => l));
  const actScore = new Map(actLines.map(([key, l]) => [key, zScore(l, actStats)]));
  const groupOf = (p) => (isGoalie(p) ? 'G' : primaryPos(p));

  for (const group of new Set(all.map(groupOf))) {
    const members = all.filter((p) => groupOf(p) === group);
    const adpRank = rankBy(members, (p) => p.adp ?? null, true);
    const repRank = rankBy(members, (p) => (repLines.has(p.key) ? zScore(repLines.get(p.key), repStats) : null));
    const actRank = rankBy(members, (p) => actScore.get(p.key) ?? null);
    const curve = members.map((p) => p.myValue).filter((v) => v != null).sort((a, b) => b - a);
    for (const p of members) {
      const current = p.act?.gp > 0 ? p.act.gp / (p.act.gp + w.marketGames) : 0;
      const parts = [
        [adpRank.get(p.key), (1 - current) * w.adpShare],
        [repRank.get(p.key), (1 - current) * (1 - w.adpShare)],
        [actRank.get(p.key), current],
      ].filter(([rank, weight]) => rank != null && weight > 0);
      const total = parts.reduce((sum, [, weight]) => sum + weight, 0);
      if (total > 0 && curve.length) {
        p.marketRank = parts.reduce((sum, [rank, weight]) => sum + rank * weight, 0) / total;
        p.marketValue = valueAtRank(curve, p.marketRank);
      } else {
        p.marketRank = null;
        p.marketValue = p.myValue;
      }
      p.gap = p.myValue != null && p.marketValue != null ? p.marketValue - p.myValue : null;
    }
  }
  const curve = all.map((p) => p.myValue).filter((v) => v != null).sort((a, b) => b - a);

  // Replacement level: the value of the last player a full league rosters.
  const rosteredCount = all.filter((p) => p.owner != null).length || season.teams.length * 16;
  const replacement = curve.length ? valueAtRank(curve, rosteredCount) : 0;
  const spread = meanSd(rostered.map(({ p }) => players.get(p.key).myValue)).sd;

  // Teams: the active roster (injury lists aside), totals, needs, depth.
  const slots = startingSlots(season.teams);
  const teams = season.teams.map((t) => {
    const active = [];
    const inactive = [];
    for (const row of t.rows) {
      if (!row.player) continue;
      const p = players.get(row.player.key);
      (INACTIVE_SLOTS.includes(row.slot) ? inactive : active).push(p);
    }
    const surplus = {};
    for (const pos of Object.keys(DEFAULT_SLOTS)) {
      const depth = active.filter((p) => primaryPos(p) === pos).length;
      surplus[pos] = Math.max(0, depth - (slots[pos] ?? 0));
    }
    return { num: t.num, name: t.name, isMine: t.isMine, active, inactive, surplus };
  });
  const model = { weights: w, players, teams, slots, replacement, spread, catSd: {} };
  for (const t of teams) t.totals = teamTotals(model, t.active, t.isMine);
  for (const c of SEASON_CATEGORIES) {
    model.catSd[c.key] = meanSd(teams.map((t) => t.totals[c.key]).filter((v) => v != null)).sd;
  }
  const n = teams.length;
  for (const t of teams) {
    t.need = {};
    for (const c of SEASON_CATEGORIES) {
      const rank = 1 + teams.filter((o) => better(c, o.totals[c.key], t.totals[c.key])).length;
      t.need[c.key] = n > 1 ? (rank - 1) / (n - 1) : 0;
    }
  }
  return model;
}

function better(cat, a, b) {
  if (a == null) return false;
  if (b == null) return true;
  return cat.lowerIsBetter ? a < b : a > b;
}

// Seen through my eyes for my team (my value picks the lineup), the
// market's for theirs — that's how their owner would set it.
function perspective(mine) {
  return mine ? (p) => p.myValue ?? -Infinity : (p) => p.marketValue ?? p.myValue ?? -Infinity;
}

function teamTotals(model, active, mine) {
  const { starters, bench } = lineup(active, model.slots, perspective(mine));
  const lines = (list) => list.filter((p) => p.line).map((p) => p.line);
  return seasonTotals(lines(starters), lines(bench), BENCH_WEIGHT);
}

// Expected category points: in each category, the chance of finishing ahead
// of each other team, summed. Smooth where raw ranks jump, so a trade that
// closes most of a gap still counts for something.
function expectedPoints(model, totalsByTeam, num) {
  const mine = totalsByTeam.get(num);
  const byCat = {};
  for (const c of SEASON_CATEGORIES) {
    const sd = model.catSd[c.key] || 1;
    let pts = 0;
    for (const [other, theirs] of totalsByTeam) {
      if (other === num) continue;
      const a = mine[c.key];
      const b = theirs[c.key];
      if (a == null || b == null) {
        pts += a == null ? (b == null ? 0.5 : 0) : 1;
        continue;
      }
      pts += phi(((c.lowerIsBetter ? b - a : a - b) / sd) * 1.5);
    }
    byCat[c.key] = pts;
  }
  return byCat;
}

// The market value an owner feels: above replacement, and convex, so two
// fringe players never add up to a star.
function feltValue(model, p) {
  const v = Math.max(0, (p.marketValue ?? p.myValue ?? 0) - model.replacement);
  return v ** CONSOLIDATION;
}

// A roster after a trade: out go the players sent, in come the ones
// received, and if that leaves too many active players the owner drops his
// least valuable (by his own lights). Injured players traded stay injured.
function afterTrade(model, team, outKeys, incoming, mine) {
  const keep = team.active.filter((p) => !outKeys.has(p.key));
  const arrivingActive = incoming.filter((p) => !isInjured(model, p));
  const roster = [...keep, ...arrivingActive];
  const dropped = [];
  const valueOf = perspective(mine);
  while (roster.length > team.active.length) {
    roster.sort((a, b) => valueOf(a) - valueOf(b));
    dropped.push(roster.shift());
  }
  return { roster, dropped };
}

function isInjured(model, p) {
  return model.teams.some((t) => t.inactive.includes(p));
}

/**
 * Both sides of one trade.
 * @param give  keys of my players I send
 * @param get   keys of their players I receive (all from one team)
 */
export function evaluateTrade(model, give, get) {
  const me = model.teams.find((t) => t.isMine);
  const gets = get.map((k) => model.players.get(k));
  const gives = give.map((k) => model.players.get(k));
  const them = model.teams.find((t) => t.num === gets[0]?.owner);
  if (!me || !them || gets.some((p) => p?.owner !== them.num) || gives.some((p) => p?.owner !== me.num)) return null;

  const mineAfter = afterTrade(model, me, new Set(give), gets, true);
  const theirsAfter = afterTrade(model, them, new Set(get), gives, false);

  const before = new Map(model.teams.map((t) => [t.num, t.totals]));
  const after = new Map(before);
  after.set(me.num, teamTotals(model, mineAfter.roster, true));
  after.set(them.num, teamTotals(model, theirsAfter.roster, false));

  const side = (num, need) => {
    const b = expectedPoints(model, before, num);
    const a = expectedPoints(model, after, num);
    const byCat = {};
    let delta = 0;
    let weighted = 0;
    for (const c of SEASON_CATEGORIES) {
      byCat[c.key] = a[c.key] - b[c.key];
      delta += byCat[c.key];
      weighted += byCat[c.key] * (1 + model.weights.need * (need?.[c.key] ?? 0));
    }
    return { delta, weighted, byCat };
  };

  // Their side of the ledger, their way: what arrives, less anyone they
  // have to drop to make room, against what leaves.
  const gotFelt = gives.reduce((s, p) => s + feltValue(model, p), 0) - theirsAfter.dropped.reduce((s, p) => s + feltValue(model, p), 0);
  const gaveFelt = gets.reduce((s, p) => s + feltValue(model, p), 0);
  // Giving up someone the market rates at replacement level costs them
  // nothing they can feel, so any package clears it: no ratio to show.
  const ratio = gaveFelt > 0 ? gotFelt / gaveFelt : null;
  const ok = ratio == null ? gotFelt >= 0 : ratio >= 1 + model.weights.premium;

  return {
    give,
    get,
    team: them.num,
    me: { ...side(me.num, me.need), dropped: mineAfter.dropped.map((p) => p.key) },
    them: { ...side(them.num, null), dropped: theirsAfter.dropped.map((p) => p.key) },
    accept: { ratio, ok },
  };
}

// Of a team's players at `pos`, the ones beyond the starting seats — its
// depth, by my value — are the ones a surplus lets it move without hurting.
export function depthPieces(team, pos, slots) {
  const atPos = team.active.filter((p) => primaryPos(p) === pos).sort((a, b) => (b.myValue ?? -Infinity) - (a.myValue ?? -Infinity));
  return new Set(atPos.slice(Math.max(0, (slots[pos] ?? 0) - 1)).map((p) => p.key));
}

// My players worth shopping, best first: the market rates them above what
// I do, and I'm deep at their position (for my weaker players there only —
// the surplus is a reason to move a mid-level piece, not my best). `targetPos` nudges up anyone who
// plays the position of the player I'm chasing — sending one back keeps my
// lineup whole.
export function sellList(model, { targetPos = null, locked = [] } = {}) {
  const me = model.teams.find((t) => t.isMine);
  if (!me) return [];
  const w = model.weights;
  const depth = new Map();
  const isDepth = (p) => {
    const pos = primaryPos(p);
    if (!depth.has(pos)) depth.set(pos, depthPieces(me, pos, model.slots));
    return depth.get(pos).has(p.key);
  };
  return [...me.active, ...me.inactive]
    .filter((p) => !locked.includes(p.key))
    .map((p) => {
      const gap = gapUnits(model, p);
      const surplus = isDepth(p) ? Math.min(3, me.surplus[primaryPos(p)] ?? 0) : 0;
      const samePos = targetPos && (p.posList ?? []).includes(targetPos) ? 1 : 0;
      const score = w.gap * gap + w.surplus * 0.25 * surplus + 0.5 * samePos;
      return { key: p.key, score, gap, surplus, samePos: !!samePos, injured: me.inactive.includes(p) };
    })
    .sort((a, b) => b.score - a.score);
}

// How much a proposal is worth proposing: the category gain, plus the
// market edge (I send overrated, get underrated), plus depth on both sides,
// plus a nudge for a good player they're benching. Scaled by the position
// weight of what I get.
function scoreProposal(model, trade, me, them) {
  const w = model.weights;
  const gets = trade.get.map((k) => model.players.get(k));
  const gives = trade.give.map((k) => model.players.get(k));
  const edge = gives.reduce((s, p) => s + gapUnits(model, p), 0) - gets.reduce((s, p) => s + gapUnits(model, p), 0);
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const mine = (p) => (depthPieces(me, primaryPos(p), model.slots).has(p.key) ? Math.min(3, me.surplus[primaryPos(p)] ?? 0) : 0);
  const surplus = avg(gets.map((p) => Math.min(3, them.surplus[primaryPos(p)] ?? 0))) + avg(gives.map(mine));
  const bench = avg(gets.map((p) => (benchedStarter(model, them, p) ? 1 : 0)));
  const posWeight = avg(gets.map((p) => w.pos[primaryPos(p)] ?? 1));
  const score = posWeight * (trade.me.weighted + w.gap * 0.5 * edge + w.surplus * 0.25 * surplus + w.bench * 0.5 * bench);
  return { score, edge, surplus, bench: bench > 0 };
}

// On the bench, yet better (by my value) than the median starter there.
function benchedStarter(model, team, p) {
  if (!team.lineup) team.lineup = lineup(team.active, model.slots, perspective(false));
  const { starters, bench } = team.lineup;
  if (!bench.includes(p) || !starters.length) return false;
  const values = starters.map((s) => s.myValue ?? 0).sort((a, b) => a - b);
  return (p.myValue ?? 0) >= values[Math.floor(values.length / 2)];
}

function pairs(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
}

// Every 1-for-1, 2-for-1 and 2-for-2 for one target, from my top pieces and,
// for the 2-for-2s, the other players on his team I'd most like alongside.
function packagesFor(model, targetKey, pieces, { companions = 5 } = {}) {
  const me = model.teams.find((t) => t.isMine);
  const target = model.players.get(targetKey);
  const them = model.teams.find((t) => t.num === target?.owner);
  if (!me || !them || them.isMine) return [];
  const extras = [...them.active, ...them.inactive]
    .filter((p) => p.key !== targetKey && p.myValue != null)
    .sort((a, b) => b.myValue - (b.gap ?? 0) - (a.myValue - (a.gap ?? 0)))
    .slice(0, companions)
    .map((p) => p.key);

  const shapes = [
    ...pieces.map((k) => ({ give: [k], get: [targetKey], shape: '1-for-1' })),
    ...pairs(pieces).map((give) => ({ give, get: [targetKey], shape: '2-for-1' })),
    ...pairs(pieces).flatMap((give) => extras.map((x) => ({ give, get: [targetKey, x], shape: '2-for-2' }))),
  ];
  const out = [];
  for (const { give, get, shape } of shapes) {
    const trade = evaluateTrade(model, give, get);
    if (!trade) continue;
    out.push({ ...trade, shape, ...scoreProposal(model, trade, me, them) });
  }
  return out;
}

const viable = (t) => t.accept.ok && t.me.delta > 0;

// Open scan: the best proposal for each of the most promising targets
// across the league.
export function scanTrades(model, { limit = 20, targets = 40, pieces = 8, locked = [] } = {}) {
  const me = model.teams.find((t) => t.isMine);
  if (!me) return [];
  const myPieces = sellList(model, { locked }).slice(0, pieces).map((s) => s.key);
  const w = model.weights;
  // Who's worth building packages for: players who'd fill my weak
  // categories, that the market underrates, on teams deep at their spot.
  const candidates = model.teams
    .filter((t) => !t.isMine)
    .flatMap((t) => t.active.map((p) => ({ p, t })))
    .filter(({ p }) => p.line && p.myValue != null)
    .map(({ p, t }) => {
      // Category fit: his strength in each category, weighted by how badly I need it.
      const fit = catsFor(p).reduce((s, c) => s + (me.need[c.key] ?? 0) * (p.z?.[c.key] ?? 0), 0);
      const score = (w.pos[primaryPos(p)] ?? 1) * (p.myValue + w.need * fit - w.gap * gapUnits(model, p) + w.surplus * 0.25 * Math.min(3, t.surplus[primaryPos(p)] ?? 0));
      return { key: p.key, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, targets);

  const best = [];
  for (const { key } of candidates) {
    const top = packagesFor(model, key, myPieces).filter(viable).sort((a, b) => b.score - a.score)[0];
    if (top) best.push(top);
  }
  // Two targets on one team can lead to the same 2-for-2; list it once.
  const seen = new Set();
  return best
    .sort((a, b) => b.score - a.score)
    .filter((t) => {
      const id = `${[...t.give].sort()}>${[...t.get].sort()}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

// Targeted: every viable package for one player, best first, plus the best
// of the rest so a "no" still shows how close it came.
export function targetTrades(model, targetKey, { pieces = 12, locked = [], limit = 30 } = {}) {
  const target = model.players.get(targetKey);
  if (!target) return { viable: [], closest: [] };
  const myPieces = sellList(model, { targetPos: primaryPos(target), locked }).slice(0, pieces).map((s) => s.key);
  const all = packagesFor(model, targetKey, myPieces).sort((a, b) => b.score - a.score);
  return {
    viable: all.filter(viable).slice(0, limit),
    closest: all
      .filter((t) => !viable(t))
      .sort((a, b) => (b.accept.ratio ?? Infinity) - (a.accept.ratio ?? Infinity))
      .slice(0, 5),
  };
}
