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

/**
 * How far past your next turn an ADP can sit and still count as "risky".
 *
 * Half the gap to that turn, but never more than half a round. The gap alone
 * is wrong at the turn of a snake: at slot 1 the gap from pick 1 to pick 20 is
 * 19, which stretched "risky" out to ADP 29 — anxiety manufactured from the
 * shape of your schedule rather than from anything about the player. A
 * player's ADP does not get less certain because your next pick is far away.
 *
 * `teamCount` is optional so the older two-argument call still means what it
 * always did; the board passes it.
 */
export function defaultRiskMargin(currentPick, nextPick, teamCount = null) {
  const halfGap = Math.max(0, (nextPick - currentPick) / 2);
  return teamCount ? Math.min(halfGap, teamCount / 2) : halfGap;
}

/**
 * Can this player survive until your next turn? Availability only — this says
 * nothing about whether he is worth taking, which is `priceBand`'s job.
 *
 *   adp <= nextPick                        -> 'gone'   his ADP lands at or
 *                                                      before your next turn
 *   nextPick < adp <= nextPick + margin    -> 'risky'  close to the edge
 *   adp > nextPick + margin                -> 'safe'
 *
 * There used to be a fourth branch, 'overdue', for a player whose ADP had
 * already passed the current pick, styled as the board's loudest value signal.
 * It is gone: that was the *market* calling him a value, and the market's
 * opinion of a player is not the drafter's. Value is now measured against your
 * own rankings (see `priceBand`), and an ADP in the past says only what it
 * ever said about availability — he'll be gone.
 *
 * Returns null when ADP is unknown — the card omits the chip rather than
 * guessing, since every branch here is a claim about the market and there is
 * no market reading to make one from.
 */
export function waitStatus(adp, currentPick, nextPick, riskMargin = defaultRiskMargin(currentPick, nextPick)) {
  if (adp == null) return null;
  if (adp <= nextPick) return 'gone';
  if (adp <= nextPick + riskMargin) return 'risky';
  return 'safe';
}

// --- Price: what he is worth to YOU --------------------------------------
//
// `diff` (computed in lib/mapPlayer.js) is your disagreement with the market,
// in rounds: (yourRank - adp) / teamCount. Negative means you rate him above
// where the room takes him, so you can have him later than he's worth to you —
// a bargain. Positive means the room takes him earlier than you'd ever want
// him, so getting him at all means paying more than your own price.

// Inside half a round you and the market agree closely enough that the
// difference is noise, so it earns no mark at all. Past 0.8 of a round the
// disagreement is big enough to act on rather than merely notice.
export const FAIR_ROUNDS = 0.5;
export const STRONG_ROUNDS = 0.8;

export function priceBand(diff, fair = FAIR_ROUNDS, strong = STRONG_ROUNDS) {
  if (diff == null) return null;
  if (diff <= -strong) return 'steal';
  if (diff < -fair) return 'value';
  if (diff <= fair) return 'fair';
  if (diff < strong) return 'rich';
  return 'overpay';
}

/**
 * The window of your own picks in which a player is both worth taking and
 * still likely to be there.
 *
 *   floor    the first of your picks at or after your rank for him. Earlier
 *            than that and you're spending a pick worth more than he is.
 *   ceiling  the last of your picks before his ADP. Later and the room has him.
 *
 * `open` is the whole point. When the ceiling has fallen below the floor there
 * is no pick at which he is both available and worth his price — which is
 * exactly the overpay this is meant to keep you out of.
 *
 * The ceiling is strict (`pick < adp`) rather than padded. ADP is an average,
 * so a pick right at the edge is a coin flip — that residual risk is what the
 * wait status is for, and padding here would bury the same caution twice.
 */
export function pickWindow(player, myPickNumbers = []) {
  const rank = player?.overallRank;
  const adp = player?.adp;
  if (rank == null || adp == null || !myPickNumbers.length) return null;

  const floor = myPickNumbers.find((pk) => pk >= rank) ?? null;
  let ceiling = null;
  for (const pk of myPickNumbers) if (pk < adp) ceiling = pk;

  return { floor, ceiling, open: floor != null && ceiling != null && ceiling >= floor };
}

