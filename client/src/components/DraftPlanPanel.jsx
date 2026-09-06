import './DraftPlanPanel.css';

/**
 * The "next two picks" panel: the left card is the instruction, the right one
 * is a forecast. They are deliberately styled differently — the left carries
 * an accent border, the right a plain one — because one of them is telling you
 * what to do and the other is telling you what to expect, and the panel loses
 * its value the moment those read as equally certain.
 */

// Icon keys mirror the Tabler names the spec asked for (ti-chart-bar,
// ti-clock, ti-arrow-down, ti-layout-grid, ti-calendar, ti-scale). Drawn as
// inline paths rather than pulled from an icon font: the engine ships with no
// dependencies and the panel keeps that property.
const ICON_PATHS = {
  categories: 'M4 19V9m5 10V5m5 14v-7m5 7V8', // ti-chart-bar
  urgency: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', // ti-clock
  cliff: 'M12 5v14m0 0l-5-5m5 5l5-5', // ti-arrow-down
  slot: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', // ti-layout-grid
  schedule: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', // ti-calendar
  market: 'M12 4v16M5 8h14M7 8l-3 6h6zM17 8l-3 6h6z', // ti-scale
};

const FACTOR_COLOR = {
  categories: 'var(--accent)',
  urgency: 'var(--warning-text)',
  cliff: 'var(--text-secondary)',
  slot: 'var(--text-secondary)',
  schedule: 'var(--teal-text)',
  market: 'var(--text-secondary)',
};

