#!/usr/bin/env node
/**
 * ADL Drafter — diagnostics
 * -------------------------
 *   node diagnose.js players.json
 *   node diagnose.js players.csv
 *
 * Answers three questions:
 *   1. What is VORP actually measuring?
 *   2. Is ONG a count, a rate, or something else?
 *   3. Why is the model biased toward D, and which input causes it?
 *
 * Nothing here writes to your data. It only reports.
 */

import fs from 'fs';
import {
  buildContext, DEFAULT_CONFIG, recommend, marginalValue,
  teamCategoryProbs, startRate, myPicks, assignLineup,
} from './draftValue.js';

// Local overrides live in config.local.js so engine updates never wipe them.
let LOCAL = {};
try {
  LOCAL = (await import('./config.local.js')).default ?? {};
} catch (e) {
  if (!String(e.message).includes('Cannot find module')) throw e;
}
Object.assign(DEFAULT_CONFIG, LOCAL);

const path = process.argv[2];
if (!path) {
  console.error('usage: node diagnose.js <players.json|players.csv>');
  console.error('       node diagnose.js <file> --compare "Player A" "Player B" [--roster "X,Y,Z"]');
  process.exit(1);
}
const argv = process.argv.slice(3);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 ? null : argv.slice(i + 1).filter((a) => !a.startsWith('--'));
};
const COMPARE = flag('--compare');
const ROSTER_ARG = (flag('--roster') || [])[0];

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

const NUM = new Set(['id', 'overallRank', 'rank', 'adp', 'tier', 'g', 'a', 'p', 'ppp',
  'plusMinus', 'shots', 'blocks', 'w', 'gaa', 'saves', 'vorp', 'ong', 'gp']);

function load(file) {
  const text = fs.readFileSync(file, 'utf8');
  const head = text.trimStart().slice(0, 200);
  if (/^<!doctype|^<html/i.test(head)) {
    console.error(`\n${file} contains HTML, not player data (${text.length} bytes).`);
    console.error('You probably curled the app root instead of the API endpoint.');
    console.error('Try:  curl <host>:<port>/api/players > players.json');
    console.error('Then: head -c 200 players.json   (should start with [{"id":)\n');
    process.exit(1);
  }
  let rows;
  if (file.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error(`\nCould not parse ${file} as JSON: ${e.message}`);
      console.error(`First 120 chars: ${head.slice(0, 120)}\n`);
      process.exit(1);
    }
    rows = Array.isArray(parsed) ? parsed : (parsed.players || parsed.data);
    if (!Array.isArray(rows)) {
      console.error(`\n${file} parsed, but no player array found.`);
      console.error(`Top-level keys: ${Object.keys(parsed).join(', ')}`);
      console.error('Expected an array, or an object with a "players" or "data" key.\n');
      process.exit(1);
    }
  } else {
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(',').map((h) => h.trim());
    rows = lines.slice(1).map((l) => {
      const cells = l.split(',');
      const o = {};
      head.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
      return o;
    });
  }
  return rows.map((r) => {
    const o = { ...r };
    for (const k of Object.keys(o)) {
      if (o[k] === '' || o[k] == null || o[k] === 'null') { o[k] = null; continue; }
      if (NUM.has(k)) { const v = Number(o[k]); o[k] = Number.isFinite(v) ? v : null; }
    }
    o.posList = o.posList || String(o.pos || '').split(',').map((s) => s.trim()).filter(Boolean);
    return o;
  });
}

const players = load(path);
const skaters = players.filter((p) => !p.posList.includes('G'));
const goalies = players.filter((p) => p.posList.includes('G'));

const h = (s) => console.log(`\n${'='.repeat(66)}\n${s}\n${'='.repeat(66)}`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const num = (x, d = 2) => (x == null ? '—' : Number(x).toFixed(d));

function stats(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length, min: s[0], max: s[s.length - 1], mean,
    p25: s[Math.floor(s.length * 0.25)], median: s[s.length >> 1],
    p75: s[Math.floor(s.length * 0.75)],
    sd: Math.sqrt(s.reduce((a, v) => a + (v - mean) ** 2, 0) / s.length),
  };
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2;
  }
  return sxy / (Math.sqrt(sxx * syy) || 1);
}

function spearman(xs, ys) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    idx.forEach(([, i], k) => { r[i] = k; });
    return r;
  };
  return pearson(rank(xs), rank(ys));
}

// ---------------------------------------------------------------------------
// 1. FIELD COVERAGE
// ---------------------------------------------------------------------------

