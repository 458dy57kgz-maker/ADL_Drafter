// Roster shaping and category totals, shared by the War Room state (my team)
// and the Results page (all ten). It lives here rather than inside draft.js
// because "how a team's picks fill its slots" now has two callers, and the
// two must agree — a bench player counted as a starter on one page and a
// bench player on the other would make the Results totals disagree with
// Target Progress for no visible reason.

import { mySlot } from './league.js';

export const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];

// A bench player still contributes: he covers injuries, off nights and the
// weeks a starter is cold, but he is not in the lineup every week. Counting
// him at three quarters is the app's own convention, applied identically to
// every manager so the Target Progress comparison stays fair.
export const BENCH_WEIGHT = 0.75;

// Season targets that Target Progress races. `plusMinus` is gone from this
// list on purpose: it isn't a counting stat you accumulate toward a total
// the way goals are, so a "% of target" reading on it was noise. Points is
// absent for the same reason it has no target — it's g + a.
export const TARGET_CATEGORIES = [
  { label: 'Goals', key: 'g', goalKey: 'goals', side: 'skater' },
  { label: 'Assists', key: 'a', goalKey: 'assists', side: 'skater' },
  { label: 'PPP', key: 'ppp', goalKey: 'ppp', side: 'skater' },
  { label: 'Shots', key: 'shots', goalKey: 'shots', side: 'skater' },
  { label: 'Blocks', key: 'blocks', goalKey: 'blocks', side: 'skater' },
  { label: 'Wins', key: 'w', goalKey: 'wins', side: 'goalie' },
  { label: 'Saves', key: 'saves', goalKey: 'saves', side: 'goalie' },
];

// One pass over a team's picks, so a dual-eligible player (e.g. C/LW) only
// ever fills one physical slot — POS_ORDER decides which of their eligible
// positions gets first claim. Anyone left over once the starting slots are
// full sits on the bench: a third centre in a two-C league doesn't vanish,
// he just shows up there. The bench stretches past its configured size if
// more players are assigned than there are seats, so a drafted player is
// never invisible.
export function assignRoster(teamPlayers, rosterSlots) {
  const rows = [];
  const assignedIds = new Set();

  POS_ORDER.forEach((pos) => {
    const count = rosterSlots[pos] ?? 0;
    const eligible = teamPlayers.filter((p) => p.posList.includes(pos) && !assignedIds.has(p.id));
    for (let i = 0; i < count; i++) {
      const player = eligible[i] ?? null;
      if (player) assignedIds.add(player.id);
      rows.push({ pos, player });
    }
  });

  const bench = teamPlayers.filter((p) => !assignedIds.has(p.id));
  const benchRows = Math.max(rosterSlots.BENCH ?? 0, bench.length);
  for (let i = 0; i < benchRows; i++) {
    rows.push({ pos: 'BN', player: bench[i] ?? null });
  }

  return { rows, starters: teamPlayers.filter((p) => assignedIds.has(p.id)), bench };
}

// Skater categories ignore goalies and vice versa. That's belt-and-braces —
// a goalie's `g` is normally null anyway — but it keeps a stray value in an
// imported sheet from quietly inflating a total.
function eligibleFor(side, p) {
  const isGoalie = p.posList.includes('G');
  return side === 'goalie' ? isGoalie : !isGoalie;
}

// Starters at full value, bench at BENCH_WEIGHT. Returned unrounded so the
// percentage is computed from the real number; the caller rounds for display.
export function categoryTotals(starters, bench) {
  const totals = {};
  for (const cat of TARGET_CATEGORIES) {
    let sum = 0;
    for (const p of starters) if (eligibleFor(cat.side, p)) sum += p[cat.key] || 0;
    for (const p of bench) if (eligibleFor(cat.side, p)) sum += (p[cat.key] || 0) * BENCH_WEIGHT;
    totals[cat.key] = sum;
  }
  return totals;
}

export function pctOf(total, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((total / goal) * 100));
}

// A team's single headline number: how far along it is on average across the
// seven tracked categories. Capped per category first (via pctOf), so one
// runaway category can't paper over six empty ones.
export function overallPct(totals, targets) {
  const pcts = TARGET_CATEGORIES.map((cat) => pctOf(totals[cat.key], targets[cat.goalKey]));
  return Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
}

// Every team's shaped roster and weighted totals, keyed by draft slot order.
// `players` is the whole pool; a team owns a player when the pick recorded
// its name in `drafted_by`.
export function buildTeamSummaries(players, league, rosterSlots, targets) {
  const teams = league.teams ?? [];
  return teams.map((team, i) => {
    const owned = players.filter((p) => p.drafted && p.draftedBy === team.name);
    const { rows, starters, bench } = assignRoster(owned, rosterSlots);
    const totals = categoryTotals(starters, bench);
    return {
      slot: i + 1,
      id: team.id ?? null,
      name: team.name,
      isMine: i + 1 === mySlot(league),
      rows,
      players: owned,
      benchIds: bench.map((p) => p.id),
      totals,
      overallPct: overallPct(totals, targets),
      pickCount: owned.length,
    };
  });
}
