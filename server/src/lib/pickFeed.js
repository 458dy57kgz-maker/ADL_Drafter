// Ingest for the live pick feed — the JSON file a Chrome bookmarklet appends
// to as Yahoo's draft room announces picks. Everything here is pure so it can
// be tested against the real file with no database and no browser.
//
// What the feed gives us, per entry:
//   { pick, draftedBy, player: "C. Caufield", position: "LW,RW", nhlTeam }
//
// Two things it does NOT give us, and both are inferred here:
//   - the draft order (recovered from the snake pattern of who picked when)
//   - which pool player each abbreviated name refers to

import { slotForPick } from './draftMath.js';

// Stands in for a pick the feed never saw, when it was started mid-draft. It
// holds the pick number so the snake math stays true, and claims no player.
export const PLACEHOLDER_NAME = '(before feed started)';

// Accents are the difference between "Slafkovský" in the feed and
// "Slafkovsky" in an export, and punctuation between "T.J." and "TJ".
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // combining accents
    .toLowerCase()
    .replace(/[.'`’-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "C. Caufield" -> { initial: 'c', last: 'caufield' }
// A full name works too, so the same matcher handles a feed that stops
// abbreviating: "Cole Caufield" -> { initial: 'c', last: 'caufield' }.
export function parseFeedName(raw) {
  const normalized = normalizeName(raw);
  if (!normalized) return null;
  const parts = normalized.split(' ');
  if (parts.length === 1) return { initial: null, last: parts[0], full: normalized };
  // Suffixes are part of nobody's surname for matching purposes.
  while (parts.length > 2 && ['jr', 'sr', 'ii', 'iii', 'iv'].includes(parts[parts.length - 1])) parts.pop();
  return { initial: parts[0][0], last: parts.slice(1).join(' '), full: normalized };
}

// NHL abbreviations disagree between sources — the feed says LA/NJ/SJ/TB where
// an export may say LAK/NJD/SJS/TBL. Compared loosely and used ONLY to break a
// tie, never to reject a match: a stale team on a traded player would
// otherwise throw away a name that is obviously right.
function sameTeam(a, b) {
  const x = normalizeName(a).replace(/[^a-z]/g, '');
  const y = normalizeName(b).replace(/[^a-z]/g, '');
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

function positionOverlap(feedPos, posList) {
  const feed = String(feedPos ?? '')
    .split(/[,/]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!feed.length || !posList?.length) return false;
  return feed.some((p) => posList.includes(p));
}

/**
 * Resolve one feed entry to a player in the pool.
 *
 * Returns `{ player, confidence, reason }` or null. Confidence is what the UI
 * shows: 'exact' needs no review, 'likely' resolved a genuine ambiguity using
 * team or position, and anything unresolved comes back null so the pick is
 * still recorded but no player is marked drafted — a wrong player marked
 * drafted is far worse than a gap the drafter can see and fix.
 *
 * `aliases` maps a feed name to a pool name (the existing name_aliases table),
 * and wins over everything: it is the drafter saying so explicitly.
 */
export function matchPlayer(entry, players, aliases = new Map()) {
  const parsed = parseFeedName(entry.player);
  if (!parsed) return null;

  const aliased = aliases.get(parsed.full);
  if (aliased) {
    const target = players.find((p) => normalizeName(p.name) === normalizeName(aliased));
    if (target) return { player: target, confidence: 'exact', reason: 'alias' };
  }

  // Whole name matches outright — the feed isn't always abbreviated.
  const exact = players.filter((p) => normalizeName(p.name) === parsed.full);
  if (exact.length === 1) return { player: exact[0], confidence: 'exact', reason: 'full name' };

  const byLast = players.filter((p) => {
    const pp = parseFeedName(p.name);
    return pp && pp.last === parsed.last;
  });
  if (!byLast.length) return null;

  const byInitial = parsed.initial
    ? byLast.filter((p) => parseFeedName(p.name)?.initial === parsed.initial)
    : byLast;
  if (byInitial.length === 1) {
    return { player: byInitial[0], confidence: 'exact', reason: parsed.initial ? 'initial + last name' : 'last name' };
  }
  if (!byInitial.length) return null;

  // Still ambiguous: two players share a last name and an initial. The feed's
  // own NHL team settles it, and failing that, position.
  const byTeam = byInitial.filter((p) => sameTeam(p.team, entry.nhlTeam));
  if (byTeam.length === 1) return { player: byTeam[0], confidence: 'likely', reason: 'name + NHL team' };

  const pool = byTeam.length ? byTeam : byInitial;
  const byPos = pool.filter((p) => positionOverlap(entry.position, p.posList));
  if (byPos.length === 1) return { player: byPos[0], confidence: 'likely', reason: 'name + position' };

  return null;
}

/**
 * Recover the draft order from the picks themselves.
 *
 * A snake draft leaves a signature: with the right team count, every manager
 * lands on exactly one slot in every round. With the wrong count they smear
 * across several. So this tries each plausible team count and keeps the ones
 * where the pattern holds perfectly — no guessing, and it says so when the
 * evidence is thin rather than inventing an order.
 *
 * Needs picks from at least two rounds to be meaningful: inside a single round
 * every count "works" trivially, because each team has only picked once.
 */
export function inferDraftOrder(feedPicks, { minTeams = 4, maxTeams = 24, youLabel = 'You' } = {}) {
  const picks = [...feedPicks].filter((p) => Number.isInteger(p.pick) && p.draftedBy).sort((a, b) => a.pick - b.pick);
  if (picks.length < minTeams * 2) return null;

  const candidates = [];
  for (let n = minTeams; n <= maxTeams; n++) {
    const bySlot = new Map();
    const byTeam = new Map();
    let ok = true;
    for (const p of picks) {
      const slot = slotForPick(p.pick, n);
      const seatedTeam = bySlot.get(slot);
      const seatedSlot = byTeam.get(p.draftedBy);
      if ((seatedTeam && seatedTeam !== p.draftedBy) || (seatedSlot && seatedSlot !== slot)) {
        ok = false;
        break;
      }
      bySlot.set(slot, p.draftedBy);
      byTeam.set(p.draftedBy, slot);
    }
    // Every seat filled and every manager seated: a partial fit is not a fit,
    // it just means we haven't seen enough of the draft yet.
    if (ok && bySlot.size === n && byTeam.size === n) {
      candidates.push({ teamCount: n, bySlot });
    }
  }
  if (candidates.length !== 1) return null;

  const { teamCount, bySlot } = candidates[0];
  const teams = [];
  for (let slot = 1; slot <= teamCount; slot++) teams.push({ slot, name: bySlot.get(slot) });
  const mine = teams.find((t) => normalizeName(t.name) === normalizeName(youLabel));

  return {
    teamCount,
    teams,
    myTeamSlot: mine?.slot ?? null,
    roundsSeen: new Set(picks.map((p) => Math.floor((p.pick - 1) / teamCount) + 1)).size,
  };
}

/**
 * Turn the feed into the exact pick list the draft should hold.
 *
 * Teams come from the slot the pick number implies, not from the feed's
 * `draftedBy` string: slots are arithmetic, names are typing. The feed's name
 * is still compared against the seated team, and any disagreement is reported
 * — that mismatch is the signal that the configured order is wrong.
 *
 * Picks the feed doesn't cover (it can be started mid-draft) become explicit
 * placeholder rows, because pick numbering has to stay contiguous for the
 * snake math above it to mean anything.
 */
export function planSync({ feedPicks, players, teams, teamCount, myTeamId, aliases = new Map(), existingBefore = [] }) {
  const picks = [...feedPicks]
    .filter((p) => Number.isInteger(p.pick) && p.pick > 0)
    .sort((a, b) => a.pick - b.pick);

  const rows = [];
  const unmatched = [];
  const teamMismatches = [];

  const feedStart = picks.length ? picks[0].pick : 1;
  const keptBefore = new Map(existingBefore.filter((r) => r.pick_num < feedStart).map((r) => [r.pick_num, r]));

  for (let pickNum = 1; pickNum < feedStart; pickNum++) {
    const kept = keptBefore.get(pickNum);
    rows.push(
      kept
        ? {
            pickNum,
            team: kept.team,
            playerId: kept.player_id,
            playerName: kept.player_name,
            pos: kept.pos,
            source: 'kept',
          }
        : {
            pickNum,
            team: teams[slotForPick(pickNum, teamCount) - 1]?.name ?? `Slot ${slotForPick(pickNum, teamCount)}`,
            playerId: null,
            playerName: PLACEHOLDER_NAME,
            pos: '—',
            source: 'placeholder',
          }
    );
  }

  const seen = new Set();
  for (const entry of picks) {
    if (seen.has(entry.pick)) continue; // a duplicated pick number in the file
    seen.add(entry.pick);

    const slot = slotForPick(entry.pick, teamCount);
    const team = teams[slot - 1];
    if (team && entry.draftedBy && normalizeName(team.name) !== normalizeName(entry.draftedBy)) {
      teamMismatches.push({ pick: entry.pick, expected: team.name, feed: entry.draftedBy });
    }

    const match = matchPlayer(entry, players, aliases);
    if (!match) unmatched.push({ pick: entry.pick, name: entry.player, position: entry.position, nhlTeam: entry.nhlTeam });

    rows.push({
      pickNum: entry.pick,
      team: team?.name ?? entry.draftedBy,
      playerId: match?.player.id ?? null,
      playerName: match?.player.name ?? entry.player,
      pos: match?.player.pos ?? entry.position ?? '—',
      mine: !!team && team.id === myTeamId,
      confidence: match?.confidence ?? null,
      source: 'feed',
    });
  }

  return {
    rows,
    unmatched,
    teamMismatches,
    feedStart,
    gapBefore: Math.max(0, feedStart - 1),
    lastPick: rows.length ? rows[rows.length - 1].pickNum : 0,
  };
}
