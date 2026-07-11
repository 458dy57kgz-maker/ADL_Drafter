// Snake-draft slot math. Pick numbers are 1-indexed across the whole draft.
// Round 1 goes slot 1..teamCount, round 2 reverses (teamCount..1), etc.

export function round(pickNum, teamCount) {
  return Math.floor((pickNum - 1) / teamCount) + 1;
}

export function slotForPick(pickNum, teamCount) {
  const r = round(pickNum, teamCount);
  const posInRound = pickNum - (r - 1) * teamCount; // 1-indexed
  return r % 2 === 1 ? posInRound : teamCount - posInRound + 1;
}

// First pick number >= fromPick where the given team slot is on the clock.
export function nextPickForSlot(fromPick, teamCount, mySlot) {
  for (let pick = fromPick; pick < fromPick + teamCount * 2; pick++) {
    if (slotForPick(pick, teamCount) === mySlot) return pick;
  }
  return fromPick;
}
