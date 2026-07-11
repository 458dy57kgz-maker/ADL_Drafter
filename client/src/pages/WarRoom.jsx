import { useState } from 'react';
import { api } from '../lib/api.js';
import { usePolling } from '../lib/usePolling.js';
import './WarRoom.css';

const POS_ORDER = ['C', 'LW', 'RW', 'D', 'G'];

export default function WarRoom() {
  const [expandedPos, setExpandedPos] = useState({ C: 3, LW: 3, RW: 3, D: 3, G: 3 });
  const { data, error } = usePolling(api.getDraftState, 8, []);

  async function handleToggleTrack(playerId, tracked) {
    await api.updatePlayer(playerId, { tracked: !tracked });
  }

  function expandLane(pos) {
    setExpandedPos((prev) => ({ ...prev, [pos]: prev[pos] + 2 }));
  }

  if (error) {
    return (
      <div className="war-room war-room--empty">
        <div className="card">
          Could not reach the API server. Is it running? ({error.message})
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="war-room war-room--empty">Loading draft state…</div>;
  }

  const { pickInfo, yahooConnected, pollInterval, lanes, roster, targets, scarcity, liveFeed, tracked } =
    data;

  return (
    <div className="war-room">
      <header className="war-room__header">
        <div className="war-room__header-left">
          <div className="pick-chip mono">PICK {pickInfo.pickNum}</div>
          <div className="war-room__round">Round {pickInfo.round}</div>
          <div className="picks-until-pill">{pickInfo.picksUntilMe} picks until you</div>
        </div>
        <div className="war-room__header-right">
          <div className="yahoo-status">
            <span className={`status-dot${yahooConnected ? '' : ' status-dot--off'}`} />
            {yahooConnected ? 'Yahoo connected' : 'Yahoo disconnected'}
          </div>
          <div className="poll-chip mono">poll {pollInterval}s</div>
        </div>
      </header>

      <div className="war-room__lanes-section">
        <div className="section-eyebrow">Best Available — next per position</div>
        <div className="lanes-grid">
          {POS_ORDER.map((pos) => {
            const lane = lanes[pos];
            if (!lane) return null;
            const shown = lane.players.slice(0, expandedPos[pos]);
            const moreCount = Math.max(0, lane.players.length - shown.length);
            return (
              <div className="card lane-card" key={pos}>
                <div className="lane-card__header">
                  <div className="lane-card__pos">{pos}</div>
                  <div
                    className="scarcity-pill mono"
                    style={{
                      background: lane.scarcity.bg,
                      color: lane.scarcity.fg,
                      borderColor: lane.scarcity.border,
                    }}
                  >
                    {lane.scarcity.left} left
                  </div>
                </div>
                {shown.map((p) => (
                  <div className="lane-row" key={p.id}>
                    <div className="lane-row__info">
                      <div className="lane-row__name">{p.name}</div>
                      <div className="lane-row__contrib mono">{p.contribText}</div>
                    </div>
                    <div className="lane-row__actions">
                      <div
                        className="rank-badge mono"
                        title="my overall rank"
                        style={{
                          background: p.rankDelta.bg,
                          color: p.rankDelta.fg,
                          borderColor: p.rankDelta.border,
                        }}
                      >
                        #{p.overallRank}
                      </div>
                      <button
                        type="button"
                        className="track-toggle"
                        style={
                          p.tracked
                            ? { background: 'var(--accent)', color: 'var(--accent-on-text)', borderColor: 'var(--accent)' }
                            : { background: 'transparent', color: 'var(--text-faint)', borderColor: 'rgba(255,255,255,0.15)' }
                        }
                        onClick={() => handleToggleTrack(p.id, p.tracked)}
                      >
                        {p.tracked ? '★' : '☆'}
                      </button>
                    </div>
                  </div>
                ))}
                {moreCount > 0 && (
                  <button type="button" className="lane-card__more" onClick={() => expandLane(pos)}>
                    +{moreCount} more
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="war-room__bottom-grid">
        <div className="card roster-card">
          <div className="card-title">My Roster</div>
          <div className="roster-header">
            <div>SLOT</div>
            <div>PLAYER</div>
            <div>G</div>
            <div>A</div>
            <div>P</div>
            <div>PPP</div>
            <div>+/-</div>
            <div>SH</div>
          </div>
          {roster.slots.map((slot, i) => (
            <div className="roster-row" key={i}>
              <div className="mono roster-row__pos">{slot.pos}</div>
              <div
                className="roster-row__name"
                style={{ color: slot.player ? 'var(--text-primary)' : 'var(--text-faint)' }}
              >
                {slot.player ? slot.player.name : 'empty'}
              </div>
              <div className="mono">{slot.player?.g ?? '–'}</div>
              <div className="mono">{slot.player?.a ?? '–'}</div>
              <div className="mono">{slot.player?.p ?? '–'}</div>
              <div className="mono">{slot.player?.ppp ?? '–'}</div>
              <div className="mono">{slot.player?.plusMinus ?? '–'}</div>
              <div className="mono">{slot.player?.shots ?? '–'}</div>
            </div>
          ))}
          <div className="roster-footer">
            Bench x{roster.benchCount} · IR x{roster.irCount} — empty
          </div>
        </div>

        <div className="card targets-card">
          <div className="card-title">Target Progress</div>
          {targets.map((t) => (
            <div className="target-row" key={t.label}>
              <div className="target-row__labels">
                <div>{t.label}</div>
                <div className="mono">
                  {t.current} / {t.goal}
                </div>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${t.pct}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card side-card">
          <div>
            <div className="card-title">Position Scarcity</div>
            {POS_ORDER.map((pos) => {
              const sc = scarcity[pos];
              if (!sc) return null;
              return (
                <div className="scarcity-row" key={pos}>
                  <div className="mono scarcity-row__pos">{pos}</div>
                  <div
                    className="scarcity-row__pill mono"
                    style={{ background: sc.bg, color: sc.fg, borderColor: sc.border }}
                  >
                    {sc.left} left
                  </div>
                  <div className="progress-track progress-track--flex">
                    <div className="progress-fill progress-fill--neutral" style={{ width: `${sc.takenPct}%` }} />
                  </div>
                  <div className="scarcity-row__taken">{sc.taken} taken</div>
                </div>
              );
            })}
          </div>
          <div>
            <div className="card-title">Live Pick Feed</div>
            {liveFeed.map((f) => (
              <div className="feed-row" key={f.pickNum}>
                <span className="mono feed-row__num">#{f.pickNum}</span> {f.team} → {f.playerName} ({f.pos})
              </div>
            ))}
          </div>
          <div>
            <div className="card-title">Tracked Players</div>
            {tracked.map((tr) => (
              <div className="tracked-row" key={tr.id}>
                <div>
                  {tr.name} <span className="tracked-row__pos">— {tr.pos}</span>
                </div>
                <div
                  className="tracked-row__status"
                  style={{ color: tr.drafted ? 'var(--danger-text)' : 'var(--success-text)' }}
                >
                  {tr.drafted ? `Taken by ${tr.draftedBy}` : 'Still available'}
                </div>
              </div>
            ))}
            {tracked.length === 0 && <div className="tracked-row tracked-row--empty">No players tracked yet</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
