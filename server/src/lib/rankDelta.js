// Mirrors client/src/lib/rankDelta.js exactly — kept as a separate copy since
// client and server are independent deployables (client is a static bundle,
// server is the Node process). If this drifts, keep both in sync by hand.

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function rankDeltaStyle(delta) {
  let hue;
  let bandT;

  if (delta <= 0) {
    hue = 358;
    bandT = clamp01((delta + 15) / 15);
  } else if (delta <= 10) {
    hue = 24;
    bandT = clamp01((delta - 1) / 9);
  } else if (delta <= 20) {
    hue = 46;
    bandT = clamp01((delta - 11) / 9);
  } else {
    hue = 150;
    bandT = clamp01((delta - 21) / 29);
  }

  const fgL = 58 + bandT * 20;
  const fgS = 78 - bandT * 15;
  const bgL = 15 + bandT * 5;
  const borderL = fgL - 16;

  return {
    fg: `hsl(${hue} ${fgS}% ${fgL}%)`,
    bg: `hsl(${hue} 45% ${bgL}%)`,
    border: `hsl(${hue} ${fgS}% ${borderL}%)`,
  };
}
