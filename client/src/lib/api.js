const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${options.method || 'GET'} ${path} failed (${res.status}): ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getPlayers: () => request('/players'),
  updatePlayer: (id, patch) =>
    request(`/players/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  getDraftState: () => request('/draft/state'),
  getPickFeed: () => request('/draft/picks'),

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

  importRankings: (rows) =>
    request('/settings/rankings/import', { method: 'POST', body: JSON.stringify({ rows }) }),

  getDebugLog: () => request('/debug/log'),
  clearDebugLog: () => request('/debug/log', { method: 'DELETE' }),

  yahooStatus: () => request('/yahoo/status'),
  yahooConnect: (payload) =>
    request('/yahoo/connect', { method: 'POST', body: JSON.stringify(payload) }),
  yahooReconnect: () => request('/yahoo/reconnect', { method: 'POST' }),

  startNewSeason: (payload) =>
    request('/league/new-season', { method: 'POST', body: JSON.stringify(payload) }),
};
