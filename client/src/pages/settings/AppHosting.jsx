import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function AppHosting() {
  const [settings, setSettings] = useState(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setSettings(s.hosting));
  }, []);

  async function handleExport() {
    const res = await fetch('/api/settings/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adl-drafter-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleReset() {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    await api.updateSettings('hosting', { reset: true });
    setConfirmingReset(false);
  }

  if (!settings) return null;

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        App / Hosting
      </div>
      <div className="card stack-gap-14">
        <div className="settings-row">
          <div style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)' }}>Leagues</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="field-select" style={{ width: 'auto' }}>
              {(settings.leagues ?? []).map((l) => (
                <option key={l.id}>{l.name}</option>
              ))}
            </select>
            <button type="button" className="btn btn-sm">
              + Add League
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)' }}>Timezone</div>
          <select
            className="field-select"
            style={{ width: 'auto' }}
            value={settings.timezone}
            onChange={(e) => api.updateSettings('hosting', { timezone: e.target.value })}
          >
            <option>America/Toronto</option>
            <option>America/New_York</option>
            <option>America/Chicago</option>
            <option>America/Denver</option>
            <option>America/Los_Angeles</option>
          </select>
        </div>
        <div className="settings-row">
          <div style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)' }}>Data</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={handleExport}>
              Export All
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={handleReset}>
              {confirmingReset ? 'Confirm reset' : 'Reset App'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
