import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeason } from '../src/lib/season.js';
import { normalizePosList } from '../src/lib/mapPlayer.js';
import {
  buildTradeModel,
  evaluateTrade,
  sellList,
  scanTrades,
  targetTrades,
  luckScore,
  lineup,
  startingSlots,
} from '../src/lib/trade.js';

// A three-team league. Mine (1) is deep at centre and short of blocks; team
// 2 is deep on defence and holds a blocks-heavy defenceman the market
// shrugs at; team 3 is filler so the category ranks mean something.
let nextId = 0;
function player(name, pos, proj, extra = {}) {
  nextId += 1;
  return { id: nextId, name, pos, posList: normalizePosList(pos), team: 'X', flag: null, overallRank: nextId, mine: false, ...proj, ...extra };
}
const skater = (g, a, ppp, shots, blocks) => ({ gp: 82, g, a, p: g + a, ppp, shots, blocks });
const goalie = (w, saves, gaa) => ({ gp: 55, w, saves, gaa, g: null, a: null, p: null });

// `started` gives everyone eight games at exactly their projected pace;
// `hot` then names one player who has run well ahead of it.
function league({ started = false, hot = null } = {}) {
  nextId = 0;
  const lucky = { shsv: 1050, lyShPct: 16, cShPct: 10, lyIpp: 80, cIpp: 70 };
  const unlucky = { shsv: 975, lyShPct: 7, cShPct: 10, lyIpp: 55, cIpp: 65 };
  const rosters = {
    1: [
      ['C', player('Hot Shot', 'C', skater(22, 22, 10, 180, 20), { adp: 5, ...lucky })],
      ['C', player('Steady Eddie', 'C', skater(28, 38, 22, 230, 30), { adp: 45 })],
      ['D', player('Soft D', 'D', skater(8, 30, 12, 150, 60), { adp: 70 })],
      ['D', player('Softer D', 'D', skater(6, 25, 8, 120, 55), { adp: 110 })],
      ['G', player('My Goalie', 'G', goalie(30, 1500, 2.7), { adp: 60 })],
      ['BN', player('Extra C', 'C', skater(18, 22, 8, 160, 25), { adp: 90 })],
    ],
    2: [
      ['C', player('Their C', 'C', skater(26, 34, 18, 210, 30), { adp: 30 })],
      ['C', player('Their C Two', 'C', skater(20, 25, 10, 170, 25), { adp: 100 })],
      ['D', player('Buy Low D', 'D', skater(12, 40, 18, 190, 160), { adp: 150, ...unlucky })],
      ['D', player('Their D', 'D', skater(10, 30, 10, 150, 120), { adp: 95 })],
      ['G', player('Their Goalie', 'G', goalie(32, 1600, 2.5), { adp: 40 })],
      ['BN', player('Depth D', 'D', skater(5, 20, 3, 110, 130), { adp: 160 })],
    ],
    3: [
      ['C', player('Filler C', 'C', skater(22, 30, 14, 190, 30), { adp: 50 })],
      ['C', player('Filler C Two', 'C', skater(21, 28, 12, 180, 28), { adp: 65 })],
      ['D', player('Filler D', 'D', skater(9, 28, 9, 140, 110), { adp: 85 })],
      ['D', player('Filler D Two', 'D', skater(7, 22, 6, 130, 115), { adp: 120 })],
      ['G', player('Filler Goalie', 'G', goalie(28, 1450, 2.8), { adp: 75 })],
      ['BN', player('Filler Bench', 'LW', skater(15, 15, 5, 140, 30), { adp: 140 })],
    ],
  };
  const pool = [];
  const rosterRows = [];
  let rowId = 0;
  for (const [num, seats] of Object.entries(rosters)) {
    seats.forEach(([slot, p], seat) => {
      pool.push(p);
      rowId += 1;
      rosterRows.push({ id: rowId, team_num: Number(num), team_name: `T${num}`, seat, slot, player_id: p.id, yahoo_player_id: String(rowId), player_name: p.name, nhl_team: 'X', pos: p.pos, status: null });
    });
  }
  // Profile fields ride on the pool player, as mapPlayerRow puts them there.
  const statsRows = !started
    ? []
    : pool.map((p, i) => {
        const pace = (v) => (v == null ? null : Math.round((v * 8) / p.gp));
        const heat = p.name === hot ? 1.6 : 1;
        const line = { id: i + 1, player_id: p.id, name: p.name, gp: 8 };
        if (p.posList.includes('G')) return { ...line, w: pace(p.w), saves: pace(p.saves), gaa: p.gaa };
        return { ...line, g: Math.round(pace(p.g) * heat), a: Math.round(pace(p.a) * heat), p: Math.round(pace(p.p) * heat), ppp: Math.round(pace(p.ppp) * heat), shots: Math.round(pace(p.shots) * heat), blocks: pace(p.blocks) };
      });
  const teamNames = new Map([[1, 'Mine'], [2, 'Deep D'], [3, 'Filler']]);
  return buildSeason({ pool, rosterRows, statsRows, teamNames, myTeamNum: 1 });
}

const keyOf = (model, name) => [...model.players.values()].find((p) => p.name === name).key;

