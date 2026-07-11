import { Router } from 'express';
import { getSetting, setSetting, logDebug } from '../db/index.js';

export const yahooRouter = Router();

// NOTE: this is a stub. Real OAuth2 (authorization-code exchange, token
// storage, refresh) gets wired in here once Yahoo credentials are in play —
// see the "Yahoo Connection" settings section in the design handoff for the
// two supported flows (reverse-proxy redirect vs. paste-the-code fallback).

yahooRouter.get('/status', (req, res) => {
  res.json(getSetting('yahoo'));
});

yahooRouter.post('/connect', (req, res) => {
  const { clientId, clientSecret, connectionMode } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'clientId and clientSecret are required' });
  }
  // TODO: exchange credentials for a real Yahoo OAuth token instead of
  // faking a connected state.
  const updated = setSetting('yahoo', {
    connected: true,
    username: 'yahoo_user',
    connectionMode,
    lastCall: 'just now',
    refreshHealthy: true,
    expiresIn: '60min',
  });
  logDebug('Yahoo connection established (stub)', 'OK', 'yahoo');
  res.json(updated);
});

yahooRouter.post('/reconnect', (req, res) => {
  const updated = setSetting('yahoo', { lastCall: 'just now', refreshHealthy: true, expiresIn: '60min' });
  logDebug('Yahoo token refreshed', 'OK', 'yahoo');
  res.json(updated);
});
