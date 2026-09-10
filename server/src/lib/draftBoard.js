// The Best Available board.
//
// Deliberately small. Every function here is a lookup, a sort, or a comparison
// against a pick number — there is no win-probability or marginal-value math,
// which is exactly the point: the engine that used to make the call is in
// /archive, and the board hands the decision back to the drafter by showing
// what they need to see rather than naming a player.
//
// Everything is pure, so it can be exercised straight from `node --test`
// (server/test/draftBoard.test.js) with no database and no server running.

// The five scoring categories a skater card can tag. `plusMinus` is absent for
// the same reason it left Target Progress: it isn't something a player
// accumulates, so "this player moves +/- most" doesn't mean much.
export const SKATER_CATEGORIES = [
  { key: 'g', label: 'G' },
  { key: 'a', label: 'A' },
  { key: 'ppp', label: 'PPP' },
  { key: 'shots', label: 'SOG' },
  { key: 'blocks', label: 'BLK' },
];

// GAA is inverted: 2.35 beats 2.80, so it ranks on -z but still displays the
// number the way a goalie card should read.
export const GOALIE_CATEGORIES = [
  { key: 'w', label: 'W' },
  { key: 'saves', label: 'SV' },
  { key: 'gaa', label: 'GAA', invert: true, decimals: 2 },
];

export const SEASON_GAMES_FALLBACK = 82;

const isGoalie = (p) => (p.posList ?? []).includes('G');
const eligibleAt = (p, position) => (p.posList ?? []).includes(position);

/**
 * How many undrafted players are left at `position`, split by tier.
 *
 * `currentPick` is part of the agreed signature but isn't needed: `drafted` is
 * authoritative about who is still on the board, and it already reflects every
 * pick made up to `currentPick`.
 *
 * `byTier` is returned alongside t1/t2 so `detectCliff` can ask about tier 3+
 * without walking the pool a second time.
 */
export function classifyRemaining(players, position, currentPick) {
  const pool = players.filter((p) => !p.drafted && eligibleAt(p, position));
  const byTier = new Map();
  for (const p of pool) {
    if (p.tier == null) continue;
    byTier.set(p.tier, (byTier.get(p.tier) ?? 0) + 1);
  }
  return { t1: byTier.get(1) ?? 0, t2: byTier.get(2) ?? 0, total: pool.length, byTier };
}

/** Half the gap to your next turn, which is the default tolerance for "risky". */
export function defaultRiskMargin(currentPick, nextPick) {
  return Math.max(0, (nextPick - currentPick) / 2);
}

/**
 * Can this player survive until your next turn?
 *
 *   adp <= currentPick                     -> 'overdue'  he has already fallen
 *                                                        past where the market
 *                                                        expected him gone —
 *                                                        a value signal, not a
 *                                                        warning
 *   currentPick < adp <= nextPick          -> 'gone'     his ADP lands inside
 *                                                        your gap
 *   nextPick < adp <= nextPick + margin    -> 'risky'    close to the edge
 *   adp > nextPick + margin                -> 'safe'
 *
 * Returns null when ADP is unknown — the card omits the chip rather than
 * guessing, since every branch here is a claim about the market and there is
 * no market reading to make one from.
 */
export function waitStatus(adp, currentPick, nextPick, riskMargin = defaultRiskMargin(currentPick, nextPick)) {
  if (adp == null) return null;
  if (adp <= currentPick) return 'overdue';
  if (adp <= nextPick) return 'gone';
  if (adp <= nextPick + riskMargin) return 'risky';
  return 'safe';
}

function remainingInTier(remainingCounts, tier) {
  if (remainingCounts?.byTier instanceof Map) return remainingCounts.byTier.get(tier) ?? 0;
  if (tier === 1) return remainingCounts?.t1 ?? null;
  if (tier === 2) return remainingCounts?.t2 ?? null;
  return null;
}

/**
 * Where the talent falls off: the index after which to draw the divider, or
 * null. A boundary qualifies when the player's successor is a worse tier and
 * that player's own tier has 2 or fewer left on the board.
 *
 * Two notes on the heuristic as written in the brief, both flagged rather than
 * silently adjusted:
 *
 * 1. Tier direction. The brief said "the next player's tier is numerically
 *    lower (worse)", but tier 1 is the best here, so worse is numerically
 *    HIGHER. Implemented as "worse", which is what the mockup draws — its
 *    cliff sits between a T2 and a T3.
 *
 * 2. Which boundary, when more than one qualifies. The mockup's LW column has
 *    1 T1 and 1 T2 left, so BOTH the T1->T2 and the T2->T3 steps qualify, and
 *    it draws only the second. So this returns the LAST qualifying boundary in
 *    the list it is given, not the first — marking the deepest point you can
 *    still fall back to before the drop. Callers pass the visible cards, which
 *    keeps a genuine near cliff from being masked by a thin tier twenty
 *    players down.
 *
 * The <= 2 threshold is a starting heuristic, not a spec. If real boards put
 * cliffs in the wrong place, that's a number to tune here, in one spot.
 */
export function detectCliff(sortedPlayersAtPosition, remainingCounts) {
  let found = null;
  for (let i = 0; i < sortedPlayersAtPosition.length - 1; i++) {
    const tier = sortedPlayersAtPosition[i].tier;
    const nextTier = sortedPlayersAtPosition[i + 1].tier;
    if (tier == null || nextTier == null) continue;
    if (nextTier <= tier) continue;
    const left = remainingInTier(remainingCounts, tier);
    if (left != null && left <= 2) found = i;
  }
  return found;
}

