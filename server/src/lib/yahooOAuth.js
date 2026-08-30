// Yahoo OAuth2 (authorization-code flow). Endpoints per Yahoo's documented
// API — same ones the legacy Apps Script version of this tool used via
// Apps Script's OAuth2 library (setAuthorizationBaseUrl/setTokenUrl).

const AUTHORIZE_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const USERINFO_URL = 'https://api.login.yahoo.com/openid/v1/userinfo';

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

export async function fetchYahooProfile(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const profile = await res.json();
  return profile.nickname || profile.given_name || profile.name || null;
}

// Live check against Yahoo, distinct from fetchYahooProfile: it surfaces the
// actual HTTP status instead of collapsing every failure to null, so a
// "Verify" click can tell the user the token is genuinely rejected (401)
// rather than just re-displaying the locally-cached expiry math.
export async function verifyAccessToken(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.ok) return { ok: true };
  return { ok: false, status: res.status, statusText: res.statusText };
}