// --- The plan: who to take with each of my upcoming picks ----------------
//
// A per-card window can say "he lasts until 41" about three players at once,
// which reads as an instruction the board can't keep — only one man can be
// taken at 41. So the recommendation is computed for the BOARD, not the card:
// walk my upcoming picks in order and hand each one a single player.

const byRank = (a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity);

/**
 * The first of my picks after my current turn-block.
 *
 * At the turn of a snake two of my picks are back to back (40 and 41), so
 * "what if I wait?" asked at 40 is nearly meaningless against 41 — one pick
 * later almost nobody has moved. The honest reference is the next time I'm up
 * after the whole block, which is what "wait one more round" means.
 */
export function survivalPickFor(myPickNumbers = []) {
  let i = 0;
  while (i + 1 < myPickNumbers.length && myPickNumbers[i + 1] === myPickNumbers[i] + 1) i++;
  return myPickNumbers[i + 1] ?? null;
}

// Is he plausibly still there when that pick arrives? At the pick I'm actually
// making the question is settled — he's on the board, I can see him — so ADP
// doesn't get to overrule the fact. For a future pick, ADP is all there is.
function stillOnBoard(player, pick, currentPick, isMyTurn) {
  if (isMyTurn && pick === currentPick) return true;
  return player.adp == null || player.adp >= pick;
}

/**
 * One player per upcoming pick, best-ranked first, most endangered first.
 *
 * For each pick, the candidates are players likely to still be there. Among
 * them it prefers someone who would NOT survive to my next turn after this one
 * — taking the man I'd otherwise lose, and leaving the one who'll keep. That
 * ordering is what lets a back-to-back 40/41 collect both: the endangered
 * player goes at 40, the one who lasts goes at 41.
 *
 * Returns Map(playerId -> pick number).
 */
export function planPicks({
  players,
  myPickNumbers = [],
  currentPick,
  isMyTurn = false,
  survivalPick = null,
  horizon = Infinity,
}) {
  // A player the board tells me to walk away from must never turn up in the
  // plan: "let him go" and "take him at 20" can't both be true of one man.
  const available = players
    .filter((p) => {
      if (p.drafted) return false;
      const band = priceBand(p.diff);
      return band !== 'rich' && band !== 'overpay';
    })
    .sort(byRank);
  const picks = myPickNumbers.filter((pk) => pk <= horizon);
  const plan = new Map();
  const used = new Set();

  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    // My next chance after this pick: the following pick of mine inside the
    // block, or once the block is done, the turn after it.
    const nextOwn = picks[i + 1] ?? survivalPick;
    const pool = available.filter(
      (p) => !used.has(p.id) && stillOnBoard(p, pick, currentPick, isMyTurn)
    );
    if (!pool.length) continue;

    const endangered = nextOwn == null ? [] : pool.filter((p) => p.adp != null && p.adp <= nextOwn);
    // Both lists are already rank-sorted, so [0] is my best man either way.
    const choice = endangered[0] ?? pool[0];
    plan.set(choice.id, pick);
    used.add(choice.id);
  }

  return plan;
}

// Which column owns a dual-eligible player. Ties go left to right here — a
// player who tops two lists shows under the scarcer, more specific position
// rather than being duplicated across both.
export const COLUMN_PRIORITY = ['RW', 'LW', 'C', 'D', 'G'];

/**
 * Every available player belongs to exactly one column: the one where he sits
 * highest among what's left. Showing the same man in three columns at once
 * makes the board look three players deeper than it is.
 *
 * Returns Map(playerId -> position).
 */
export function assignColumns(players, positions, priority = COLUMN_PRIORITY) {
  const placeIn = new Map();
  for (const pos of positions) {
    const pool = players.filter((p) => !p.drafted && eligibleAt(p, pos)).sort(byRank);
    placeIn.set(pos, new Map(pool.map((p, i) => [p.id, i])));
  }

  const rankOf = (pos) => {
    const i = priority.indexOf(pos);
    return i === -1 ? priority.length : i;
  };

  const owner = new Map();
  for (const p of players) {
    if (p.drafted) continue;
    let best = null;
    for (const pos of positions) {
      const place = placeIn.get(pos)?.get(p.id);
      if (place == null) continue;
      if (best == null || place < best.place || (place === best.place && rankOf(pos) < rankOf(best.pos))) {
        best = { pos, place };
      }
    }
    if (best) owner.set(p.id, best.pos);
  }
  return owner;
}

