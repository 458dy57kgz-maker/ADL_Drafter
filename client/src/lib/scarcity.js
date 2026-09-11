// Colors the "{n} left" scarcity ring (Best Available card headers). Ported
// from the mockup's own two-step rule (leftFg: red at 7-or-fewer, ink
// otherwise) with a third, more urgent step added at 3-or-fewer so "almost
// gone" and "getting thin" don't share a color.

export function scarcityStyle(left) {
  if (left <= 3) {
    return { bg: 'var(--danger-bg)', fg: 'var(--danger-text)', border: 'var(--danger-border)' };
  }
  if (left <= 7) {
    return { bg: 'var(--bg-row)', fg: 'var(--text-primary)', border: 'var(--border-hairline-strong)' };
  }
  return { bg: 'var(--bg-row-alt)', fg: 'var(--text-muted)', border: 'var(--border-hairline)' };
}
