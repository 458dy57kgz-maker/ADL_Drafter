#!/usr/bin/env node
// Builds a stand-in for the Yahoo draft room so client/public/tracker.js can
// be exercised without a live draft. It reproduces the exact DOM shape the
// tracker scrapes — the "Picks" label four levels above the list, and each row
// carrying its pick number, manager, player name and the position/team pair
// inside a <ul> — so a change that breaks the real selectors breaks this too.
//
//   node scripts/mock-draft-room.mjs draft_picks.json
//   -> client/public/__mockdraft.html   (git-ignored; delete when finished)
//
// Then, with the client running, open http://localhost:5173/__mockdraft.html
// and load the tracker into it:
//
//   var s=document.createElement('script');s.src='/tracker.js';document.body.appendChild(s);
//
// showRows(n) in the page console reveals the first n picks, which is how you
// simulate the draft advancing and check the tracker pushes as it goes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/mock-draft-room.mjs <picks.json>');
  process.exit(1);
}

const escape = (v) =>
  String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const picks = JSON.parse(fs.readFileSync(source, 'utf8'));
const rows = picks.map(
  (p) => `<div class="pick">
      <span>${escape(p.pick)}</span>
      <div><span>${escape(p.draftedBy)}</span></div>
      <div><span>${escape(p.player)}</span></div>
      <ul><li><abbr><span>${escape(p.position)}</span></abbr></li><li><abbr><span>${escape(p.nhlTeam)}</span></abbr></li></ul>
    </div>`
);

// The class string is Yahoo's own, and findContainer() looks for it verbatim.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Mock draft room</title>
<style>body{background:#111;color:#eee;font:13px system-ui;padding:20px}.pick{border-bottom:1px solid #333;padding:4px}</style>
</head><body>
<h3>Mock Yahoo draft room — test fixture for tracker.js</h3>
<p>showRows(n) in the console reveals the first n of ${rows.length} picks.</p>
<div id="d4">
  <div><div><div><span>Picks</span></div></div></div>
  <div class="Fxg(1) Ovy(a) Ovx(h) D(f) Fxd(c) Gp(4px) Pb(16px)" id="list"></div>
</div>
<script>
window.__rows = ${JSON.stringify(rows)};
window.showRows = function (n) {
  document.getElementById('list').innerHTML = window.__rows.slice(0, n).join('');
};
showRows(${Math.min(rows.length, Math.ceil(rows.length / 2))});
</script>
</body></html>
`;

const out = path.resolve(__dirname, '../client/public/__mockdraft.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} — ${rows.length} picks`);
