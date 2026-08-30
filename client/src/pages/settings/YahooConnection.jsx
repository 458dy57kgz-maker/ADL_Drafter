import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function YahooConnection() {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState('proxy');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [banner, setBanner] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  useEffect(() => {
    api
      .yahooStatus()
      .then((s) => {
        setStatus(s);
        setMode(s.connectionMode ?? 'proxy');
        setClientId(s.clientId ?? '');
        setPublicUrl(s.publicUrl ?? '');
      })
      .catch(() => setStatus({ connected: false }));

    // Land here after Yahoo redirects back through /api/yahoo/callback.
    const params = new URLSearchParams(window.location.search);
    const yahooResult = params.get('yahoo');
    if (yahooResult) {
      setBanner(
        yahooResult === 'connected'
          ? { kind: 'success', text: 'Yahoo connected successfully.' }
          : { kind: 'error', text: 'Yahoo authorization was not completed. Try again below.' }
      );
      params.delete('yahoo');
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
    }
  }, []);

  async function handleReconnect() {
    try {
      const s = await api.yahooReconnect();
      setStatus(s);
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const r = await api.yahooVerify();
      setVerifyResult(r);
    } catch (err) {
      setVerifyResult({ verified: false, error: err.message, checkedAt: new Date().toLocaleTimeString() });
    } finally {
      setVerifying(false);
    }
  }

  async function handleConnect() {
    const secretOk = clientSecret.trim() || status?.hasClientSecret;
    if (!clientId.trim() || !secretOk) {
      setBanner({ kind: 'error', text: 'Client ID and Client Secret are both required.' });
      return;
    }
    if (mode === 'proxy' && !publicUrl.trim()) {
      setBanner({ kind: 'error', text: 'Public URL is required for reverse-proxy mode.' });
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const s = await api.yahooConnect({ clientId: clientId.trim(), clientSecret, connectionMode: mode, publicUrl: publicUrl.trim() });
      setStatus(s);
      if (mode === 'proxy') {
        // Hand off to the server, which redirects the browser to Yahoo.
        window.location.href = '/api/yahoo/authorize';
      } else {
        setBanner({
          kind: 'error',
          text: 'Paste-the-code mode isn’t implemented yet — use "I have a domain / reverse proxy" for now.',
        });
      }
    } catch (err) {
      setBanner({ kind: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  function handleCopy() {
    if (!status?.redirectUri) return;
    navigator.clipboard?.writeText(status.redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-section-header">
        <div className="settings-section-title">Yahoo Connection</div>
        {status?.connected ? (
          <div className="status-pill">
            <span className="status-dot" />
            Connected as {status.username}
          </div>
        ) : (
          <div className="status-pill" style={{ background: 'var(--danger-bg-alt)', borderColor: 'var(--danger-border)', color: 'var(--danger-text)' }}>
            <span className="status-dot" style={{ background: 'var(--danger-text)' }} />
            Not connected
          </div>
        )}
      </div>

      {banner && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: banner.kind === 'success' ? 'var(--success-bg)' : 'var(--danger-bg-alt)',
            borderColor: banner.kind === 'success' ? 'var(--success-border)' : 'var(--danger-border)',
            color: banner.kind === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
            font: '600 12.5px var(--font-ui)',
          }}
        >
          {banner.text}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>
          Token Health
        </div>
        <div style={{ display: 'flex', gap: 24, font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          <div>
            Last call: <span className="mono" style={{ color: 'var(--text-primary)' }}>{status?.lastCall ?? '—'}</span>
          </div>
          <div>
            Not expired (local check):{' '}
            <span style={{ color: status?.refreshHealthy ? 'var(--success)' : 'var(--danger-text)' }}>
              {status?.refreshHealthy ? 'yes' : 'no — needs attention'}
            </span>
          </div>
          <div>
            Token expires: <span className="mono" style={{ color: 'var(--text-primary)' }}>{status?.expiresIn ?? '—'}</span>
          </div>
        </div>
        <div style={{ font: '500 11.5px var(--font-ui)', color: 'var(--text-faint)', marginTop: 6 }}>
          The line above only checks the stored expiry time — it never actually asks Yahoo. Use "Verify Live" to
          confirm the token really works.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button type="button" className="btn" onClick={handleReconnect}>
            Reconnect
          </button>
          <button type="button" className="btn" onClick={handleVerify} disabled={verifying}>
            {verifying ? 'Checking with Yahoo…' : 'Verify Live'}
          </button>
          {verifyResult && (
            <span
              className="mono"
              style={{ font: '600 12px var(--font-mono)', color: verifyResult.verified ? 'var(--success)' : 'var(--danger-text)' }}
            >
              {verifyResult.verified
                ? `Verified live at ${verifyResult.checkedAt}`
                : `${verifyResult.error} (checked ${verifyResult.checkedAt})`}
            </span>
          )}
        </div>
        {verifyResult && !verifyResult.verified && verifyResult.detail && (
          <div
            className="mono"
            style={{
              marginTop: 8,
              font: '500 11px var(--font-mono)',
              color: 'var(--text-faint)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {verifyResult.detail}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Guided Setup</div>
        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 10 }}>
          Step 1 — Client ID / Client Secret{' '}
          <span style={{ color: 'var(--text-faint)' }}>(from developer.yahoo.com)</span>
        </div>
        <div className="stack-gap" style={{ marginBottom: 10 }}>
          <input
            className="field-input"
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            className="field-input"
            placeholder={status?.hasClientSecret ? 'Client Secret (saved — leave blank to keep)' : 'Client Secret'}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </div>

        <div style={{ font: '500 13px var(--font-ui)', color: 'var(--text-secondary)', margin: '14px 0 8px' }}>
          Step 2 — Connection Mode
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <button
            type="button"
            className="conn-mode-card"
            style={
              mode === 'proxy'
                ? { background: 'var(--warning-bg)', borderColor: 'var(--accent)' }
                : { background: 'var(--bg-input)', borderColor: 'var(--border-hairline-strong)' }
            }
            onClick={() => setMode('proxy')}
          >
            <div className="conn-mode-card__title">I have a domain / reverse proxy</div>
            <div className="conn-mode-card__desc">
              Standard HTTPS redirect — paste this URI into your Yahoo app config
            </div>
          </button>
          <button
            type="button"
            className="conn-mode-card"
            style={
              mode === 'pastecode'
                ? { background: 'var(--warning-bg)', borderColor: 'var(--accent)' }
                : { background: 'var(--bg-input)', borderColor: 'var(--border-hairline-strong)' }
            }
            onClick={() => setMode('pastecode')}
          >
            <div className="conn-mode-card__title">
              No public HTTPS <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>(not built yet)</span>
            </div>
            <div className="conn-mode-card__desc">
              Paste-the-code fallback — authorize in a new tab, paste the code back here
            </div>
          </button>
        </div>

        {mode === 'proxy' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ font: '600 12px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 6 }}>
              Public URL <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>(where this app is reachable — the domain/reverse-proxy address, not localhost)</span>
            </div>
            <input
              className="field-input"
              placeholder="https://adldrafter.example.com"
              value={publicUrl}
              onChange={(e) => setPublicUrl(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>
        )}

        <div className="redirect-uri-row">
          <div className="mono redirect-uri-row__text">
            {mode === 'proxy'
              ? status?.redirectUri || (publicUrl ? `${publicUrl.replace(/\/$/, '')}/api/yahoo/callback` : 'Enter a Public URL above first')
              : 'Manual code entry — no redirect URI needed'}
          </div>
          {mode === 'proxy' && (
            <button type="button" className="btn btn-sm" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        <div style={{ font: '500 11.5px var(--font-ui)', color: 'var(--text-faint)', marginTop: 8 }}>
          Register this exact URI as a Redirect URI in your Yahoo app at developer.yahoo.com/apps before connecting.
        </div>

        <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={handleConnect} disabled={saving}>
          {saving ? 'Saving…' : 'Save & Connect'}
        </button>
      </div>
    </div>
  );
}