/**
 * One verdict per card, from the plan, availability and price together.
 *
 *   'takehim'   the plan spends the pick I'm making right now on him
 *   'takeat'    the plan spends a named later pick of mine on him
 *   'letgo'     no pick of mine has him both available and worth his price
 *   otherwise   plain availability
 *
 * Everything the plan didn't choose falls back to a plain statement rather
 * than an instruction, which is what keeps LIKELY GONE off the one player I
 * should actually be taking and off the two who are merely outranked.
 */
export function cardVerdict({ status, band, window: win, plannedPick = null, currentPick, isMyTurn = false }) {
  if (plannedPick != null) {
    return isMyTurn && plannedPick === currentPick ? 'takehim' : 'takeat';
  }
  // The room is bidding past my price and no pick of mine lands in time: the
  // one case where the honest advice is to stop looking at him.
  if (win && !win.open && (band === 'rich' || band === 'overpay')) return 'letgo';
  // Not chosen, but still a fact worth stating — he'll be gone, or he'll keep.
  return status;
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
  myPickNumbers = [],
  teamCount = null,
  isMyTurn = false,
  depth = 3,
}) {
  // Properties of your schedule, not of any player, so they're computed once
  // for the whole board rather than per card.
  const riskMargin = defaultRiskMargin(currentPick, nextPick, teamCount);
  const horizon = teamCount ? currentPick + teamCount * 2 : Infinity;
  // One player per upcoming pick, so the board can never tell me to take
  // three different men at 41.
  const plan = planPicks({
    players,
    myPickNumbers,
    currentPick,
    isMyTurn,
    survivalPick: survivalPickFor(myPickNumbers),
    horizon,
  });
  // Every available player is drawn in exactly one column.
  const columnOf = assignColumns(players, positions);

  const columns = positions.map((pos) => {
    const counts = classifyRemaining(players, pos, currentPick);
    // The full eligible pool, deliberately still inclusive: scarcity and the
    // category z-scores are measured against it, and a dual-eligible player
    // really is draftable here even when he's drawn in another column.
    const pool = players
      .filter((p) => !p.drafted && eligibleAt(p, pos))
      .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity));

    // ...but only the players this column owns are drawn, and the cliff is
    // scoped to those: a drop twenty players down isn't news at this pick.
    const shown = pool.filter((p) => columnOf.get(p.id) === pos).slice(0, depth);
    const cliffAfter = detectCliff(shown, counts);

    const slots = rosterSlots?.[pos] ?? 0;
    const filled = myPlayers.filter((p) => eligibleAt(p, pos)).length;
    const positionFull = slots > 0 && filled >= slots;

    const cards = shown.map((p, i) => {
      const available = waitStatus(p.adp, currentPick, nextPick, riskMargin);
      const band = priceBand(p.diff);
      const win = pickWindow(p, myPickNumbers);
      const share = offNightShare(p);
      return {
        id: p.id,
        rank: i + 1,
        name: p.name,
        overallRank: p.overallRank,
        tier: p.tier,
        adp: p.adp,
        // Your disagreement with the market, in rounds, and the band it falls
        // in: the gutter prints the number, the band decides how loud.
        diff: p.diff ?? null,
        band,
        // The pick the plan actually spends on him, when it spends one.
        takeAt: plan.get(p.id) ?? null,
        // Kept alongside the verdict so the card can still say what the market
        // alone thinks — the verdict is the two readings crossed.
        available,
        status: cardVerdict({
          status: available,
          band,
          window: win,
          plannedPick: plan.get(p.id) ?? null,
          currentPick,
          isMyTurn,
        }),
        tracked: !!p.tracked,
        cats: topCategories(p, pool),
        ongPct: share == null ? null : Math.round(share * 100),
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
