import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function DraftDayBehavior() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    api.getSettings().then((s) => setSettings(s.draftDay));
  }, []);

  async function patch(next) {
    setSettings((prev) => ({ ...prev, ...next }));
    await api.updateSettings('draftday', next);
  }

  if (!settings) return null;

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Draft-Day Behavior
      </div>
      <div className="card stack-gap-lg">
        <div>
          <div className="settings-row" style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            <div>Polling interval</div>
            <div className="mono" style={{ color: 'var(--text-primary)' }}>
              {settings.pollInterval}s
            </div>
          </div>
          <input
            type="range"
            min="5"
            max="60"
            step="1"
            value={settings.pollInterval}
            onChange={(e) => patch({ pollInterval: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Draft start detection
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="segmented-btn"
              style={
                settings.draftMode === 'auto'
                  ? { background: 'var(--accent)', color: 'var(--accent-on-text)' }
                  : { background: 'var(--bg-row)', color: 'var(--text-muted)' }
              }
              onClick={() => patch({ draftMode: 'auto' })}
            >
              Auto-detect
            </button>
            <button
              type="button"
              className="segmented-btn"
              style={
                settings.draftMode === 'manual'
                  ? { background: 'var(--accent)', color: 'var(--accent-on-text)' }
                  : { background: 'var(--bg-row)', color: 'var(--text-muted)' }
              }
              onClick={() => patch({ draftMode: 'manual' })}
            >
              Manual "Go Live"
            </button>
          </div>
        </div>

        <div>
          <div style={{ font: '600 13px var(--font-ui)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Notifications
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.notifSound}
              onChange={(e) => patch({ notifSound: e.target.checked })}
            />
            Sound when pick approaches
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.notifDesktop}
              onChange={(e) => patch({ notifDesktop: e.target.checked })}
            />
            Desktop notification
          </label>
        </div>
      </div>
    </div>
  );
}
