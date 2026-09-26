// Copy a player's name so it can go straight into Yahoo's own search box.
// The Clipboard API needs a secure context, which the NAS deployment has over
// Tailscale but a bare-http dev origin does not, so fall back to a hidden
// textarea + execCommand rather than failing silently on http://.
function legacyCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

export async function copyText(text) {
  // The Clipboard API can also reject on a secure origin — an unfocused
  // document is enough — so a rejection falls through to the old path rather
  // than ending the attempt.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through */
    }
  }
  return legacyCopy(text);
}
