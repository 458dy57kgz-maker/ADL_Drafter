// Deterministic mock player generator, ported from the design handoff's
// buildPlayers() so the app has realistic-looking data to develop against
// before real Yahoo integration is wired up. Used only to seed a fresh DB.

const FIRST = [
  'Ethan', 'Marcus', 'Jalen', 'Wyatt', 'Devon', 'Silas', 'Rory', 'Theo', 'Owen', 'Callum',
  'Dario', 'Nash', 'Milo', 'Kai', 'Bram', 'Reid', 'Soren', 'Emmett', 'Julian', 'Adrian',
];
const LAST = [
  'Cole', 'Byrne', 'Ortiz', 'Sun', 'Kwan', 'Nakamura', 'Delgado', 'Franks', 'Vasquez', 'Reyes',
  'Wexler', 'Petrov', 'Andersson', 'Fontaine', 'Solberg', 'Hastings', 'Marchetti', 'Kariya', 'Dubois', 'Whitfield',
];
const NHL_TEAMS = ['TOR', 'EDM', 'COL', 'BOS', 'VAN', 'NYR', 'DAL', 'CAR', 'MIN', 'SEA'];
const FANTASY_TEAMS = [
  'Ice Breakers', 'Puck Norris', 'Slapshot Sallies', 'Zamboni Drivers', 'Blue Line Bandits',
  'Power Play Pirates', 'Fourth Liners', 'Hat Trick Heroes', 'Offside Outlaws', 'Neutral Zone Ninjas',
];

function seeded(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const POS_VALUE_FACTOR = { C: 1.0, LW: 1.05, RW: 1.05, D: 1.35, G: 1.5 };
const DRAFT_THRESHOLD = 47;
const MIN_UNDRAFTED_PER_POS = 5;

export function buildMockPlayers() {
  const posList = [['C', 12], ['LW', 12], ['RW', 12], ['D', 16], ['G', 10]];
  const players = [];
  let id = 1;
  posList.forEach(([pos, count]) => {
    for (let i = 0; i < count; i++) {
      const rank = i + 1;
      const name = `${FIRST[(id * 3) % FIRST.length]} ${LAST[(id * 7) % LAST.length]}`;
      const team = NHL_TEAMS[id % NHL_TEAMS.length];
      const tier = Math.ceil(rank / 4);
      const adp = Math.max(1, rank + Math.round(seeded(id) * 4 - 2));
      const obj = { id, name, pos, team, rank, adp, tier };
      if (pos === 'G') {
        obj.w = Math.max(2, Math.round(34 - rank * 2.4));
        obj.gaa = Number((1.85 + rank * 0.065).toFixed(2));
        obj.saves = Math.max(80, Math.round(1350 - rank * 45));
        obj.g = null;
        obj.a = null;
        obj.p = null;
        obj.ppp = null;
        obj.plusMinus = null;
        obj.shots = null;
      } else {
        obj.g = Math.max(2, Math.round(34 - rank * 1.7));
        obj.a = Math.max(3, Math.round(38 - rank * 1.4));
        obj.p = obj.g + obj.a;
        obj.ppp = Math.max(0, Math.round(12 - rank * 0.6));
        obj.plusMinus = Math.round(18 - rank * 1.1);
        obj.shots = Math.max(60, Math.round(190 - rank * 7));
        obj.w = null;
        obj.gaa = null;
        obj.saves = null;
      }
      obj.drafted = false;
      obj.draftedBy = null;
      obj.mine = false;
      obj.tracked = false;
      players.push(obj);
      id++;
    }
  });

  // Blend per-position ranks into one global draft order so it can be
  // compared against real pick numbers (position ranks alone top out at
  // 12-16, never approaching pick 47+).
  players
    .slice()
    .sort((a, b) => a.rank * POS_VALUE_FACTOR[a.pos] - b.rank * POS_VALUE_FACTOR[b.pos])
    .forEach((p, i) => {
      p.overallRank = i + 1;
    });

  // Drafted status keyed off overall rank vs. where the mock draft currently
  // sits, with noise so the board isn't a clean cutoff.
  players.forEach((p) => {
    const noise = seeded(p.id * 13);
    let draftedChance;
    if (p.overallRank <= DRAFT_THRESHOLD - 5) draftedChance = 0.88;
    else if (p.overallRank <= DRAFT_THRESHOLD + 15) draftedChance = 0.45;
    else draftedChance = 0.15;
    p.drafted = noise < draftedChance;
    p.draftedBy = p.drafted ? FANTASY_TEAMS[p.id % FANTASY_TEAMS.length] : null;
  });

  const myC = players.find((p) => p.pos === 'C');
  myC.mine = true;
  myC.drafted = true;
  myC.draftedBy = 'You';
  myC.g = 18; myC.a = 22; myC.p = 40; myC.ppp = 8; myC.plusMinus = 6; myC.shots = 140;

  const myLW = players.find((p) => p.pos === 'LW');
  myLW.mine = true;
  myLW.drafted = true;
  myLW.draftedBy = 'You';
  myLW.g = 25; myLW.a = 15; myLW.p = 40; myLW.ppp = 10; myLW.plusMinus = 9; myLW.shots = 180;

  // Guarantee a minimum bench of undrafted players per lane so Best
  // Available never goes blank, even if the noise roll drafts everyone.
  ['C', 'LW', 'RW', 'D', 'G'].forEach((pos) => {
    const posPlayers = players.filter((p) => p.pos === pos);
    const undrafted = posPlayers.filter((p) => !p.drafted);
    if (undrafted.length < MIN_UNDRAFTED_PER_POS) {
      const need = MIN_UNDRAFTED_PER_POS - undrafted.length;
      const flipCandidates = posPlayers
        .filter((p) => p.drafted && !p.mine)
        .sort((a, b) => b.overallRank - a.overallRank);
      for (let i = 0; i < need && i < flipCandidates.length; i++) {
        flipCandidates[i].drafted = false;
        flipCandidates[i].draftedBy = null;
      }
    }
  });

  const trackRW = players.find((p) => p.pos === 'RW' && !p.drafted);
  if (trackRW) trackRW.tracked = true;
  const trackTakenC = players.find((p) => p.pos === 'C' && p.drafted && !p.mine);
  if (trackTakenC) trackTakenC.tracked = true;

  return players;
}
