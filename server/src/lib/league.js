// Which seat in the draft is mine.
//
// The slot is the authority, never the team name and never the id. Names are
// the user's own labels for the ten managers — they don't have to match what
// Yahoo calls those teams, and the app must not try to reconcile the two.
// Ids can also go stale or collide across a re-seat. The draft slot is
// arithmetic: it's what the snake math already runs on, and it's the one
// thing the user sets deliberately on Settings > League.
//
// `myTeamId` is kept for one purpose only: as the yes/no of whether a team
// has been marked as mine at all. Which team it is comes from the slot.

export function mySlot(league) {
  if (!league || league.myTeamId == null) return null;
  const slot = league.myTeamSlot;
  return Number.isInteger(slot) && slot >= 1 ? slot : null;
}

export function myTeamName(league) {
  const slot = mySlot(league);
  return slot ? league?.teams?.[slot - 1]?.name ?? null : null;
}
