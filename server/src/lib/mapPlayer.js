// Positions are stored as a single comma-separated string (e.g. "C,LW") to
// support multi-position-eligible players without a schema migration to a
// junction table — this is the one place that parses it, so every consumer
// works off `posList` instead of re-parsing `pos` themselves.
// My own note on a player, set from the Players grid and drawn beside his
// name everywhere in the War Room. Stored as a plain string so a fourth one
// is a one-line change; NULL means no note.
export const PLAYER_FLAGS = ['sleeper', 'avoid', 'favourite'];

// What the other managers see when they size a player up, and how much luck
// went into it — the preseason sheet's reputation columns. None of it is my
// projection; season mode uses it to guess a player's trade value in their
// eyes. Three-year skater rates are per 82 games; the goalie three-year
// columns are totals, turned into per-start rates where they're used. SHSV
// is on-ice shooting % plus save % (1000 = neutral); shooting % and IPP come
// as last season beside the career rate, so a hot year shows as the gap.
export const PROFILE_FIELDS = [
  { key: 'gp3y', column: 'gp_3y' },
  { key: 'g3y', column: 'g_3y' },
  { key: 'a3y', column: 'a_3y' },
  { key: 'pts3y', column: 'pts_3y' },
  { key: 'bs3y', column: 'bs_3y' },
  { key: 'sogCareer', column: 'sog_career' },
  { key: 'gs3y', column: 'gs_3y' },
  { key: 'w3y', column: 'w_3y' },
  { key: 'sv3y', column: 'sv_3y' },
  { key: 'gaa3y', column: 'gaa_3y' },
  { key: 'yown', column: 'yown' },
  { key: 'shsv', column: 'shsv' },
  { key: 'lyShPct', column: 'ly_sh_pct' },
  { key: 'cShPct', column: 'c_sh_pct' },
  { key: 'lyIpp', column: 'ly_ipp' },
  { key: 'cIpp', column: 'c_ipp' },
];

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
    ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, row[f.column] ?? null])),
    drafted: !!row.drafted,
    draftedBy: row.drafted_by,
    mine: !!row.mine,
    tracked: !!row.tracked,
    flag: row.flag ?? null,
    // A seat in My Roster I picked by hand (a position or 'BN'); NULL = let
    // the roster fill place him. See assignRoster in roster.js.
    rosterSlot: row.roster_slot ?? null,
  };
}
