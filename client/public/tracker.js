/* ADL Drafter — Yahoo draft-room tracker.
 *
 * Loaded into Yahoo's draft room by a one-line bookmarklet (see Settings >
 * Live Pick Feed for the exact line, which carries this app's address). It
 * watches the pick list, and POSTs every pick it has seen straight to the app.
 *
 * Why a loaded script instead of one long bookmarklet: the bookmarklet never
 * changes, so this file can be fixed and redeployed without you rebuilding a
 * bookmark mid-draft. Yahoo's CSP is `sandbox` only — no script-src and no
 * connect-src — so both the load and the cross-origin POST are allowed.
 *
 * Why it pushes instead of writing a file the app reads: writing a file needs
 * the File System Access API on both ends and re-granting permission every
 * page load. Pushing needs nothing, and it works no matter where the app runs.
 * Export JSON/CSV are kept as a manual backup.
 *
 * The DOM scraping below is unchanged from the original bookmarklet — those
 * selectors are the part that is known to work against the live draft room,
 * so they are ported verbatim rather than improved.
 */
(function () {
  'use strict';

  // Must be read synchronously: document.currentScript is null by the time any
  // callback runs. This is also how the app's address gets in here — the
  // script was served by the app, so its own URL is the answer.
  var APP_ORIGIN = (function () {
    try {
      return new URL(document.currentScript.src).origin;
    } catch (e) {
      return null;
    }
  })();

  var STORAGE_KEY = 'yahooDraftTracker:' + location.pathname;
  var SCAN_MS = 1500;

  if (window.__adlTracker) {
    try {
      window.__adlTracker.stop();
    } catch (e) {
      /* replacing a previous run */
    }
  }

  var state = {
    picks: new Map(),
    observer: null,
    interval: null,
    container: null,
    paused: false,
    lastPushedCount: -1,
    sync: { status: 'idle', text: 'not synced yet' },
  };

  function log() {
    console.log.apply(console, ['[ADL Drafter]'].concat([].slice.call(arguments)));
  }

  // --- scraping (ported verbatim) ------------------------------------------

  function parsePick(el) {
    try {
      var numEl = el.querySelector(':scope > span');
      if (!numEl) return null;
      var numText = numEl.textContent.trim();
      if (!/^\d+$/.test(numText)) return null;

      var pick = parseInt(numText, 10);
      var teamEl = el.querySelector(':scope > div > span');
      var draftedBy = teamEl ? teamEl.textContent.trim() : null;
      var ul = el.querySelector('ul');
      var tags = ul ? Array.from(ul.querySelectorAll('li abbr span')) : [];
      var position = tags[0] ? tags[0].textContent.trim() : null;
      var nhlTeam = tags[1] ? tags[1].textContent.trim() : null;
      var nameHost = ul ? ul.previousElementSibling : null;
      var nameEl = nameHost ? nameHost.querySelector('span') : null;
      var player = nameEl ? nameEl.textContent.trim() : null;

      return player ? { pick: pick, draftedBy: draftedBy, player: player, position: position, nhlTeam: nhlTeam } : null;
    } catch (e) {
      return null;
    }
  }

  function findContainer() {
    try {
      var label = Array.from(document.querySelectorAll('*')).find(function (el) {
        return el.childElementCount === 0 && el.textContent.trim() === 'Picks';
      });
      if (!label) return null;

      var host = label.closest('div');
      for (var i = 0; i < 3 && host; i++) host = host.parentElement;
      if (!host) return null;

      var candidates = Array.from(
        host.querySelectorAll('div[class="Fxg(1) Ovy(a) Ovx(h) D(f) Fxd(c) Gp(4px) Pb(16px)"]')
      );
      if (candidates.length === 0) {
        var counts = new Map();
        host.querySelectorAll('div').forEach(function (el) {
          if (el.children.length > 0 && el.children.length <= 200) {
            var parent = el.parentElement;
            counts.set(parent, (counts.get(parent) || 0) + 1);
          }
        });
        candidates = Array.from(counts.keys());
      }
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      var best = null;
      var bestScore = -1;
      candidates.forEach(function (el) {
        var score = Array.from(el.children).filter(parsePick).length + (el.offsetParent ? 1000 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      });
      return best;
    } catch (e) {
      log('findContainer error', e);
      return null;
    }
  }

  function observe(el) {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(function () {
      scan();
    });
    state.observer.observe(el, { childList: true, subtree: true, characterData: true });
  }

  function getPicks() {
    return Array.from(state.picks.values()).sort(function (a, b) {
      return a.pick - b.pick;
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getPicks()));
    } catch (e) {
      log('save failed', e);
    }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      JSON.parse(raw).forEach(function (p) {
        state.picks.set(p.pick, p);
      });
      log('restored', state.picks.size, 'picks from this browser');
    } catch (e) {
      log('restore failed', e);
    }
  }

  function scan() {
    // Paused after a reset. Without this the very next scan would re-read the
    // draft room — which still shows every pick — and push the whole draft
    // straight back, making Reset look like it did nothing.
    if (state.paused) return 0;

    var found = findContainer();
    if (found && found !== state.container) {
      state.container = found;
      observe(found);
    } else if (!found && !(state.container && document.contains(state.container))) {
      return 0;
    }
    if (!state.container) return 0;

    var added = 0;
    Array.from(state.container.children).forEach(function (child) {
      var pick = parsePick(child);
      if (pick && !state.picks.has(pick.pick)) {
        state.picks.set(pick.pick, pick);
        added++;
      }
    });

    if (added > 0) {
      save();
      push();
    }
    render();
    return added;
  }

  // --- pushing to the app --------------------------------------------------

  var pushing = false;

  function post(path, body) {
    return fetch(APP_ORIGIN + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = JSON.parse(text);
        } catch (e) {
          /* not JSON */
        }
        return { ok: res.ok, status: res.status, data: data, text: text };
      });
    });
  }

  // Sends everything captured, not a delta — that makes the app's copy
  // self-correcting, and means a failed push costs nothing but a retry.
  function push(force) {
    if (!APP_ORIGIN) {
      state.sync = { status: 'error', text: "can't tell where the app is — reload the bookmarklet" };
      return render();
    }
    if (pushing) return undefined;
    // Nothing captured yet is not news, and the app treats an empty push as a
    // no-op anyway — no reason to make the round trip.
    if (state.picks.size === 0) return undefined;
    if (!force && state.picks.size === state.lastPushedCount && state.sync.status === 'ok') return undefined;

    pushing = true;
    var picks = getPicks();
    return post('/api/draft/feed/sync', { picks: picks })
      .then(function (res) {
        if (res.ok) {
          state.lastPushedCount = picks.length;
          var unmatched = (res.data && res.data.unmatched && res.data.unmatched.length) || 0;
          state.sync = {
            status: 'ok',
            text: 'synced ' + (res.data ? res.data.picks : picks.length) + ' picks' + (unmatched ? ' · ' + unmatched + ' name' + (unmatched === 1 ? '' : 's') + ' unmatched' : ''),
          };
        } else if (res.status === 409) {
          // The only thing the app refuses on now is having no teams at all:
          // picks are filed by draft slot, so it needs to know how many seats
          // there are and which one is yours.
          state.sync = {
            status: 'blocked',
            text: (res.data && res.data.error) || 'set your teams in Settings > League',
          };
        } else {
          state.sync = { status: 'error', text: (res.data && res.data.error) || 'app said ' + res.status };
        }
      })
      .catch(function (err) {
        state.sync = { status: 'error', text: "can't reach the app — " + err.message };
      })
      .then(function () {
        pushing = false;
        render();
      });
  }

  // Clears both sides at once. Doing only one leaves the other holding a draft
  // that no longer exists — and this tracker would push it all straight back.
  //
  // Capturing pauses afterwards rather than continuing: the old draft is still
  // on screen until Yahoo loads the new one, so anything captured in between
  // is the draft you just cleared.
  function resetDraft() {
    if (!window.confirm('Clear every pick captured here AND reset the draft in ADL Drafter?\n\nThe player list and rankings are kept. Capturing pauses until you press Start.')) return;
    state.picks.clear();
    state.lastPushedCount = -1;
    state.paused = true;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* nothing stored */
    }
    state.sync = { status: 'idle', text: 'cleared — paused' };
    render();
    if (APP_ORIGIN) {
      post('/api/draft/reset', {})
        .then(function (res) {
          state.sync = {
            status: 'idle',
            text: res.ok ? 'cleared — press Start for the new draft' : 'cleared here, but the app said ' + res.status,
          };
          render();
        })
        .catch(function () {
          state.sync = { status: 'error', text: 'cleared here, but could not reach the app' };
          render();
        });
    }
  }

  function resume() {
    state.paused = false;
    state.sync = { status: 'idle', text: 'capturing…' };
    scan();
    push(true);
    render();
  }

  // --- manual export (backup) ----------------------------------------------

  function download(filename, text) {
    var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 5000);
  }

  function exportJson() {
    scan();
    download('draft_picks.json', JSON.stringify(getPicks(), null, 2));
  }

  function exportCsv() {
    scan();
    var rows = getPicks().map(function (p) {
      return [p.pick, p.draftedBy, p.player, p.position, p.nhlTeam]
        .map(function (v) {
          return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        })
        .join(',');
    });
    download('draft_picks.csv', ['pick,draftedBy,player,position,nhlTeam'].concat(rows).join('\n'));
  }

  // --- panel ---------------------------------------------------------------

  var ui = null;

  var SYNC_COLOR = { ok: '#4caf7d', blocked: '#e0a53c', error: '#e0603c', idle: '#8b93a3' };

  function render() {
    if (!ui) return;
    var picks = getPicks();
    var last = picks[picks.length - 1];
    ui.status.textContent = state.picks.size + ' picks captured' + (last ? ' — last: ' + last.player : '');
    ui.sync.textContent = state.sync.text;
    ui.sync.style.color = SYNC_COLOR[state.sync.status] || SYNC_COLOR.idle;
    ui.resetBtn.textContent = state.paused ? 'Start capturing' : 'Reset draft';
    ui.resetBtn.style.background = state.paused ? '#2f7a4f' : '#8a2f22';
  }

  function button(label, onClick, opts) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'flex:1',
      'background:' + ((opts && opts.bg) || '#6b3fa0'),
      'color:#fff',
      'border:none',
      'border-radius:6px',
      'padding:6px 4px',
      'font-size:12px',
      'cursor:pointer',
    ].join(';');
    b.onclick = onClick;
    return b;
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      'background:#1f1f2e',
      'color:#fff',
      'font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif',
      'border-radius:10px',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'padding:10px 12px',
      'width:230px',
      'user-select:none',
    ].join(';');

    var title = document.createElement('div');
    title.textContent = 'ADL Draft Tracker';
    title.style.cssText =
      'font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;';
    var chevron = document.createElement('span');
    chevron.textContent = '–';
    chevron.style.cssText = 'opacity:.6;font-weight:400;';
    title.appendChild(chevron);

    var body = document.createElement('div');

    var status = document.createElement('div');
    status.style.cssText = 'opacity:.85;margin-bottom:2px;';

    var sync = document.createElement('div');
    sync.style.cssText = 'font-size:12px;margin-bottom:8px;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;';
    row.appendChild(button('Export CSV', exportCsv));
    row.appendChild(button('Export JSON', exportJson));

    var resetBtn = button('Reset draft', function () {
      if (state.paused) resume();
      else resetDraft();
    }, { bg: '#8a2f22' });

    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;gap:6px;margin-top:6px;';
    row2.appendChild(button('Push now', function () { push(true); }));
    row2.appendChild(resetBtn);

    body.appendChild(status);
    body.appendChild(sync);
    body.appendChild(row);
    body.appendChild(row2);
    panel.appendChild(title);
    panel.appendChild(body);

    var collapsed = false;
    title.addEventListener('click', function () {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
      chevron.textContent = collapsed ? '+' : '–';
    });

    document.body.appendChild(panel);
    ui = { panel: panel, status: status, sync: sync, resetBtn: resetBtn };
  }

  // --- start ---------------------------------------------------------------

  function start() {
    restore();
    if (!ui) buildPanel();
    scan();
    push(true); // whatever was restored belongs in the app straight away
    state.container = findContainer() || state.container;
    if (state.container) observe(state.container);
    state.interval = setInterval(scan, SCAN_MS);
    log('started against', APP_ORIGIN, '—', state.picks.size, 'picks so far');
  }

  window.__adlTracker = {
    state: state,
    start: start,
    stop: function () {
      if (state.observer) state.observer.disconnect();
      if (state.interval) clearInterval(state.interval);
      if (ui && ui.panel) ui.panel.remove();
      ui = null;
    },
    scan: scan,
    push: push,
    resume: resume,
    getPicks: getPicks,
    exportJSON: exportJson,
    exportCSV: exportCsv,
  };

  start();
})();
