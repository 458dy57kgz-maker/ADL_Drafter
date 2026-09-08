import { useLivePickFeed } from '../../lib/useLivePickFeed.jsx';
import './LivePicks.css';

function timeAgo(ts) {
  if (!ts) return 'never';
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

export default function LivePicks() {
  const feed = useLivePickFeed();
  const { supported, connected, hasHandle, fileName, report, orderIssue, error, lastSyncAt, busy } = feed;

  if (!supported) {
    return (
      <div className="live-feed">
        <div className="settings-section-title" style={{ marginBottom: 16 }}>Live Pick Feed</div>
        <div className="card">
          <div className="card-subtitle">
            This browser can't read a local file as it changes. Chrome and Edge can — open the app there, or keep
            using Manual Draft Mode (Shift+S) to enter picks by hand.
          </div>
        </div>
      </div>
    );
  }

  const inferred = orderIssue?.inferred;

  return (
    <div className="live-feed">
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Live Pick Feed
      </div>
      <div className="card">
        <div className="card-subtitle">
          Point this at the JSON file your Chrome bookmarklet writes. The page re-reads it every couple of seconds
          and sends every pick to the draft — no typing, and Manual Draft Mode still works as a backup.
        </div>

        <div className="live-feed__status">
          <span className={`status-dot${connected ? '' : ' status-dot--off'}`} />
          <div className="live-feed__status-text">
            <div className="live-feed__status-line">
              {connected ? 'Watching' : hasHandle ? 'Paused — needs permission again' : 'Not connected'}
              {fileName && <span className="live-feed__file mono"> · {fileName}</span>}
            </div>
            {connected && (
              <div className="live-feed__sub">
                Last read {timeAgo(lastSyncAt)}
                {report ? ` · ${report.picks} picks in the draft` : ''}
              </div>
            )}
            {!connected && hasHandle && (
              <div className="live-feed__sub">
                Chrome forgets file permission when the page reloads. One click puts it back — it won't ask you to
                find the file again.
              </div>
            )}
          </div>
          <div className="live-feed__actions">
            <button type="button" className="btn btn-primary" onClick={feed.connect} disabled={busy}>
              {hasHandle ? (connected ? 'Change file' : 'Reconnect') : 'Choose file'}
            </button>
            {connected && (
              <button type="button" className="btn btn-sm" onClick={feed.syncNow} disabled={busy}>
                Re-read now
              </button>
            )}
            {hasHandle && (
              <button type="button" className="btn btn-sm" onClick={feed.disconnect} disabled={busy}>
                Forget
              </button>
            )}
          </div>
        </div>

        {error && <div className="live-feed__error">{error}</div>}
      </div>

      {orderIssue && (
        <div className="card live-feed__block">
          <div className="card-title">Draft order needs setting before picks can be attributed</div>
          <div className="card-subtitle">
            {orderIssue.error}. Picks are seated by slot, not by the name in the file, so the order has to be right
            before anything is recorded — otherwise every roster, target and scarcity number is quietly wrong.
          </div>

          {inferred ? (
            <>
              <div className="live-feed__order-note">
                The file already says what the order is. Every manager lands on exactly one seat across{' '}
                {inferred.roundsSeen} {inferred.roundsSeen === 1 ? 'round' : 'rounds'} of picks:
              </div>
              <div className="live-feed__order">
                {inferred.teams.map((t) => (
                  <div
                    className={`live-feed__seat${t.slot === inferred.myTeamSlot ? ' live-feed__seat--mine' : ''}`}
                    key={t.slot}
                  >
                    <span className="mono live-feed__seat-num">{t.slot}</span>
                    <span className="live-feed__seat-name">{t.name}</span>
                    {t.slot === inferred.myTeamSlot && <span className="live-feed__seat-you">YOU</span>}
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-primary" onClick={feed.applyOrder} disabled={busy}>
                Use this order ({inferred.teamCount} teams)
              </button>
              {!inferred.myTeamSlot && (
                <div className="live-feed__warn">
                  No seat is labelled "You" in the file, so this won't set which team is yours — pick it in Settings
                  → League after applying.
                </div>
              )}
            </>
          ) : (
            <div className="live-feed__warn">
              Not enough picks in the file yet to work the order out — every manager has to have picked at least
              once. Set the order by hand in Settings → League, or wait for the first round to finish.
            </div>
          )}
        </div>
      )}

      {report && (
        <div className="card live-feed__block">
          <div className="card-title">Last sync</div>
          <div className="live-feed__stats">
            <div className="live-feed__stat">
              <div className="live-feed__stat-num mono">{report.picks}</div>
              <div className="live-feed__stat-label">picks recorded</div>
            </div>
            <div className="live-feed__stat">
              <div className="live-feed__stat-num mono">{report.matched}</div>
              <div className="live-feed__stat-label">matched to players</div>
            </div>
            <div className="live-feed__stat">
              <div className="live-feed__stat-num mono">{report.unmatched.length}</div>
              <div className="live-feed__stat-label">names not recognised</div>
            </div>
          </div>

          {report.gapBefore > 0 && (
            <div className="live-feed__warn">
              The file starts at pick {report.gapBefore + 1}, so picks 1–{report.gapBefore} aren't in it. Those slots
              are held open as blanks to keep the pick numbering honest — the players taken in them are still in the
              pool. Enter them with Manual Draft Mode if you want them counted.
            </div>
          )}

          {report.unmatched.length > 0 && (
            <>
              <div className="live-feed__order-note">
                These picks were recorded, but no player in your list matched the name — so nobody was marked
                drafted for them. Add an alias in Settings → Rankings Import to teach the match, or leave them: the
                pick numbering is unaffected either way.
              </div>
              <div className="live-feed__unmatched">
                {report.unmatched.map((u) => (
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

          {report.teamMismatches.length > 0 && (
            <div className="live-feed__warn">
              {report.teamMismatches.length} pick{report.teamMismatches.length === 1 ? '' : 's'} are seated under a
              different manager than the file names — e.g. pick {report.teamMismatches[0].pick} is seat{' '}
              {report.teamMismatches[0].expected} here but "{report.teamMismatches[0].feed}" in the file. That
              usually means the draft order in Settings → League is out of step with the room.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
