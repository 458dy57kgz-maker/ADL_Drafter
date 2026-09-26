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

// Every player fills exactly one physical slot, so a dual-eligible player
// (e.g. C/LW) never counts twice. Seats I've chosen by hand come first; the
// rest fill in POS_ORDER, which decides which eligible position gets first
// claim. Anyone left over once the starting slots are
// full sits on the bench: a third centre in a two-C league doesn't vanish,
// he just shows up there. The bench stretches past its configured size if
// more players are assigned than there are seats, so a drafted player is
// never invisible.
export const BENCH = 'BN';

// Whether `player` may sit in `slot` at all: any seat his eligibility covers,
// or the bench, which takes anyone.
export function canSit(player, slot) {
  return slot === BENCH || (player.posList ?? []).includes(slot);
}

export function assignRoster(teamPlayers, rosterSlots) {
  const seated = new Map(POS_ORDER.map((pos) => [pos, []]));
  const pinnedBench = [];
  const assignedIds = new Set();

  // A seat I chose by hand (dragged there in My Roster) is honoured first,
  // as long as he's still eligible for it and it still has room — a roster
  // setting shrunk since then drops the extras back into the normal fill.
  for (const p of teamPlayers) {
    const slot = p.rosterSlot;
    if (!slot || !canSit(p, slot)) continue;
    if (slot === BENCH) {
      pinnedBench.push(p);
      assignedIds.add(p.id);
    } else if (seated.has(slot) && seated.get(slot).length < (rosterSlots[slot] ?? 0)) {
      seated.get(slot).push(p);
      assignedIds.add(p.id);
    }
  }

  // Everyone else fills what's left, in POS_ORDER, best-ranked first.
  POS_ORDER.forEach((pos) => {
    const count = rosterSlots[pos] ?? 0;
    const seats = seated.get(pos);
    for (const p of teamPlayers) {
      if (seats.length >= count) break;
      if (!assignedIds.has(p.id) && p.posList.includes(pos)) {
        seats.push(p);
        assignedIds.add(p.id);
      }
    }
  });

  const rows = [];
  for (const pos of POS_ORDER) {
    const count = rosterSlots[pos] ?? 0;
    const seats = seated.get(pos);
    for (let i = 0; i < count; i++) rows.push({ pos, player: seats[i] ?? null });
  }

  const starterIds = new Set([...seated.values()].flat().map((p) => p.id));
  const bench = [...pinnedBench, ...teamPlayers.filter((p) => !assignedIds.has(p.id))];
  const benchRows = Math.max(rosterSlots.BENCH ?? 0, bench.length);
  for (let i = 0; i < benchRows; i++) {
    rows.push({ pos: BENCH, player: bench[i] ?? null });
  }

  return { rows, starters: teamPlayers.filter((p) => starterIds.has(p.id)), bench };
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
