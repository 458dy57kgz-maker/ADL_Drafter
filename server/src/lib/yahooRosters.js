// Reads Yahoo's "Starting Rosters" page (hockey.fantasysports.yahoo.com/
// hockey/<league>/startingrosters), saved from the browser as HTML, into one
// row per roster seat for every team in the league. It stands in for the
// Yahoo API until that works: the page is the one view that shows all ten
// rosters at once, IR and IR+ included.
//
// Pure string work, no DOM, so it runs on the server and in tests. It keys
// off the handful of hooks Yahoo's own tests use (`Tst-team-N` table ids,
// `data-ys-playerid`) rather than layout classes, which change more often.

// Every roster seat Yahoo can print, in the order a roster reads: the
// starting lineup, then the bench, then the injury and not-active lists.
export const SEASON_SLOTS = ['C', 'LW', 'RW', 'D', 'G', 'Util', 'BN', 'IR', 'IR+', 'NA'];
// Seats whose stats don't count for the team: injured reserve and players
// Yahoo lists as not active.
export const INACTIVE_SLOTS = ['IR', 'IR+', 'NA'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function stripTags(text) {
  return decodeEntities(String(text ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// "TB - LW,RW" -> { nhlTeam: 'TB', pos: 'LW,RW' }
function splitTeamPos(text) {
  const m = /^(.*?)\s+-\s+(.*)$/.exec(stripTags(text));
  return m ? { nhlTeam: m[1].trim() || null, pos: m[2].trim() || null } : { nhlTeam: null, pos: null };
}

function parseRow(rowHtml) {
  const slotMatch = /<td[^>]*class="pos[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
  if (!slotMatch) return null; // the header row
  const slot = stripTags(slotMatch[1]);
  if (!slot) return null;

  // The name link is the first element carrying the player id; the headshot
  // before it has only an alt. An empty seat has neither.
  const nameMatch = /<a\b[^>]*data-ys-playerid="(\d+)"[^>]*>([\s\S]*?)<\/a>/.exec(rowHtml);
  if (!nameMatch) return { slot, player: null };

  const teamPosMatch = /<span class="Fz-xxs">([\s\S]*?)<\/span>/.exec(rowHtml);
  const statusMatch = /class="[^"]*ysf-player-status[^"]*"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/.exec(rowHtml);
  const { nhlTeam, pos } = splitTeamPos(teamPosMatch?.[1] ?? '');

  return {
    slot,
    player: {
      yahooId: nameMatch[1],
      name: stripTags(nameMatch[2]),
      nhlTeam,
      pos,
      // IR, O, DTD… — Yahoo's own injury tag beside the name, when it has one.
      status: statusMatch ? stripTags(statusMatch[1]) || null : null,
    },
  };
}

/**
 * Parse the saved page. Returns
 *   { leagueId, rosterDate, teams: [{ num, name, rows: [{ slot, player }] }] }
 * where `player` is null for an empty seat. Throws if the page has no roster
 * tables at all, which almost always means the wrong page was saved.
 */
export function parseStartingRosters(html) {
  const text = String(html ?? '');
  const tableRe = /<table\b[^>]*\bid="Tst-team-(\d+)"[^>]*>([\s\S]*?)<\/table>/g;
  const teams = [];
  let leagueId = null;
  let lastEnd = 0;

  for (let m = tableRe.exec(text); m; m = tableRe.exec(text)) {
    const num = Number(m[1]);
    // The team's name is the link to its page just above its table:
    // <a href="/hockey/18292/4">Duderinos</a>. The last such link between the
    // previous table and this one is the heading.
    const between = text.slice(lastEnd, m.index);
    const headingRe = new RegExp(`href="/hockey/(\\d+)/${num}"[^>]*>([\\s\\S]*?)</a>`, 'g');
    let heading = null;
    for (let h = headingRe.exec(between); h; h = headingRe.exec(between)) heading = h;
    if (heading) leagueId = leagueId ?? heading[1];

    const rows = m[2]
      .split(/<tr\b/)
      .slice(1)
      .map(parseRow)
      .filter(Boolean);

    teams.push({ num, name: heading ? stripTags(heading[2]) : `Team ${num}`, rows });
    lastEnd = m.index + m[0].length;
  }

  if (!teams.length) {
    throw new Error('No team rosters found — save the Starting Rosters page itself (League > Starting Rosters), not another Yahoo page.');
  }

  // The date the page shows rosters for: the selected tab of its date bar.
  const dateMatch = /startingrosters\?date=(\d{4}-\d{2}-\d{2})"[^>]*title="Current Date"/.exec(text);

  return { leagueId, rosterDate: dateMatch ? dateMatch[1] : null, teams };
}
