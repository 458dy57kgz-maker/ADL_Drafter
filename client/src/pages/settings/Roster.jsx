import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

const SLOT_LABELS = { C: 'C', LW: 'LW', RW: 'RW', D: 'D', G: 'G', BENCH: 'Bench', IR: 'IR' };
const TARGET_LABELS = {
  goals: 'Goals',
  assists: 'Assists',
  ppp: 'PPP',
  plusMinus: '+/-',
  shots: 'Shots',
  wins: 'Wins',
  saves: 'Saves',
};

export default function Roster() {
  const [rosterSlots, setRosterSlots] = useState(null);
  const [targets, setTargets] = useState(null);

  useEffect(() => {
    api.getSettings().then((s) => {
      setRosterSlots(s.rosterSlots);
      setTargets(s.targets);
    });
  }, []);

  async function handleSlotChange(key, value) {
    const next = { ...rosterSlots, [key]: Number(value) || 0 };
    setRosterSlots(next);
    await api.updateSettings('roster', { rosterSlots: next });
  }

  async function handleTargetChange(key, value) {
    const next = { ...targets, [key]: Number(value) || 0 };
    setTargets(next);
    await api.updateSettings('roster', { targets: next });
  }

  if (!rosterSlots || !targets) return null;

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="settings-section-title" style={{ marginBottom: 16 }}>
        Roster
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>
          Slots per Position
        </div>
        <div className="card-subtitle">Fetched from Yahoo league settings — editable</div>
        {Object.keys(SLOT_LABELS).map((key) => (
          <div className="field-row" key={key}>
            <div className="field-row__label">{SLOT_LABELS[key]}</div>
            <input
              type="number"
              className="field-input"
              value={rosterSlots[key] ?? 0}
              onChange={(e) => handleSlotChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-title" style={{ marginBottom: 4 }}>
          Targets
        </div>
        <div className="card-subtitle">Season-end stat goals — drives the Target Progress bars in War Room</div>
        {Object.keys(TARGET_LABELS).map((key) => (
          <div className="field-row field-row--wide" key={key}>
            <div className="field-row__label">{TARGET_LABELS[key]}</div>
            <input
              type="number"
              className="field-input"
              value={targets[key] ?? 0}
              onChange={(e) => handleTargetChange(key, e.target.value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
