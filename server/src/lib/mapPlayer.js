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

export function mapPlayerRow(row) {
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
    w: row.w,
    gaa: row.gaa,
    saves: row.saves,
    drafted: !!row.drafted,
    draftedBy: row.drafted_by,
    mine: !!row.mine,
    tracked: !!row.tracked,
  };
}
