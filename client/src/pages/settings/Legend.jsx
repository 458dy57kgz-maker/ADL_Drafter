import '../../components/DraftBoard.css';
import './Legend.css';

// Every sample below is wrapped in a .draft-board / .war-room element so it
// picks up the real component styles rather than a copy of them. If a chip
// changes colour on the board, it changes here too — a legend that can drift
// out of step with the thing it explains is worse than none.

function Row({ sample, children }) {
  return (
    <div className="legend-row">
      <div className="legend-row__sample">{sample}</div>
      <div className="legend-row__text">{children}</div>
    </div>
  );
}

export default function Legend() {
  return (
    <div className="legend-page">
      <div className="settings-section-title" style={{ marginBottom: 6 }}>
        Legend
      </div>
      <div className="card-subtitle" style={{ marginBottom: 16 }}>
        What every colour and chip in the app means. This used to sit under the board on the War Room, where it cost
        a row of players to say things you only need to read once.
      </div>

      <div className="card legend-card">
        <div className="card-title">Best Available — will he last?</div>
        <div className="card-subtitle">
          Every card answers one question: if you don’t take him now, will he still be there at your next pick? The
          chip compares his ADP against the gap between this pick and your next one.
        </div>
        <div className="draft-board">
          <Row sample={<span className="wait-chip value">Already overdue</span>}>
            His ADP has <strong>already passed</strong> — the room let him fall. A value signal, not a warning, which
            is why it’s gold rather than red. The card gets a gold border and a <span className="mono">★ VALUE</span>{' '}
            badge, and it keeps them even when that position is full on your roster: bench and trade value are still
            value.
          </Row>
          <Row sample={<span className="wait-chip danger">Likely gone</span>}>
            His ADP falls <strong>between now and your next pick</strong>. If you want him, this is the pick.
          </Row>
          <Row sample={<span className="wait-chip risk">Wait = risky</span>}>
            His ADP is just past your next pick — inside half the gap again. Often survives, sometimes doesn’t.
          </Row>
          <Row sample={<span className="wait-chip safe">Safe to wait</span>}>
            Real room past your next pick. Take someone else and come back to him.
          </Row>
          <Row sample={<span className="plain-card-sample" />}>
            A <strong>green border</strong> marks the top card at a position you still have a starting slot for.
            It’s a nudge, not a recommendation — the whole board is there so the call stays yours.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Reading a column</div>
        <div className="draft-board">
          <Row
            sample={
              <span className="left-ring" style={{ '--pct': 40, '--ring-color': '#f2c34d' }}>
                <span className="left-ring__inner">
                  <span className="left-ring__num mono">6</span>
                  <span className="left-ring__label">LEFT</span>
                </span>
              </span>
            }
          >
            How many players you rated at that position are still undrafted, and the ring drains as they go. Green
            above 7, amber at 4–7, red at 3 or fewer.
          </Row>
          <Row
            sample={
              <span className="legend-pills">
                <span className="mini-pill t2">6 T2</span>
                <span className="mini-pill t3">12 T3</span>
              </span>
            }
          >
            How many are left in each tier — the two shallowest tiers that still have anyone in them. A tier you’ve
            exhausted disappears and the next one takes its place, so these always describe what you can still get.
            Tiers are yours: set them in the import or the Players grid.
          </Row>
          <Row
            sample={
              <span className="cliff legend-cliff">
                <span className="line" />
                <span className="label">TALENT CLIFF</span>
                <span className="line" />
              </span>
            }
          >
            Below this line the tier drops and there are two or fewer left above it. Reaching past a cliff costs less
            than reaching after one.
          </Row>
          <Row sample={<span className="tier-chip t1">T1</span>}>
            The player’s own tier. Gold is your best tier, then silver, then bronze for anything third or deeper.
          </Row>
          <Row
            sample={
              <span className="legend-pills">
                <span className="cat-tag">65 A</span>
                <span className="cat-tag">24 PPP</span>
              </span>
            }
          >
            The two categories this player moves furthest from the middle — measured against others at{' '}
            <strong>his own position</strong>, so a defenceman’s shot total isn’t judged against a winger’s.
          </Row>
          <Row sample={<span className="ong high">ONG 46%</span>}>
            Share of his games on off-nights, when fewer teams play and a start is worth more. Green above 44%. Absent
            entirely when the data isn’t there, rather than shown as a made-up 0%.
          </Row>
          <Row sample={<span className="adp-line">ADP <span className="adp-num">71</span> · you 58</span>}>
            Where the market takes him, then where you rank him. On an overdue card the second half becomes how many
            picks ago his ADP passed.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Target Progress</div>
        <div className="war-room">
          <Row
            sample={
              <span className="target-ring legend-ring" style={{ '--pct': 62 }}>
                <span className="target-ring__inner mono">186</span>
              </span>
            }
          >
            Your running total in that category, filling toward your season target. Hover for the target itself.
          </Row>
          <Row sample={<span className="legend-leader mono">Mike’s Team 214</span>}>
            Underneath each ring: whoever leads that category right now, so the number you read is “am I ahead in this
            room”, not just “am I on pace”. Gold when the leader is you.
          </Row>
          <Row sample={<span className="legend-overall mono">76%</span>}>
            <strong>Overall</strong> on the right is the average of your seven category percentages, each capped at
            100 first so one runaway category can’t hide six empty ones.
          </Row>
          <Row sample={<span className="legend-bench">75%</span>}>
            Bench players count at three quarters toward every manager’s totals, yours included — they cover injuries
            and off nights, but they aren’t in the lineup every week.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Elsewhere</div>
        <Row sample={<span className="legend-diff legend-diff--good">-1.5</span>}>
          <strong>Diff</strong> in the Players grid: how far your rank sits from the market’s, in rounds. Green is
          the bargain direction — you can get your own #5 at pick 20. Red means he goes before you’d ever want him.
        </Row>
        <Row sample={<span className="roster-row__untracked">no stats</span>}>
          A player the room drafted who isn’t in your list. The name and roster spot are real; there are no
          projections for him, so his stat columns are dashes and he contributes nothing to anyone’s targets.
        </Row>
        <Row sample={<span className="legend-blank">(before feed started)</span>}>
          A pick that happened before the live feed was running. The slot is held open so pick numbering stays
          honest; the player taken in it is still in your pool. Fill it in with Manual Draft Mode (Shift+S) if you
          want it counted.
        </Row>
      </div>
    </div>
  );
}
