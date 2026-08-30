// Yahoo OAuth2 (authorization-code flow). Endpoints per Yahoo's documented
// API — same ones the legacy Apps Script version of this tool used via
// Apps Script's OAuth2 library (setAuthorizationBaseUrl/setTokenUrl).

const AUTHORIZE_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
// This app's Yahoo app registration only requests Fantasy Sports Read
// access, not OpenID/profile scope — the generic /openid/v1/userinfo
// endpoint 403s for that token regardless of validity. Use the Fantasy
// Sports API itself both to identify the account and to verify the token,
// since that's the scope actually granted and the API this app depends on.
const FANTASY_USERS_URL = 'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games?format=json';

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  url.searchParams.set('language', 'en-us');
  return url.toString();
}

function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function postForm(body, clientId, clientSecret) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Yahoo token endpoint returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`Yahoo token endpoint error (${res.status}): ${json.error_description || json.error || text}`);
  }
  return json;
}

export function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  return postForm({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, clientId, clientSecret);
}

export function refreshAccessToken({ clientId, clientSecret, refreshToken, redirectUri }) {
  return postForm(
    { grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: redirectUri },
    clientId,
    clientSecret
  );
}

// The Fantasy Sports "users" resource doesn't expose a friendly display
// name (that requires drilling into a specific league's team/manager data)
// — the GUID is the only identifier reliably available here, but it's a
// real per-account value rather than a hardcoded fallback string.
async function fetchYahooFantasyIdentity(accessToken) {
  const res = await fetch(FANTASY_USERS_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { ok: false, status: res.status, statusText: res.statusText };
  const json = await res.json();
  const guid = json?.fantasy_content?.users?.['0']?.user?.[0]?.guid ?? null;
  return { ok: true, guid };
}

export async function fetchYahooUsername(accessToken) {
  const identity = await fetchYahooFantasyIdentity(accessToken);
  return identity.ok && identity.guid ? `Yahoo account •••${identity.guid.slice(-6)}` : null;
}

// Live check against Yahoo, surfacing the actual HTTP status so a "Verify"
// click can tell the user the token is genuinely rejected rather than just
// re-displaying the locally-cached expiry math.
export async function verifyAccessToken(accessToken) {
  const identity = await fetchYahooFantasyIdentity(accessToken);
  if (identity.ok) return { ok: true };
  return { ok: false, status: identity.status, statusText: identity.statusText };
}
