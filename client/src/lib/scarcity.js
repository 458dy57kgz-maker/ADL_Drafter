// Colors the "{n} left" scarcity pill (Best Available card headers, Position
// Scarcity list). Thresholds and colors ported 1:1 from the design source.

export function scarcityStyle(left) {
  if (left <= 3) {
    return { bg: '#3a2020', fg: '#e8837a', border: '#4a2020' };
  }
  if (left <= 7) {
    return { bg: '#3a2f18', fg: '#f2c34d', border: '#4a3a22' };
  }
  return { bg: '#12241a', fg: '#7fd9a3', border: '#2a4a35' };
}
