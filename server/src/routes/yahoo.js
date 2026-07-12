import { Router } from 'express';
import crypto from 'node:crypto';
import { getSetting, setSetting, logDebug } from '../db/index.js';
import { buildAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, fetchYahooProfile } from '../lib/yahooOAuth.js';

export const yahooRouter = Router();

// CSRF state for the in-flight authorize->callback round trip. This app has
// a single operator, so an in-memory value (not persisted) is enough — it
// only needs to survive the few seconds between redirecting to Yahoo and
// Yahoo redirecting back.
let pendingState = null;

function redirectUriFor(yahoo) {
  if (!yahoo.publicUrl) return null;
  return `${yahoo.publicUrl.replace(/\/$/, '')}/api/yahoo/callback`;
}

function redact(yahoo) {
  const redirectUri = redirectUriFor(yahoo);
  const refreshHealthy = !!(yahoo.accessToken && yahoo.tokenExpiresAt && yahoo.tokenExpiresAt > Date.now());
  const expiresIn = yahoo.tokenExpiresAt
    ? `${Math.max(0, Math.round((yahoo.tokenExpiresAt - Date.now()) / 60000))}min`
    : null;
  return {
    connected: yahoo.connected,
    username: yahoo.username,
    connectionMode: yahoo.connectionMode,
    publicUrl: yahoo.publicUrl,
    redirectUri,
    clientId: yahoo.clientId,
    hasClientSecret: !!yahoo.clientSecret,
    lastCall: yahoo.lastCall,
    refreshHealthy,
    expiresIn,
  };
}

// If the token is within 10 minutes of expiry, refresh it proactively —
// mirrors the 10-minute-buffer behavior of the Apps Script version this
// app replaces.
async function ensureFreshToken(yahoo) {
  if (!yahoo.connected || !yahoo.refreshToken) return yahoo;
  const tenMinutes = 10 * 60 * 1000;
  if (yahoo.tokenExpiresAt && yahoo.tokenExpiresAt - Date.now() > tenMinutes) return yahoo;

  try {
    const redirectUri = redirectUriFor(yahoo);
    const token = await refreshAccessToken({
      clientId: yahoo.clientId,
      clientSecret: yahoo.clientSecret,
      refreshToken: yahoo.refreshToken,
      redirectUri,
    });
    const updated = setSetting('yahoo', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || yahoo.refreshToken,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
      lastCall: new Date().toLocaleTimeString(),
    });
    logDebug('Yahoo token auto-refreshed', 'OK', 'yahoo');
    return updated;
  } catch (err) {
    logDebug(`Yahoo token refresh failed: ${err.message}`, 'ERROR', 'yahoo');
    return setSetting('yahoo', { connected: false });
  }
}

yahooRouter.get('/status', async (req, res) => {
  const yahoo = await ensureFreshToken(getSetting('yahoo'));
  res.json(redact(yahoo));
});

// Step 1: save credentials + connection config (no network call yet).
yahooRouter.post('/connect', (req, res) => {
  const { clientId, clientSecret, connectionMode, publicUrl } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'clientId and clientSecret are required' });
  }
  if (connectionMode === 'proxy' && !publicUrl) {
    return res.status(400).json({ error: 'publicUrl is required for reverse-proxy mode' });
  }
  const updated = setSetting('yahoo', {
    clientId,
    clientSecret,
    connectionMode: connectionMode || 'proxy',
    publicUrl: publicUrl || '',
  });
  logDebug('Yahoo credentials saved', 'OK', 'yahoo');
  res.json(redact(updated));
});

// Step 2 (proxy mode): browser navigates here, we redirect on to Yahoo.
yahooRouter.get('/authorize', (req, res) => {
  const yahoo = getSetting('yahoo');
  const redirectUri = redirectUriFor(yahoo);
  if (!yahoo.clientId || !redirectUri) {
    return res
      .status(400)
      .send('Yahoo client ID and Public URL must be saved in Settings before authorizing.');
  }
  pendingState = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl({ clientId: yahoo.clientId, redirectUri, state: pendingState });
  res.redirect(authorizeUrl);
});

// Step 3: Yahoo redirects the browser back here with ?code&state.
yahooRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const appRoot = '/';

  if (error) {
    logDebug(`Yahoo authorization denied: ${error}`, 'ERROR', 'yahoo');
    return res.redirect(`${appRoot}?yahoo=denied`);
  }
  if (!state || state !== pendingState) {
    logDebug('Yahoo callback rejected: state mismatch', 'ERROR', 'yahoo');
    return res.status(400).send('Invalid or expired authorization attempt. Go back to Settings and try again.');
  }
  pendingState = null;

  const yahoo = getSetting('yahoo');
  const redirectUri = redirectUriFor(yahoo);
  try {
    const token = await exchangeCodeForToken({
      clientId: yahoo.clientId,
      clientSecret: yahoo.clientSecret,
      code,
      redirectUri,
    });
    const username = await fetchYahooProfile(token.access_token);
    setSetting('yahoo', {
      connected: true,
      username: username || 'Yahoo user',
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
      lastCall: new Date().toLocaleTimeString(),
    });
    logDebug('Yahoo connected', 'OK', 'yahoo');
    res.redirect(`${appRoot}?yahoo=connected`);
  } catch (err) {
    logDebug(`Yahoo token exchange failed: ${err.message}`, 'ERROR', 'yahoo');
    res.status(500).send(`Yahoo connection failed: ${err.message}`);
  }
});

yahooRouter.post('/reconnect', async (req, res) => {
  const yahoo = getSetting('yahoo');
  if (!yahoo.refreshToken) {
    return res.status(400).json({ error: 'No refresh token on file — use Settings to authorize again.' });
  }
  try {
    const redirectUri = redirectUriFor(yahoo);
    const token = await refreshAccessToken({
      clientId: yahoo.clientId,
      clientSecret: yahoo.clientSecret,
      refreshToken: yahoo.refreshToken,
      redirectUri,
    });
    const updated = setSetting('yahoo', {
      connected: true,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || yahoo.refreshToken,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
      lastCall: new Date().toLocaleTimeString(),
    });
    logDebug('Yahoo token manually refreshed', 'OK', 'yahoo');
    res.json(redact(updated));
  } catch (err) {
    logDebug(`Yahoo reconnect failed: ${err.message}`, 'ERROR', 'yahoo');
    res.status(500).json({ error: err.message });
  }
});
