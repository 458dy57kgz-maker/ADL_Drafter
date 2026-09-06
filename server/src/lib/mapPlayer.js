// Positions are stored as a single comma-separated string (e.g. "C,LW") to
// support multi-position-eligible players without a schema migration to a
// junction table — this is the one place that parses it, so every consumer
// works off `posList` instead of re-parsing `pos` themselves.
export function normalizePosList(raw) {
  return String(raw ?? '')
    .split(/[,/]/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

// DIFF is how far my own ranking sits from the market's, expressed in rounds
// rather than picks — (my overall rank - ADP) / number of teams. Dividing by
// the team count is what makes it comparable across a draft: 15 picks of
// disagreement is a round and a half in a 10-team league but only three
// quarters of one in a 20-team league.
//
// Negative means I rank the player higher than the field does (I'd have to
// reach to get him); positive means the field takes him earlier than I rate
// him. It's derived on read, not stored, so editing a rank or an ADP in the
// Players grid can never leave a stale DIFF behind.
export function computeDiff(overallRank, adp, teamCount) {
  if (overallRank == null || adp == null || !teamCount) return null;
  return Math.round(((overallRank - adp) / teamCount) * 10) / 10;
}

export function mapPlayerRow(row, teamCount = null) {
  return {
    id: row.id,
    name: row.name,
    pos: row.pos,
    posList: normalizePosList(row.pos),
    team: row.team,
    rank: row.rank,
    overallRank: row.overall_rank,
    adp: row.adp,
    tier: row.tier,
    g: row.g,
    a: row.a,
    p: row.p,
    ppp: row.ppp,
    plusMinus: row.plus_minus,
    shots: row.shots,
    blocks: row.blocks,
    ong: row.ong,
    gp: row.gp,
    vorp: row.vorp,
    diff: computeDiff(row.overall_rank, row.adp, teamCount),
    w: row.w,
    gaa: row.gaa,
    saves: row.saves,
    drafted: !!row.drafted,
    draftedBy: row.drafted_by,
    mine: !!row.mine,
    tracked: !!row.tracked,
  };
}
