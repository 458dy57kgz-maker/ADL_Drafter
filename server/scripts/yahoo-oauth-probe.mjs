#!/usr/bin/env node
// Yahoo OAuth probe — runs Yahoo's sign-in by hand, outside the app, to find
// out what a token can actually do. Nothing here touches the app's database
// or settings, and no token is ever printed.
//
//   node server/scripts/yahoo-oauth-probe.mjs
//
// It asks for the app's Client ID, Client Secret (typed hidden) and redirect
// URI, prints a Yahoo sign-in link, and waits. Sign in (passkey and all) and
// approve; Yahoo then sends the browser to the redirect URI. Whatever that
// page shows — the ADL Drafter app will say the attempt is invalid, which is
// expected and harmless — copy the full address from the address bar and
// paste it back here. The script trades the code for a token and calls a few
// Yahoo endpoints, printing each status and Yahoo's own reply.
//
// Run it with scope "fspt-r" and again with no scope, and compare.

import readline from 'node:readline';
import crypto from 'node:crypto';

const AUTHORIZE_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const DEFAULT_REDIRECT = 'https://dxp4800plus-7d5.tail9af858.ts.net/api/yahoo/callback';
const LEAGUE_ID = process.env.LEAGUE_ID || '18292';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

function ask(question, { hidden = false, fallback = '' } = {}) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(question, (a) => resolve(a.trim() || fallback));
    // Typed characters aren't echoed, so the secret never shows on screen.
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => {
      if (s.includes(question)) write.call(rl, s);
    };
    rl.question(question, (a) => {
      rl._writeToOutput = write;
      process.stdout.write('\n');
      resolve(a.trim());
    });
  });
}

async function call(label, url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 500);
  const verdict = res.ok ? 'OK ' : 'FAIL';
  console.log(`\n[${verdict}] ${label} — HTTP ${res.status}`);
  console.log(`       ${url}`);
  console.log(`       ${body}`);
  return res.ok;
}

async function main() {
  console.log('\nYahoo OAuth probe — nothing here touches ADL Drafter or its database.\n');
  const clientId = await ask('Client ID: ');
  const clientSecret = await ask('Client Secret (hidden): ', { hidden: true });
  const redirectUri = await ask(`Redirect URI [${DEFAULT_REDIRECT}]: `, { fallback: DEFAULT_REDIRECT });
  const scope = await ask('Scope to request — "fspt-r", "none", or anything else [fspt-r]: ', { fallback: 'fspt-r' });

  const state = crypto.randomBytes(8).toString('hex');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('language', 'en-us');
  if (scope !== 'none') url.searchParams.set('scope', scope);

  console.log('\n1. Open this link in your browser, sign in and approve:\n');
  console.log(`   ${url}\n`);
  console.log('2. When Yahoo sends you on, copy the whole address from the address bar.\n');
  const landed = await ask('Paste it here: ');

  let code;
  try {
    const back = new URL(landed);
    if (back.searchParams.get('error')) {
      console.log(`\nYahoo refused the sign-in: ${back.searchParams.get('error')} — ${back.searchParams.get('error_description') ?? ''}`);
      return;
    }
    code = back.searchParams.get('code');
    if (back.searchParams.get('state') !== state) console.log('(Note: state did not match — fine for this test, but check you pasted the newest address.)');
  } catch {
    code = landed; // a bare code works too
  }
  if (!code) {
    console.log('\nNo ?code= in that address. Nothing to exchange.');
    return;
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
  });
  const tokenText = await tokenRes.text();
  let token;
  try {
    token = JSON.parse(tokenText);
  } catch {
    console.log(`\nToken exchange: HTTP ${tokenRes.status}, not JSON: ${tokenText.slice(0, 300)}`);
    return;
  }
  if (!tokenRes.ok) {
    console.log(`\nToken exchange FAILED — HTTP ${tokenRes.status}: ${token.error} ${token.error_description ?? ''}`);
    return;
  }

  // What came back, without the secrets themselves.
  console.log('\nToken exchange OK. Fields Yahoo returned:');
  for (const [k, v] of Object.entries(token)) {
    const shown = /token/i.test(k) ? `(${String(v).length} chars, hidden)` : JSON.stringify(v);
    console.log(`   ${k}: ${shown}`);
  }
  console.log('   → an id_token means OpenID scopes were granted; its absence with fspt-r requested is normal.');

  const t = token.access_token;
  const base = 'https://fantasysports.yahooapis.com/fantasy/v2';
  const results = {
    game: await call('NHL game info (any Fantasy-scoped token)', `${base}/game/nhl?format=json`, t),
    users: await call('My games (what Verify Live uses)', `${base}/users;use_login=1/games?format=json`, t),
    league: await call(`League ${LEAGUE_ID}`, `${base}/league/nhl.l.${LEAGUE_ID}?format=json`, t),
    openid: await call('OpenID userinfo (only works with openid scope)', 'https://api.login.yahoo.com/openid/v1/userinfo', t),
  };

  console.log('\nReading it:');
  if (results.game && results.users && results.league) {
    console.log('   Fantasy calls work with this sign-in. If the app still fails, the difference is in how the app asks —');
    console.log(`   most likely the scope (${scope === 'none' ? 'none was requested here' : `"${scope}" was requested here`}).`);
  } else if (results.game && !results.league) {
    console.log('   The token has Fantasy access, but this league refused it — check the league ID and that this Yahoo');
    console.log('   account is in the league.');
  } else if (!results.game && results.openid) {
    console.log('   Sign-in-only token: Yahoo granted OpenID, not Fantasy Sports. Request scope fspt-r, or check that');
    console.log('   Fantasy Sports (Read) is ticked for this app in the Yahoo developer console.');
  } else {
    console.log('   No Fantasy access at all. Look at the replies above: "additional_authorization_required" means the');
    console.log('   scope was not granted; "not authorized to perform this action" means the app itself lacks the');
    console.log('   Fantasy Sports permission.');
  }
}

main()
  .catch((err) => console.error(`\nProbe failed: ${err.message}`))
  .finally(() => rl.close());