// Every displayed number is rounded at the point of display. The engine works
// in raw floats, and printing one straight leaks artifacts like
// 0.30000000000000004 into the middle of a recommendation.
const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;
const num2 = (v) => (v == null ? '—' : v.toFixed(2));
const signed2 = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`);

// Below this, the best and second-best two-pick paths are effectively tied.
// Showing a confident pill on a 0.02 edge and on a 0.30 edge teaches you to
// ignore both, so the panel says "close call" and gives the runner-up equal
// billing instead.
const CLOSE_CALL_EDGE = 0.03;

function FactorIcon({ name }) {
  return (
    <svg className="factor__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name] ?? ICON_PATHS.slot} />
    </svg>
  );
}

function FactorDetail({ factor }) {
  if (factor.key === 'categories' && Array.isArray(factor.detail)) {
    return (
      <div className="factor__detail">
        {factor.detail.map((d) => (
          <span className="factor__cat mono" key={d.category}>
            {d.category} {pct(d.winProbBefore)} → <strong>{pct(d.winProbAfter)}</strong>
          </span>
        ))}
      </div>
    );
  }
  if (factor.key === 'urgency' && factor.detail) {
    const goneBy = 1 - (factor.detail.survival ?? 0);
    return (
      <div className="factor__detail">
        <div className="factor__bar" title={`${pct(goneBy)} chance he is gone`}>
          <div className="factor__bar-fill" style={{ width: `${Math.round(goneBy * 100)}%` }} />
        </div>
      </div>
    );
  }
  if (factor.key === 'schedule' && factor.detail) {
    return (
      <div className="factor__detail">
        <span className="factor__cat mono">
          {pct(factor.detail.offShare)} off-night vs {pct(factor.detail.leagueMean)} pool average
        </span>
      </div>
    );
  }
  return null;
}

function PlayerLine({ player, size = 'lg' }) {
  if (!player) return null;
  return (
    <div>
      <div className={`plan-player plan-player--${size}`}>{player.name}</div>
      <div className="plan-meta mono">
        {player.posList?.join('/') ?? player.pos}
        {player.team ? ` · ${player.team}` : ''}
        {player.vorp != null ? ` · VORP ${player.vorp.toFixed(2)}` : ''}
      </div>
    </div>
  );
}

export function BestPickCard({ plan, quick, status, error, pickInfo, coverage }) {
  const now = plan?.now ?? null;
  const turn = plan?.turn ?? null;
  const onClock = pickInfo?.isMyTurnNow;

  // `turn.picks` is always [the pick this card is about, the one after it].
  // On the clock those are the current pick and the next turn, which is what
  // the header wants. Off the clock the first entry IS the next turn, and
  // reading the second would tell you your next pick is a round later than it
  // is — during a draft that is the difference between waiting and reaching.
  const nextPick = (onClock ? turn?.picks?.[1] : turn?.picks?.[0]) ?? null;
  const gap = nextPick != null && pickInfo?.pickNum != null ? nextPick - pickInfo.pickNum : null;
  const edge = now?.edge;
  const closeCall = edge != null && edge < CLOSE_CALL_EDGE;
  const marketFactor = now?.factors?.find((f) => f.key === 'market');

  return (
    <div className="card pick-box pick-box--now">
      <div className="pick-box__head">
        <div className="card-title">Best Pick</div>
        <div className={`plan-pill${onClock ? ' plan-pill--live' : ''}`}>
          {onClock ? 'On the clock' : 'Waiting'}
        </div>
      </div>

      <div className="plan-state mono">
        Round {pickInfo?.round ?? '–'} · pick {pickInfo?.pickNum ?? '–'}
        {nextPick != null && (
          <>
            {'  ·  '}Next turn at {nextPick}
            {gap != null ? ` · ${gap} ${gap === 1 ? 'pick' : 'picks'} away` : ''}
          </>
        )}
      </div>

      {/* Condensed to one line on purpose: the card is capped at 300px, and a
          two-paragraph warning pushed the recommendation itself out of view.
          The full explanation is on the tooltip, and the import that caused it
          reports the same thing at length. */}
      {coverage?.warnings?.length > 0 && (
        <div className="plan-warning plan-warning--data" title={coverage.warnings.join('\n\n')}>
          Thin data — blocks {coverage.blocks}% of skaters, VORP {coverage.vorp}% of players. Recommendations are
          degraded until these are imported.
        </div>
      )}

      {error && <div className="plan-warning">{error}</div>}

      {!now && quick && (
        <div className="plan-body">
          <div className="takenow__head">
            <PlayerLine player={quick.player} />
            <div className="takenow__value">
              <div className="takenow__value-num mono">{signed2(quick.marginalValue)}</div>
              <div className="takenow__value-unit">cats / week</div>
            </div>
          </div>
          <div className="plan-provisional">{quick.reason} — full two-pick plan still running…</div>
        </div>
      )}

      {!now && !quick && (
        <div className="plan-empty">
          {status === 'building'
            ? 'Reading the player pool…'
            : status === 'error'
              ? 'The plan could not be built.'
              : 'Import a player list and set your draft slot to get a recommendation.'}
        </div>
      )}

      {now && (
        <div className="plan-body">
          <div className="takenow__head">
            <PlayerLine player={now.player} />
            <div className="takenow__value">
              <div className="takenow__value-num mono">{signed2(now.marginalValue)}</div>
              <div className="takenow__value-unit">cats / week</div>
            </div>
          </div>

          {closeCall && now.alternative && (
            <div className="close-call">
              {/* An edge of 0.002 would print as "within 0.00", which reads as
                  a bug rather than a tie. Floor the stated gap at the display
                  precision instead. */}
              <div className="close-call__label">
                Close call — these two are within {num2(Math.max(0.01, edge))} cats/week
              </div>
              <PlayerLine player={now.alternative} />
            </div>
          )}

          <div className="plan-divider" />

          <div className="factors">
            {now.factors.slice(0, 3).map((f) => (
              <div className="factor" key={f.key} style={{ '--factor-color': FACTOR_COLOR[f.key] }}>
                <FactorIcon name={f.key} />
                <div className="factor__text">
                  <div className="factor__label">{f.label}</div>
                  <FactorDetail factor={f} />
                </div>
              </div>
            ))}
          </div>

          <div className="takenow__footer">
            <div className="takenow__market">{marketFactor?.label ?? ''}</div>
            {edge != null &&
              (closeCall ? (
                <div className="edge-pill edge-pill--close">Close call</div>
              ) : (
                <div className="edge-pill">Edge {signed2(edge)}</div>
              ))}
          </div>
        </div>
      )}

      {/* Deliberately outside the scrolling body: the soft goalie policy
          reports on every pick before its min round, so this row is a running
          audit rather than an alarm — but on the rare occasion it turns into a
          warning, a warning you have to scroll to find is not a warning. */}
      {plan?.goalieAudit && (
        <div className={`plan-audit${plan.goalieAudit.costVsTop > 0 ? ' plan-warning plan-warning--goalie' : ''}`}>
          Goalie policy suppressed <strong>{plan.goalieAudit.player?.name}</strong> —{' '}
          {plan.goalieAudit.costVsTop > 0 ? (
            <>
              would have scored {signed2(plan.goalieAudit.costVsTop)} above this pick. Check the goalie VORP
              baseline; the rule is costing you.
            </>
          ) : (
            <>{signed2(plan.goalieAudit.costVsTop)} against this pick, so the rule is free right now.</>
          )}
        </div>
      )}
    </div>
  );
}

export function NextBestPickCard({ plan }) {
  const then = plan?.then ?? null;
  const isTurn = plan?.turn?.kind === 'turn';

  // At the turn the two picks are near back-to-back, so survival between them
  // is ~1 and the question stops being "who" and becomes "in what order".
  // Position bars would be answering a question nobody is asking.
  if (then && isTurn) {
    return (
      <div className="card pick-box">
        <div className="card-title">Then at pick {then.atPick ?? '–'}</div>
        <div className="turn-message">{then.message}</div>
        <div className="plan-note">Plan the position, not the player.</div>
      </div>
    );
  }

  if (!then) {
    return (
      <div className="card pick-box">
        <div className="card-title">Next Best Pick</div>
        <div className="plan-empty">The second-pick forecast appears once the plan has run.</div>
      </div>
    );
  }

  const outlook = Object.entries(then.positionOutlook ?? {})
    .map(([pos, o]) => ({ pos, ...o }))
    .sort((a, b) => b.expectedValue - a.expectedValue)
    .slice(0, 3);
  const headline = then.likelyPosition ? then.positionOutlook?.[then.likelyPosition] : null;

  return (
    <div className="card pick-box">
      <div className="pick-box__head">
        <div className="card-title">Then at pick {then.atPick ?? '–'}</div>
        {headline && <div className="plan-avail mono">{pct(headline.pAnyAvailable)} available</div>}
      </div>

      <div className="then-headline">
        Expect to take <strong>{then.likelyPosition ?? '—'}</strong>
      </div>
      <div className="plan-note">Plan the position, not the player.</div>

      <div className="outlook">
        {outlook.map((o) => (
          <div className="outlook-row" key={o.pos}>
            <div className="outlook-row__pos mono">{o.pos}</div>
            <div className="outlook-row__track">
              <div className="outlook-row__fill" style={{ width: `${Math.round(o.pAnyAvailable * 100)}%` }} />
            </div>
            <div className="outlook-row__value mono">{num2(o.expectedValue)}</div>
          </div>
        ))}
      </div>

      {/* Names carry a probability and never stand alone. The survival model
          cannot know who lasts twenty picks, and one confidently wrong name
          costs the panel every bit of trust the rest of it earned. */}
      <div className="chips">
        {then.candidates?.slice(0, 5).map((c) => (
          <div className="chip" key={c.player?.name}>
            {c.player?.name} <span className="chip__pct mono">{pct(c.probBestAvailable)}</span>
          </div>
        ))}
        {!then.candidates?.length && <div className="plan-empty">No candidate has a clear shot at surviving.</div>}
      </div>
    </div>
  );
}