function meanAndSd(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/**
 * The `n` categories this player moves most, measured against his OWN position
 * pool — a defenceman's 220 shots and a winger's 220 shots are not the same
 * statement, so scoring them against one combined pool would tag every D with
 * blocks and nothing else.
 *
 * Ranked by |z| (per the brief: the categories he is furthest from the middle
 * on), displayed as the raw projected total, since "65 A" is what you can act
 * on and "1.8σ" is not.
 */
export function topCategories(player, positionPool, n = 2) {
  const cats = isGoalie(player) ? GOALIE_CATEGORIES : SKATER_CATEGORIES;
  const scored = [];

  for (const cat of cats) {
    const value = player[cat.key];
    if (value == null) continue;
    const values = positionPool.map((p) => p[cat.key]).filter((v) => v != null);
    if (values.length < 2) continue;
    const { mean, sd } = meanAndSd(values);
    if (!sd) continue; // every player identical in this category — says nothing
    const z = ((value - mean) / sd) * (cat.invert ? -1 : 1);
    scored.push({ key: cat.key, label: cat.label, value, z, decimals: cat.decimals ?? 0 });
  }

  scored.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return scored.slice(0, n).map(({ key, label, value, z, decimals }) => ({
    key,
    label,
    value,
    // Kept for tests and debugging; the card renders `text` and nothing else.
    z: Math.round(z * 100) / 100,
    text: `${decimals ? value.toFixed(decimals) : Math.round(value)} ${label}`,
  }));
}

/**
 * Share of a player's games that fall on light NHL nights. Null when `ong` is
 * missing: the card drops the line rather than printing a number that isn't
 * about this player. A missing `gp` alone falls back to a full season, which is
 * a real assumption about schedule length rather than an invented statistic.
 */
export function offNightShare(player, seasonGamesFallback = SEASON_GAMES_FALLBACK) {
  const ong = player?.ong;
  if (ong == null) return null;
  const gp = player?.gp ?? seasonGamesFallback;
  if (!gp) return null;
  return ong / gp;
}

/**
 * The tiers worth showing in a column header: the `n` shallowest tiers that
 * still have anyone left. An empty tier is a fact about the past — "0 T1" told
 * you nothing you couldn't read from the cards — so it is dropped and the next
 * live tier takes its place.
 */
export function visibleTiers(byTier, n = 2) {
  return [...byTier.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => a[0] - b[0])
    .slice(0, n)
    .map(([tier, count]) => ({ tier, count }));
}

/**
 * Assembles one column per position: the counts for the header pills, the top
 * `depth` cards, and where the cliff divider goes.
 *
 * Composed from the functions above and nothing else, so the board that ships
 * is the board the tests exercise.
 */
export function buildBoard({
  players,
  positions,
  rosterSlots,
  myPlayers = [],
  currentPick,
  nextPick,
  depth = 3,
}) {
  const columns = positions.map((pos) => {
    const counts = classifyRemaining(players, pos, currentPick);
    const pool = players
      .filter((p) => !p.drafted && eligibleAt(p, pos))
      .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity));

    // Scoped to the visible cards: the divider is drawn between two of them,
    // and a cliff twenty players down isn't news at this pick.
    const shown = pool.slice(0, depth);
    const cliffAfter = detectCliff(shown, counts);

    const slots = rosterSlots?.[pos] ?? 0;
    const filled = myPlayers.filter((p) => eligibleAt(p, pos)).length;
    const positionFull = slots > 0 && filled >= slots;

    const cards = shown.map((p, i) => {
      const status = waitStatus(p.adp, currentPick, nextPick);
      const share = offNightShare(p);
      return {
        id: p.id,
        rank: i + 1,
        name: p.name,
        overallRank: p.overallRank,
        tier: p.tier,
        adp: p.adp,
        // How far past his ADP he has fallen — the number that makes "already
        // overdue" concrete.
        picksAgo: status === 'overdue' && p.adp != null ? currentPick - p.adp : null,
        status,
        tracked: !!p.tracked,
        cats: topCategories(p, pool),
        ongPct: share == null ? null : Math.round(share * 100),
        // The top card at a position you still have a starting slot for. Never
        // on an overdue card — that one already carries the louder gold
        // treatment, and two badges on one card compete.
        suggested: i === 0 && !positionFull && status !== 'overdue',
      };
    });

    return {
      pos,
      counts: {
        total: counts.total,
        // Everyone at this position already off the board — the denominator
        // for the header's draining ring.
        taken: players.filter((p) => p.drafted && eligibleAt(p, pos)).length,
        tiers: visibleTiers(counts.byTier),
      },
      cards,
      cliffAfter,
      sub: positionFull
        ? {
            kind: 'roster',
            text: `Roster: ${filled}/${slots} filled — ${filled > slots ? 'bench only' : 'full'}`,
          }
        : {
            kind: 'cliff',
            text:
              cliffAfter != null
                ? `Cliff after next ${cliffAfter + 1} pick${cliffAfter + 1 === 1 ? '' : 's'}`
                : `No cliff before pick ${nextPick}`,
          },
    };
  });

  return { currentPick, nextPick, columns };
}