test('luck reads above 0 for a lucky season, below for an unlucky one', () => {
  assert.ok(luckScore({ shsv: 1050, lyShPct: 16, cShPct: 10 }) > 0);
  assert.ok(luckScore({ shsv: 975, lyShPct: 7, cShPct: 10 }) < 0);
  assert.equal(luckScore({ shsv: 1300 }), 1, 'capped at 1');
  assert.equal(luckScore(null), null);
  assert.equal(luckScore({ yown: 100 }), null, 'nothing about luck to go on');
});

test('the market overrates a high-ADP lucky scorer and underrates a low-ADP defenceman', () => {
  const model = buildTradeModel(league());
  const hot = model.players.get(keyOf(model, 'Hot Shot'));
  const buyLow = model.players.get(keyOf(model, 'Buy Low D'));
  assert.ok(hot.gap > 0, `Hot Shot gap ${hot.gap}`);
  assert.ok(buyLow.gap < 0, `Buy Low D gap ${buyLow.gap}`);
});

test('luck shades my value; the luck weight turns it off', () => {
  const shaded = buildTradeModel(league()).players;
  const plain = buildTradeModel(league(), { luck: 0 }).players;
  const hot = (players) => [...players.values()].find((p) => p.name === 'Hot Shot');
  assert.ok(hot(shaded).line.g < hot(plain).line.g);
});

test('a hot start raises the market faster than my value, so the gap widens', () => {
  const calm = buildTradeModel(league({ started: true }));
  const hot = buildTradeModel(league({ started: true, hot: 'Extra C' }));
  const gapOf = (m) => m.players.get(keyOf(m, 'Extra C')).gap;
  assert.ok(gapOf(hot) > gapOf(calm), `${gapOf(hot)} vs ${gapOf(calm)}`);
});

test('starting slots come from the rosters, and the best players start', () => {
  const season = league();
  assert.deepEqual(startingSlots(season.teams), { C: 2, D: 2, G: 1 });
  const ps = [
    { key: 'a', posList: ['C', 'LW'], v: 5 },
    { key: 'b', posList: ['C'], v: 4 },
    { key: 'c', posList: ['C'], v: 3 },
    { key: 'd', posList: ['D'], v: 1 },
  ];
  const { starters, bench } = lineup(ps, { C: 1, LW: 1, Util: 1, D: 1 }, (p) => p.v);
  // a takes C (his first open seat), b can only play C so takes Util, and
  // c is left for the bench.
  assert.deepEqual(starters.map((p) => p.key), ['a', 'b', 'd']);
  assert.deepEqual(bench.map((p) => p.key), ['c']);
});

test('my sell list leads with the overrated player at my deep position', () => {
  const model = buildTradeModel(league());
  const list = sellList(model);
  assert.equal(model.players.get(list[0].key).name, 'Hot Shot');
  assert.equal(list[0].surplus, 1, 'three centres for two seats');
  const locked = sellList(model, { locked: [list[0].key] });
  assert.ok(!locked.some((s) => s.key === list[0].key), 'a locked player is never offered');
});

test('a 2-for-1 makes the receiver drop someone, and I gain the category I lack', () => {
  const model = buildTradeModel(league());
  const trade = evaluateTrade(model, [keyOf(model, 'Hot Shot'), keyOf(model, 'Extra C')], [keyOf(model, 'Buy Low D')]);
  assert.equal(trade.them.dropped.length, 1);
  assert.equal(trade.me.dropped.length, 0);
  assert.ok(trade.me.byCat.blocks > 0, 'blocks improve');
  assert.ok(Number.isFinite(trade.accept.ratio));

  const stingy = buildTradeModel(league(), { premium: 100 });
  const again = evaluateTrade(stingy, trade.give, trade.get);
  assert.equal(again.accept.ok, false, 'no package clears a 10,000% premium');
});

test('a trade has to be between my team and one other', () => {
  const model = buildTradeModel(league());
  assert.equal(evaluateTrade(model, [keyOf(model, 'Buy Low D')], [keyOf(model, 'Filler C')]), null);
});

test('the scan only proposes trades they would take and that help me', () => {
  const model = buildTradeModel(league());
  const proposals = scanTrades(model);
  for (const t of proposals) {
    assert.ok(t.accept.ok);
    assert.ok(t.me.delta > 0);
    assert.notEqual(t.team, 1);
    assert.ok(['1-for-1', '2-for-1', '2-for-2'].includes(t.shape));
  }
});

test('targeted mode lists packages for one player, viable first, and the near misses', () => {
  const model = buildTradeModel(league());
  const { viable, closest } = targetTrades(model, keyOf(model, 'Buy Low D'));
  assert.ok(viable.length + closest.length > 0);
  for (const t of viable) assert.deepEqual(t.get.includes(keyOf(model, 'Buy Low D')), true);
  for (let i = 1; i < viable.length; i++) assert.ok(viable[i - 1].score >= viable[i].score);
});

test('a position weighted to zero is never proposed, alone or as the second piece', () => {
  const model = buildTradeModel(league(), { pos: { G: 0 } });
  const isG = (k) => model.players.get(k).posList.includes('G');
  for (const t of scanTrades(model)) assert.ok(!t.get.some(isG), t.get.map((k) => model.players.get(k).name).join(' + '));
  assert.deepEqual(targetTrades(model, keyOf(model, 'Their Goalie')), { viable: [], closest: [] });
});
