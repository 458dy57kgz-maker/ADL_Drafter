const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON — the text is all there is */
    }
    // Some failures are structured and actionable (the live feed's "your
    // draft order disagrees with the file", which carries the order it
    // recovered), so the parsed body rides along on the error.
    const err = new Error(body?.error ?? `${options.method || 'GET'} ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getPlayers: () => request('/players'),
  updatePlayer: (id, patch) =>
    request(`/players/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  previewImport: (players) =>
    request('/players/import/preview', { method: 'POST', body: JSON.stringify({ players }) }),
  importPlayers: (players, removeMissing) =>
    request('/players/import', { method: 'POST', body: JSON.stringify({ players, removeMissing }) }),

  getDraftState: () => request('/draft/state'),
  getPickFeed: () => request('/draft/picks'),
  getDraftResults: () => request('/draft/results'),
  pickPlayer: (playerId) => request('/draft/pick', { method: 'POST', body: JSON.stringify({ playerId }) }),
  undoPick: () => request('/draft/undo', { method: 'POST' }),
  resetDraft: () => request('/draft/reset', { method: 'POST' }),

  // Live pick feed — the whole file is posted each time, not a delta.
  feedPreview: (picks) => request('/draft/feed/preview', { method: 'POST', body: JSON.stringify({ picks }) }),
  // With no picks the server falls back to the last set it was sent.
  feedApplyOrder: (picks) => request('/draft/feed/apply-order', { method: 'POST', body: JSON.stringify(picks ? { picks } : {}) }),
  feedSync: (picks) => request('/draft/feed/sync', { method: 'POST', body: JSON.stringify({ picks }) }),

  getSettings: () => request('/settings'),
  updateSettings: (section, patch) =>
    request(`/settings/${section}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getAliases: () => request('/settings/rankings/aliases'),
  addAlias: (alias) =>
    request('/settings/rankings/aliases', { method: 'POST', body: JSON.stringify(alias) }),
  deleteAlias: (id) => request(`/settings/rankings/aliases/${id}`, { method: 'DELETE' }),

  getUnmatched: () => request('/settings/rankings/unmatched'),
  resolveUnmatched: (id, decision) =>
    request(`/settings/rankings/unmatched/${id}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
  clearUnmatched: () => request('/settings/rankings/unmatched', { method: 'DELETE' }),

  getDebugLog: () => request('/debug/log'),
  clearDebugLog: () => request('/debug/log', { method: 'DELETE' }),

  yahooStatus: () => request('/yahoo/status'),
  yahooConnect: (payload) =>
    request('/yahoo/connect', { method: 'POST', body: JSON.stringify(payload) }),
  yahooReconnect: () => request('/yahoo/reconnect', { method: 'POST' }),
  yahooVerify: () => request('/yahoo/verify', { method: 'POST' }),

  pullLeagueTeams: () => request('/league/pull-teams', { method: 'POST' }),
};
