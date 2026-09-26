// Draft Urgency Row — which targets the row shows, and the stretch of picks
// the carousel under it runs across. Both are pure functions of the draft
// state so they can be reasoned about (and tested) without a database.

import { slotForPick } from './draftMath.js';

// Cards the row draws. The server sends more than this so the client can drop
// the ones dismissed by hand and refill from the right without waiting for
// the next poll.
export const URGENCY_CARDS = 10;
export const URGENCY_CANDIDATES = 24;
// A player taken by someone else stays up this many picks, long enough to
// read where he went against his ADP and my rank, then clears himself off.
export const URGENCY_LINGER = 5;
// Eleven cells: the track starts one cell back so a new pick can be rendered
// from the previous one and slid into place.
export const SLATE_BEFORE = 1;
export const SLATE_AFTER = 9;

// The next targets by my own ranking, each one counting down to the two pick
// numbers that matter: where I rate him (ME) and where the field takes him
// (AV). `players` must already be in my rank order.
export function selectUrgencyCards({ players, currentPick, teamCount, pickByPlayerId = new Map(), limit = URGENCY_CANDIDATES }) {
  const cards = [];
  for (const p of players) {
    if (cards.length >= limit) break;
    // The row is my target list in my own order, so a player I never ranked
    // has no place on it — there's no ME number to count down to.
    if (p.overallRank == null) continue;

    const draftedAt = pickByPlayerId.get(p.id) ?? null;
    if (p.drafted) {
      if (draftedAt == null || currentPick >= draftedAt + URGENCY_LINGER) continue;
    } else if (Math.max(p.overallRank, p.adp ?? p.overallRank) - currentPick <= -teamCount) {
      // Undrafted and more than a full round past both numbers: the countdown
      // has nothing left to say about him, and he'd hold a card the next
      // target should have.
      continue;
    }

    cards.push({
      id: p.id,
      name: p.name,
      pos: p.pos,
      flag: p.flag ?? null,
      myRank: p.overallRank,
      adp: p.adp,
      draftedAt,
      draftedBy: p.drafted ? p.draftedBy : null,
    });
  }
  return cards;
}

// The carousel's eleven seats, from the pick before the clock through nine
// ahead. Picks outside the draft render as empty cells.
export function buildSlate({ currentPick, teamCount, myDraftSlot, totalPicks = 0, teamAtPick }) {
  const slate = [];
  for (let pk = currentPick - SLATE_BEFORE; pk <= currentPick + SLATE_AFTER; pk++) {
    const live = pk >= 1 && (!totalPicks || pk <= totalPicks);
    slate.push({
      pickNum: pk,
      team: live ? teamAtPick(pk) : null,
      isMine: live && slotForPick(pk, teamCount) === myDraftSlot,
    });
  }
  return slate;
}
