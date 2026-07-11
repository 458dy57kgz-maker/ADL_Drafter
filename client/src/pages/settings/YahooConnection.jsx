import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function YahooConnection() {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState('proxy');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .yahooStatus()
      .then((s) => {
        setStatus(s);
        setMode(s.connectionMode ?? 'proxy');
      })
      .catch(() => setStatus({ connected: false }));
  }, []);

  async function handleReconnect() {
    await api.yahooReconnect();
    const s = await api.yahooStatus();
    setStatus(s);
  }

  async function handleConnect() {
    const s = await api.yahooConnect({ clientId, clientSecret, connectionMode: mode });
    setStatus(s);
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-eyebrow" style={{ marginBottom: 10 }}>
          Token Health
        </div>
        <div style={{ display: 'flex', gap: 24, font: '500 13px var(--font-ui)', color: 'var(--text-secondary)' }}>
          <div>
            Last call: <span className="mono" style={{ color: 'var(--text-primary)' }}>{status?.lastCall ?? '—'}</span>
          </div>
          <div>
            Auto-refresh:{' '}
            <span style={{ color: status?.refreshHealthy ? 'var(--success)' : 'var(--danger-text)' }}>
              {status?.refreshHealthy ? 'healthy' : 'needs attention'}
            </span>
          </div>
          <div>
            Token expires: <span className="mono" style={{ color: 'var(--text-primary)' }}>{status?.expiresIn ?? '—'}</span>
          </div>
        </div>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={handleReconnect}>
          Reconnect
        </button>
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
            placeholder="Client Secret"
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
            <div className="conn-mode-card__title">No public HTTPS</div>
            <div className="conn-mode-card__desc">
              Paste-the-code fallback — authorize in a new tab, paste the code back here
            </div>
          </button>
        </div>

        <div className="redirect-uri-row">
          <div className="mono redirect-uri-row__text">
            {mode === 'proxy' ? status?.redirectUri ?? 'https://your-domain/api/yahoo/callback' : 'Manual code entry — no redirect URI needed'}
          </div>
          {mode === 'proxy' && (
            <button type="button" className="btn btn-sm" onClick={handleCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>

        <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={handleConnect}>
          Save & Connect
        </button>
      </div>
    </div>
  );
}