h('1. FIELD COVERAGE');
console.log(`${players.length} players (${skaters.length} skaters, ${goalies.length} goalies)\n`);
const fields = ['overallRank', 'adp', 'vorp', 'ong', 'gp', 'g', 'a', 'p', 'ppp',
  'plusMinus', 'shots', 'blocks', 'w', 'gaa', 'saves'];
for (const f of fields) {
  const pop = ['w', 'gaa', 'saves'].includes(f) ? goalies
    : ['g', 'a', 'p', 'ppp', 'plusMinus', 'shots', 'blocks'].includes(f) ? skaters : players;
  const have = pop.filter((p) => p[f] != null).length;
  const cov = have / (pop.length || 1);
  const flag = cov < 0.9 ? '  <-- LOW' : '';
  console.log(`  ${f.padEnd(12)} ${String(have).padStart(4)}/${String(pop.length).padEnd(4)} ${pct(cov).padStart(7)}${flag}`);
}

// ---------------------------------------------------------------------------
// 2. WHAT IS VORP?
// ---------------------------------------------------------------------------

h('2. WHAT IS VORP ACTUALLY MEASURING?');
const withV = players.filter((p) => p.vorp != null);
if (!withV.length) {
  console.log('  No vorp values present.');
} else {
  const st = stats(withV.map((p) => p.vorp));
  console.log(`  range ${num(st.min)} .. ${num(st.max)}   mean ${num(st.mean)}   sd ${num(st.sd)}`);
  console.log(`  quartiles  p25 ${num(st.p25)}  median ${num(st.median)}  p75 ${num(st.p75)}`);
  const neg = withV.filter((p) => p.vorp < 0).length;
  console.log(`  negative values: ${neg} (${pct(neg / withV.length)})`);

  console.log('\n  --- Identity tests (what does vorp track?) ---');
  // z-score sum: standardize each category within population and add.
  const cats = DEFAULT_CONFIG.categories;
  const zsum = (pool, popKey) => {
    const norm = {};
    for (const c of cats.filter((c) => c.pop === popKey)) {
      const v = pool.map((p) => p[c.key]).filter((x) => x != null);
      const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length || 1)) || 1;
      norm[c.key] = { m, sd, invert: c.invert };
    }
    return pool.map((p) => cats.filter((c) => c.pop === popKey)
      .reduce((s, c) => s + (p[c.key] == null ? 0
        : (c.invert ? -1 : 1) * ((p[c.key] - norm[c.key].m) / norm[c.key].sd)), 0));
  };

  const sk = skaters.filter((p) => p.vorp != null);
  if (sk.length > 5) {
    const z = zsum(sk, 'skater');
    const v = sk.map((p) => p.vorp);
    const pts = sk.map((p) => (p.p ?? 0));
    const rk = sk.filter((p) => p.overallRank != null);
    console.log(`  vorp vs z-score sum      pearson ${num(pearson(v, z), 3)}  spearman ${num(spearman(v, z), 3)}`);
    console.log(`  vorp vs total points     pearson ${num(pearson(v, pts), 3)}`);
    if (rk.length > 5) {
      console.log(`  vorp vs overallRank      spearman ${num(spearman(rk.map((p) => p.vorp), rk.map((p) => p.overallRank)), 3)}  (expect ~ -1 if rank is derived from vorp)`);
    }
    console.log('\n  Reading it:');
    console.log('    pearson > 0.97 vs z-sum      -> it IS a z-score sum');
    console.log('    pearson > 0.97 vs points     -> it is points-based, NOT z-scores');
    console.log('    both moderate                -> a custom blend; treat as ordering only');
  }

  console.log('\n  --- Is VORP stale? (does it know about blocks?) ---');
  {
    const sk2 = skaters.filter((p) => p.vorp != null);
    const zWith = zsum(sk2, 'skater');
    const catsNoBlocks = cats.filter((c) => c.key !== 'blocks');
    const zsumSubset = (pool, list) => {
      const norm = {};
      for (const c of list.filter((c) => c.pop === 'skater')) {
        const v = pool.map((p) => p[c.key]).filter((x) => x != null);
        const m = v.reduce((a, b) => a + b, 0) / (v.length || 1);
        const sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length || 1)) || 1;
        norm[c.key] = { m, sd, invert: c.invert };
      }
      return pool.map((p) => list.filter((c) => c.pop === 'skater')
        .reduce((s, c) => s + (p[c.key] == null ? 0
          : (c.invert ? -1 : 1) * ((p[c.key] - norm[c.key].m) / norm[c.key].sd)), 0));
    };
    const zNo = zsumSubset(sk2, catsNoBlocks);
    const v = sk2.map((p) => p.vorp);
    const rWith = pearson(v, zWith), rNo = pearson(v, zNo);
    console.log(`  vorp vs z-sum WITH blocks     ${num(rWith, 3)}`);
    console.log(`  vorp vs z-sum WITHOUT blocks  ${num(rNo, 3)}`);
    if (rNo > rWith + 0.04) {
      console.log('  <-- VORP matches the no-blocks model better. It is STALE:');
      console.log('      recompute it now that blocks is a category, or shot-blocking');
      console.log('      defensemen will keep landing at replacement level.');
    } else {
      console.log('  VORP appears to account for blocks.');
    }

    console.log('\n  --- Within-position correlation (cross-position gaps are expected) ---');
    for (const pos of ['C', 'LW', 'RW', 'D']) {
      const sub = sk2.filter((p) => p.posList.includes(pos));
      if (sub.length < 10) continue;
      const z = zsumSubset(sub, cats);
      const r = pearson(sub.map((p) => p.vorp), z);
      const flag = r < 0.9 ? '  <-- weak; VORP is not tracking your categories here' : '';
      console.log(`  ${pos.padEnd(3)} n=${String(sub.length).padStart(3)}  pearson ${num(r, 3)}${flag}`);
    }
  }

  console.log('\n  --- Zero crossing by position (this is the replacement level) ---');
  for (const pos of Object.keys(DEFAULT_CONFIG.slots)) {
    const pool = players.filter((p) => p.posList.includes(pos) && p.vorp != null)
      .sort((a, b) => b.vorp - a.vorp);
    if (!pool.length) { console.log(`  ${pos.padEnd(3)} no players`); continue; }
    const idx = pool.findIndex((p) => p.vorp <= 0);
    const expected = DEFAULT_CONFIG.teamCount * DEFAULT_CONFIG.slots[pos];
    if (idx < 0) {
      console.log(`  ${pos.padEnd(3)} NEVER CROSSES ZERO (min ${num(pool[pool.length - 1].vorp)})  <-- vorp is not over-replacement`);
    } else {
      const off = idx - expected;
      const flag = Math.abs(off) > expected * 0.6 ? '  <-- inconsistent with other positions' : '';
      console.log(`  ${pos.padEnd(3)} crosses at depth ${String(idx).padStart(3)}  (starter demand ${expected})${flag}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. IS ONG A COUNT OR A RATE?
// ---------------------------------------------------------------------------

h('3. ONG SANITY');
const withO = players.filter((p) => p.ong != null);
if (!withO.length) {
  console.log('  No ong values present.');
} else {
  const st = stats(withO.map((p) => p.ong));
  console.log(`  raw ong  range ${num(st.min, 0)} .. ${num(st.max, 0)}  median ${num(st.median, 0)}`);
  const shares = withO.map((p) => p.ong / (p.gp ?? DEFAULT_CONFIG.seasonGames));
  const ss = stats(shares);
  console.log(`  ong / gp range ${num(ss.min, 3)} .. ${num(ss.max, 3)}  median ${num(ss.median, 3)}  sd ${num(ss.sd, 3)}`);
  if (st.max <= 1.01) console.log('  <-- ong looks like a RATE already, not a count. Do not divide by gp.');
  else if (ss.median < 0.10) console.log('  <-- share is implausibly low. Check the gp denominator.');
  else if (ss.median > 0.75) console.log('  <-- share is implausibly high. Is this total games, not off-night games?');
  else console.log('  Looks like a plausible off-night count.');
  console.log(`  spread across players: ${num(ss.sd * 100, 1)} percentage points sd`);
  console.log('  A large spread here with ongWeight=1.0 can outweigh real talent gaps.');
}

// ---------------------------------------------------------------------------
// 4. WHAT THE MODEL DERIVED
// ---------------------------------------------------------------------------

h('4. DERIVED CONTEXT');
const ctx = buildContext(players, { ...DEFAULT_CONFIG });
console.log(`  vorp coverage used for ordering: ${pct(ctx.vorpCoverage)}`);
const bySrc = players.reduce((m, p) => { m[p._rawSource] = (m[p._rawSource] || 0) + 1; return m; }, {});
console.log(`  ordering source: ${JSON.stringify(bySrc)}`);
console.log(`  local overrides: ${Object.keys(LOCAL).length ? Object.keys(LOCAL).join(', ') : '(none — is config.local.js present?)'}`);
console.log(`  mean off-night share: ${num(ctx.meanOffShare, 3)}`);
console.log('\n  Replacement level chosen per position:');
for (const [pos, r] of Object.entries(ctx.replacement)) {
  if (!r) { console.log(`    ${pos.padEnd(3)} none`); continue; }
  if (pos === '_bench') { console.log(`    BEN blended around depth ${String(r._depth).padStart(3)} (waiver pool)`); continue; }
  const size = players.filter((p) => p.posList.includes(pos)).length;
  console.log(`    ${pos.padEnd(3)} blended around depth ${String(r._depth).padStart(3)}/${size}` +
    `  (window +/-${DEFAULT_CONFIG.replacementWindow})`);
}
for (const w of (ctx.config._warnings || [])) console.log(`  WARNING: ${w}`);

console.log(`\n  Baseline win probability, empty roster (baselineMode: ${DEFAULT_CONFIG.baselineMode}):`);
{
  const probs = teamCategoryProbs([], ctx);
  const vals = Object.values(probs);
  const spread = Math.max(...vals) - Math.min(...vals);
  Object.keys(probs).sort((a, b) => probs[b] - probs[a])
    .forEach((k) => console.log(`    ${k.padEnd(10)} ${pct(probs[k]).padStart(7)}`));
  console.log(`\n  Spread: ${(spread * 100).toFixed(1)} percentage points.`);
  console.log('  Under baselineMode \'blend\' or \'average\' these sit near 50% by design —');
  console.log('  empty slots are valued as league-average starters in round 1. Under');
  console.log('  \'replacement\' they should be LOW. Either way what matters is that they are');
  console.log('  EVEN: a spread above ~25pp means the fill blend is specialised in something,');
  console.log('  which makes real players look like downgrades there.');
  if (spread > 0.25) console.log('  <-- spread too wide; look at the outlier category above.');
}

// ---------------------------------------------------------------------------
// 5. POSITION BIAS
// ---------------------------------------------------------------------------

if (!COMPARE) h('5. POSITION BIAS — top recommendation from an empty roster onward');
if (!COMPARE) {
  const roster = [];
  let pool = [...players];
  const picks = myPicks(5, DEFAULT_CONFIG);
  const tally = {};
  for (let r = 1; r <= 10; r++) {
    const pickNum = picks[r - 1];
    const out = recommend({ available: pool, myRoster: roster, pickNum, round: r,
      myPickNumbers: picks }, ctx);
    if (!out.length) break;
    const top = out[0];
    const pos = top.player.posList.join('/');
    tally[pos] = (tally[pos] || 0) + 1;
    // Best available at that position by your own ordering, for comparison.
    const bestSame = pool.filter((p) => p.posList.some((x) => top.player.posList.includes(x)))
      .sort((a, b) => b._raw - a._raw)[0];
    const same = bestSame === top.player ? 'yes' : `NO -> board best is ${bestSame?.name}`;
    console.log(`  R${String(r).padStart(2)} pick ${String(pickNum).padStart(3)}  ${String(top.player.name).padEnd(20)} ${pos.padEnd(6)} mv ${num(top.marginalValue, 3)}  is board-best at pos: ${same}`);
    roster.push(top.player);
    pool = pool.filter((p) => p !== top.player);
  }
  console.log(`\n  Tally: ${JSON.stringify(tally)}`);
  console.log('  Heavy D skew here with "NO" in the right column means the candidate');
  console.log('  slice is ordering on a broken scale, not that D is genuinely best.');
}

// ---------------------------------------------------------------------------
// 6. WHY THIS PLAYER — full trace of one decision
// ---------------------------------------------------------------------------

if (!COMPARE) h('6. DECISION TRACE (round 4, empty-ish roster)');
if (!COMPARE) {
  const roster = [];
  const picks = myPicks(5, DEFAULT_CONFIG);
  const out = recommend({ available: players, myRoster: roster, pickNum: picks[3],
    round: 4, myPickNumbers: picks }, ctx);
  console.log('  name                  pos   raw    mv     surv   start  score');
  for (const c of out.slice(0, 10)) {
    const p = c.player;
    console.log(`  ${String(p.name).padEnd(21)} ${p.posList.join('/').padEnd(5)} ` +
      `${num(p._raw).padStart(5)}  ${num(c.marginalValue, 3).padStart(5)}  ` +
      `${num(c.survival, 2).padStart(4)}   ${num(startRate(p, true, ctx), 2).padStart(4)}   ${num(c.score, 3)}`);
  }
  const top = out[0]?.player;
  if (top) {
    const before = teamCategoryProbs(roster, ctx);
    const after = teamCategoryProbs([top], ctx);
    console.log(`\n  Category deltas for ${top.name}:`);
    Object.keys(after).sort((a, b) => (after[b] - before[b]) - (after[a] - before[a]))
      .forEach((k) => console.log(`    ${k.padEnd(10)} ${pct(before[k])} -> ${pct(after[k])}  (${(after[k] - before[k] >= 0 ? '+' : '')}${num((after[k] - before[k]) * 100, 1)}pp)`));
  }
}

// ---------------------------------------------------------------------------
// 7. ABLATIONS — turn each input off and see if the answer changes
// ---------------------------------------------------------------------------

if (!COMPARE) h('7. ABLATIONS');
if (!COMPARE) {
  const picks = myPicks(5, DEFAULT_CONFIG);
  const runs = [
    ['baseline', {}],
    ['ongWeight = 0 (ignore off nights)', { ongWeight: 0 }],
    ['no bench value (weekly-lock model)', { benchUtilization: 0 }],
    ['no projection uncertainty', { projUncertaintyWeight: 0 }],
    ['flat replacement depth', { replacementDepth: { C: 1, LW: 1, RW: 1, D: 1, G: 1 } }],
    ['baselineMode = replacement', { baselineMode: 'replacement' }],
    ['baselineMode = average', { baselineMode: 'average' }],
  ];
  for (const [label, patch] of runs) {
    const fresh = load(path);
    const c2 = buildContext(fresh, { ...DEFAULT_CONFIG, ...patch, _warnings: [] });
    const out = recommend({ available: fresh, myRoster: [], pickNum: picks[3], round: 4,
      myPickNumbers: picks }, c2);
    const t = out[0];
    console.log(`  ${label.padEnd(38)} -> ${String(t?.player.name).padEnd(20)} ${t?.player.posList.join('/').padEnd(5)} mv ${num(t?.marginalValue, 3)}`);
  }
  console.log('\n  Whichever line moves the answer most is the input to look at first.');
}

console.log('');

// ---------------------------------------------------------------------------
// 8. HEAD TO HEAD — why did the model prefer X over Y?
// ---------------------------------------------------------------------------

if (COMPARE && COMPARE.length >= 2) {
  h(`8. HEAD TO HEAD: ${COMPARE[0]} vs ${COMPARE[1]}`);
  const find = (n) => players.find((p) => p.name.toLowerCase() === n.toLowerCase())
    || players.find((p) => p.name.toLowerCase().includes(n.toLowerCase()));
  const A = find(COMPARE[0]), B = find(COMPARE[1]);
  if (!A || !B) {
    console.log(`  Could not find ${!A ? COMPARE[0] : COMPARE[1]} in the pool.`);
  } else {
    const roster = (ROSTER_ARG ? ROSTER_ARG.split(',') : [])
      .map((n) => find(n.trim())).filter(Boolean);
    console.log(`  Roster context: ${roster.length ? roster.map((p) => p.name).join(', ') : '(empty)'}`);

    const base = teamCategoryProbs(roster, ctx);
    const baseTotal = Object.values(base).reduce((s, v) => s + v, 0);

    for (const P of [A, B]) {
      const after = teamCategoryProbs([...roster, P], ctx);
      const mv = Object.values(after).reduce((s, v) => s + v, 0) - baseTotal;
      const { owner, slotPos } = assignLineup([...roster, P], DEFAULT_CONFIG);
      const slotIdx = owner.findIndex((o) => o === P);
      const slot = slotIdx >= 0 ? slotPos[slotIdx] : 'BENCH';
      console.log(`\n  ${P.name}  (${P.posList.join('/')})`);
      console.log(`    vorp ${num(P.vorp)}  raw ${num(P._raw)}  adp ${P.adp}  rank ${P.overallRank}`);
      console.log(`    lineup slot: ${slot}   start rate: ${num(startRate(P, slotIdx >= 0, ctx), 2)}`);
      console.log(`    off-night share: ${num(P._offShare, 3)} (pool ${num(ctx.meanOffShare, 3)})`);
      console.log(`    marginal value: ${num(mv, 4)}`);
      const stats = DEFAULT_CONFIG.categories
        .filter((c) => c.pop === (P._goalie ? 'goalie' : 'skater'))
        .map((c) => `${c.key}=${P[c.key] ?? '—'}`).join('  ');
      console.log(`    projections: ${stats}`);
      console.log('    category deltas:');
      Object.keys(after).sort((x, y) => (after[y] - base[y]) - (after[x] - base[x]))
        .filter((k) => Math.abs(after[k] - base[k]) > 0.0005)
        .forEach((k) => console.log(`      ${k.padEnd(10)} ${(after[k] - base[k] >= 0 ? '+' : '')}${num((after[k] - base[k]) * 100, 1)}pp`));
    }

    console.log('\n  Reading it: if the preferred player fills a LINEUP SLOT and the other');
    console.log('  reads BENCH, the gap is roster fit and the model is right. If both start');
    console.log('  and the projections favour the one that lost, look at the deltas — the');
    console.log('  model is weighting a category you are already strong or weak in.');
  }
}

// ---------------------------------------------------------------------------
// 9. INVARIANT: roster headcount must be constant
// ---------------------------------------------------------------------------

if (!COMPARE) {
  h('9. HEADCOUNT INVARIANT');
  // Fill C outright so the next C can only land on the bench — that is the
  // case the invariant is actually about.
  const cs = players.filter((p) => p.posList.length === 1 && p.posList[0] === 'C')
    .sort((a, b) => b._raw - a._raw);
  const ds = players.filter((p) => p.posList.includes('D')).sort((a, b) => b._raw - a._raw);
  const roster = cs.slice(0, DEFAULT_CONFIG.slots.C);
  const starter = ds[0];
  const benchy = cs[DEFAULT_CONFIG.slots.C];
  console.log(`  Roster: ${roster.map((p) => p.name).join(', ')} (C slots now full)`);
  const v0 = teamCategoryProbs(roster, ctx);
  const t0 = Object.values(v0).reduce((a, b) => a + b, 0);
  for (const P of [starter, benchy].filter(Boolean)) {
    const v = teamCategoryProbs([...roster, P], ctx);
    const t = Object.values(v).reduce((a, b) => a + b, 0);
    const { owner } = assignLineup([...roster, P], DEFAULT_CONFIG);
    const slot = owner.includes(P) ? 'STARTS' : 'BENCH';
    console.log(`  ${String(P.name).padEnd(22)} ${P.posList.join('/').padEnd(6)} ${slot.padEnd(7)} mv ${num(t - t0, 4)}`);
  }
  console.log('\n  Both rosters are padded to the same size, so a bench addition can no');
  console.log('  longer beat a starter purely by adding a body. If a bench-only player');
  console.log('  still outscores an equivalent starter, something else is wrong.');
}

// ---------------------------------------------------------------------------
// 10. TARGETS vs POOL — do your season targets agree with the player pool?
// ---------------------------------------------------------------------------

if (!COMPARE) {
  h('10. SEASON TARGETS vs POOL-DERIVED OPPONENT');
  if (!DEFAULT_CONFIG.seasonTargets) {
    console.log('  No seasonTargets set in config. Add them to calibrate the opponent:');
    console.log('    seasonTargets: { g: 300, a: 340, p: 640, ppp: 180, shots: 2300, blocks: 900 }');
    console.log('  Targets do not enter the score — they replace the model\'s guess at what');
    console.log('  a typical opposing team produces, which is the one number it invents.');
  } else {
    const bare = buildContext(load(path), { ...DEFAULT_CONFIG, targetBlend: 0, _warnings: [] });
    console.log('  category     pool/season   your target   ratio');
    for (const [k, v] of Object.entries(DEFAULT_CONFIG.seasonTargets)) {
      const pool = bare.opponent.mean[k];
      if (pool == null || v == null) continue;
      const poolSeason = pool * DEFAULT_CONFIG.weeks;
      const ratio = v / (poolSeason || 1);
      const flag = (ratio > 1.35 || ratio < 0.75) ? '  <-- big disagreement' : '';
      console.log(`  ${k.padEnd(12)} ${num(poolSeason, 0).padStart(9)}   ${String(v).padStart(11)}   ${num(ratio, 2)}${flag}`);
    }
    console.log('\n  Ratio near 1.1 is healthy — a winning total should sit a little above');
    console.log('  the average team. A ratio far from that means one of the two is wrong:');
    console.log('  either the target is not achievable by any real roster, or your');
    console.log('  projections are systematically off in that category. Check the target');
    console.log('  against a realistic 12-man roster before trusting it.');
  }
}
