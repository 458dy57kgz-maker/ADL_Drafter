import { useState } from 'react';
import { api } from '../../lib/api.js';
import { usePolling } from '../../lib/usePolling.js';
import { useLivePickFeed } from '../../lib/useLivePickFeed.jsx';
import './LivePicks.css';

function timeAgo(ts) {
  if (!ts) return 'never';
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

// The bookmarklet is a loader, not the tracker itself: it fetches tracker.js
// from this app. That way the tracker can be fixed and redeployed without
// anyone rebuilding a bookmark, and the app's own address is baked in here
// rather than typed by hand.
function bookmarkletFor(origin) {
  return `javascript:(function(){var s=document.createElement('script');s.src='${origin}/tracker.js?'+Date.now();document.body.appendChild(s);})();`;
}

function OrderSeats({ inferred }) {
  return (
    <div className="live-feed__order">
      {inferred.teams.map((t) => (
        <div className={`live-feed__seat${t.slot === inferred.myTeamSlot ? ' live-feed__seat--mine' : ''}`} key={t.slot}>
          <span className="mono live-feed__seat-num">{t.slot}</span>
          <span className="live-feed__seat-name">{t.name}</span>
          {t.slot === inferred.myTeamSlot && <span className="live-feed__seat-you">YOU</span>}
        </div>
      ))}
    </div>
  );
}

export default function LivePicks() {
  const feed = useLivePickFeed();
  const { data: draftState, refetch } = usePolling(api.getDraftState, 5, []);
  const [copied, setCopied] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState(null);

  const origin = window.location.origin;
  const secure = window.isSecureContext;
  const bookmarklet = bookmarkletFor(origin);

  // Tailscale Serve terminates TLS on 443 and proxies to the app's own port
  // internally, so the HTTPS address is the bare hostname — keeping the port
  // on it asks for TLS from something that only speaks plain HTTP, and looks
  // like the name failing to resolve.
  const tailscaleHttps =
    !secure && /\.ts\.net$/i.test(window.location.hostname) ? `https://${window.location.hostname}` : null;

  const push = draftState?.feed ?? null;
  const pushIsLive = push && Date.now() - push.at < 120000;

  async function copyBookmarklet() {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  // Works for both transports: the server keeps the last picks it was sent,
  // so this needs nothing from the page but the click.
  async function applyServerOrder() {
    setOrderBusy(true);
    setOrderError(null);
    try {
      await api.feedApplyOrder();
      refetch();
    } catch (err) {
      setOrderError(err.message);
    } finally {
      setOrderBusy(false);
    }
  }

  return (
    <div className="live-feed">
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Live Pick Feed
      </div>

      {/* --- Push from the draft room ------------------------------------ */}
      <div className="card">
        <div className="card-title">Push picks from the Yahoo draft room</div>
        <div className="card-subtitle">
          One bookmarklet, run once inside the draft room. It reads the pick list as Yahoo announces it and sends
          every pick straight here — no file, no permissions, nothing to re-arm when a page reloads.
        </div>

        <div className="live-feed__status">
          <span className={`status-dot${pushIsLive && !push?.blocked ? '' : ' status-dot--off'}`} />
          <div className="live-feed__status-text">
            <div className="live-feed__status-line">
              {!push
                ? 'Nothing has pushed yet'
                : push.blocked
                  ? 'A tracker is pushing, but the picks can’t be filed yet'
                  : pushIsLive
                    ? `Receiving picks · through pick ${push.lastPick}`
                    : `Last push ${timeAgo(push.at)} · through pick ${push.lastPick}`}
            </div>
            <div className="live-feed__sub">
              {!push
                ? 'Install the bookmarklet below, then click it once with the draft room open.'
                : push.blocked
                  ? `${push.blocked} — ${push.received} picks are waiting.`
                  : `${push.picks} picks recorded${push.unmatched ? ` · ${push.unmatched} name${push.unmatched === 1 ? '' : 's'} unmatched` : ''} · last heard ${timeAgo(push.at)}`}
            </div>
          </div>
        </div>

        {push?.blocked && push.inferred && (
          <>
            <div className="live-feed__order-note">
              The picks themselves say what the draft order is — every manager lands on exactly one seat across{' '}
              {push.inferred.roundsSeen} {push.inferred.roundsSeen === 1 ? 'round' : 'rounds'}:
            </div>
            <OrderSeats inferred={push.inferred} />
            <button type="button" className="btn btn-primary" onClick={applyServerOrder} disabled={orderBusy}>
              Use this order ({push.inferred.teamCount} teams)
            </button>
            {orderError && <div className="live-feed__error">{orderError}</div>}
          </>
        )}

        {push?.blocked && !push.inferred && (
          <div className="live-feed__warn">
            Not enough picks yet to work the order out — every manager has to have picked at least once. Set it by
            hand in Settings → League, or wait for the first round to finish.
          </div>
        )}

        <div className="live-feed__install">
          <div className="live-feed__install-title">Install it</div>
          <ol className="live-feed__steps">
            <li>Copy the line below.</li>
            <li>
              In Chrome, right-click the bookmarks bar → <strong>Add page</strong>, name it{' '}
              <em>ADL Draft Tracker</em>, and paste this as the URL. (Dragging a link won’t work — browsers refuse
              to make a bookmark out of a <span className="mono">javascript:</span> link.)
            </li>
            <li>Open your Yahoo draft room and click the bookmark once. A small panel appears bottom-right.</li>
          </ol>
          <div className="live-feed__code mono">{bookmarklet}</div>
          <button type="button" className="btn btn-primary" onClick={copyBookmarklet}>
            {copied ? 'Copied' : 'Copy bookmarklet'}
          </button>
          <div className="live-feed__sub" style={{ marginTop: 10 }}>
            It points at <span className="mono">{origin}</span> — the address you’re reading this page on. Use the
            address the drafting laptop can reach; the tracker sends picks there from inside the draft room.
          </div>
          {!secure && (
            <div className="live-feed__warn">
              This page is served over <span className="mono">{origin}</span>, which isn’t a secure origin. Yahoo’s
              draft room is HTTPS, and a browser will not let an HTTPS page load or call an unencrypted one — so a
              bookmarklet copied from here won’t reach the app.
              {tailscaleHttps ? (
                <>
                  {' '}
                  Open <span className="mono">{tailscaleHttps}</span> instead — no port number: Tailscale Serve
                  handles HTTPS on 443 and forwards to the app internally, so putting the app’s own port back on the
                  address is what makes it look like the name doesn’t resolve. Then copy the bookmarklet again from
                  that page, since it points at whichever address you copied it from.
                </>
              ) : (
                ' Open the app on its HTTPS address instead, then copy the bookmarklet again from there — it points at whichever address you copied it from.'
              )}
            </div>
          )}
        </div>
      </div>

      {/* --- Read a file (secondary) -------------------------------------- */}
      <div className="card live-feed__block">
        <div className="card-title">Or read the tracker’s exported file</div>
        <div className="card-subtitle">
          If you’d rather have the tracker write a file and have the app read it, point this at that file. It’s the
          older path and needs re-granting permission every time this page reloads — the bookmarklet above is
          simpler.
        </div>

        {!feed.supported ? (
          <div className="live-feed__warn">
            {secure
              ? 'This browser has no File System Access API — that’s Chrome and Edge only, never Safari or Firefox. Use the bookmarklet above, or Manual Draft Mode (Shift+S).'
              : `Unavailable because this page isn’t on a secure origin (${origin}). Browsers only expose file access over HTTPS or localhost. Chrome and Edge support it; Safari and Firefox never do.`}
          </div>
        ) : (
          <>
            <div className="live-feed__status">
              <span className={`status-dot${feed.connected ? '' : ' status-dot--off'}`} />
              <div className="live-feed__status-text">
                <div className="live-feed__status-line">
                  {feed.connected ? 'Watching' : feed.hasHandle ? 'Paused — needs permission again' : 'Not connected'}
                  {feed.fileName && <span className="live-feed__file mono"> · {feed.fileName}</span>}
                </div>
                {feed.connected && (
                  <div className="live-feed__sub">
                    Last read {timeAgo(feed.lastSyncAt)}
                    {feed.report ? ` · ${feed.report.picks} picks in the draft` : ''}
                  </div>
                )}
              </div>
              <div className="live-feed__actions">
                <button type="button" className="btn" onClick={feed.connect} disabled={feed.busy}>
                  {feed.hasHandle ? (feed.connected ? 'Change file' : 'Reconnect') : 'Choose file'}
                </button>
                {feed.hasHandle && (
                  <button type="button" className="btn btn-sm" onClick={feed.disconnect} disabled={feed.busy}>
                    Forget
                  </button>
                )}
              </div>
            </div>
            {feed.error && <div className="live-feed__error">{feed.error}</div>}
            {feed.orderIssue?.inferred && (
              <>
                <div className="live-feed__order-note">Draft order recovered from that file:</div>
                <OrderSeats inferred={feed.orderIssue.inferred} />
                <button type="button" className="btn btn-primary" onClick={feed.applyOrder} disabled={feed.busy}>
                  Use this order ({feed.orderIssue.inferred.teamCount} teams)
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* --- What came through -------------------------------------------- */}
      {feed.report && (feed.report.unmatched.length > 0 || feed.report.gapBefore > 0) && (
        <div className="card live-feed__block">
          <div className="card-title">Names and gaps</div>

          {feed.report.gapBefore > 0 && (
            <div className="live-feed__warn">
              The feed starts at pick {feed.report.gapBefore + 1}, so picks 1–{feed.report.gapBefore} aren’t in it.
              Those slots are held open as blanks to keep the pick numbering honest — the players taken in them are
              still in the pool. Enter them with Manual Draft Mode if you want them counted.
            </div>
          )}

          {feed.report.unmatched.length > 0 && (
            <>
              <div className="live-feed__order-note">
                These picks were recorded, but no player in your list matched the name — so nobody was marked drafted
                for them. Add an alias in Settings → Rankings Import to teach the match.
              </div>
              <div className="live-feed__unmatched">
                {feed.report.unmatched.map((u) => (
                  <div className="live-feed__unmatched-row" key={u.pick}>
                    <span className="mono live-feed__unmatched-pick">#{u.pick}</span>
                    <span className="live-feed__unmatched-name">{u.name}</span>
                    <span className="mono live-feed__unmatched-meta">
                      {u.position ?? '—'} · {u.nhlTeam ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
