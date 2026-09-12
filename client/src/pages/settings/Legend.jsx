import { CopyIcon } from '../../components/DraftBoard.jsx';
import '../../components/DraftBoard.css';
import '../WarRoom.css';
import './Legend.css';

// Every sample below uses the War Room's own class names, so it picks up the
// real styles rather than a copy of them. If a colour changes on the board,
// it changes here too — a legend that can drift out of step with the thing
// it explains is worse than none.

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
        What every mark on the War Room means. Red is spent on exactly three things — a player worth taking, the
        talent cliff, and a category you’re losing — so anything red is worth a look.
      </div>

      <div className="card legend-card">
        <div className="card-title">Best Available — is he worth it?</div>
        <div className="card-subtitle">
          Every row crosses two readings. <strong>Price</strong> is your own rank against his ADP: what he’d cost you
          against what he’s worth to you. <strong>Availability</strong> is whether he lasts to your next pick. The
          board only raises its voice where the two agree there’s something to do.
        </div>
        <div className="draft-board draft-board--legend">
          <Row
            sample={
              <span className="legend-gutter">
                <span className="bcard__price bcard__price--good bcard__price--strong">-1.8</span>
                <span className="bcard__price-label">RD</span>
              </span>
            }
          >
            The price gutter, in rounds. A <strong>negative</strong> number is the bargain direction — you rate him
            nearly two rounds above where the room takes him. It decides whether chasing a player is worth it at all,
            so it gets the biggest type on the board. Nothing is printed inside half a round: that close, you and the
            room agree, and a mark would be noise.
          </Row>
          <Row
            sample={
              <span className="legend-gutter">
                <span className="bcard__price bcard__price--bad bcard__price--strong">+1.3</span>
                <span className="bcard__price-label">RD</span>
              </span>
            }
          >
            A <strong>positive</strong> number means the room takes him earlier than you’d ever want him. Printed
            faint on purpose — this is the direction that costs you picks, so it recedes rather than competes.
          </Row>
          <Row sample={<span className="bcard__wait bcard__wait--lastcall">TAKE HIM</span>}>
            The board’s answer for the pick you are making <strong>right now</strong>: your best-ranked player who
            wouldn’t survive until your next turn. Only ever one player carries it.
          </Row>
          <Row sample={<span className="bcard__wait bcard__wait--takeat">TAKE AT 41</span>}>
            The plan spends that later pick of yours on him. Each of your upcoming picks is handed to exactly one
            player, best-ranked first and most endangered first — so at a back-to-back 40 and 41 the man who’d be
            gone goes at 40 and the one who keeps goes at 41. Two players can never both claim 41.
          </Row>
          <Row sample={<span className="bcard__wait bcard__wait--letgo">LET HIM GO</span>}>
            There is <strong>no pick of yours</strong> at which he is both available and worth his price — the room
            bids past you before you’d want him, so the row fades back. This is the one the board used to get wrong,
            shouting LIKELY GONE at a player you had ranked more than a round below his market price.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Best Available — will he last?</div>
        <div className="card-subtitle">
          A player the plan didn’t choose falls back to a plain statement of fact rather than an instruction — either
          somebody better is already taking that pick, or he isn’t reachable. It makes no claim about whether he’s
          worth taking; that’s the price gutter’s job.
        </div>
        <div className="draft-board draft-board--legend">
          <Row sample={<span className="bcard__wait bcard__wait--gone">LIKELY GONE</span>}>
            His ADP falls <strong>at or before your next pick</strong>, so he probably won’t reach you — worth knowing
            for anyone you were counting on. It never lands on the player you should actually be taking: if he’s still
            on the board when your pick arrives, he reads TAKE HIM instead.
          </Row>
          <Row sample={<span className="bcard__wait bcard__wait--risky">WAIT = RISKY</span>}>
            His ADP is up to half a round past your next pick. Often survives, sometimes doesn’t. Half a round, not
            half the gap to your turn: a player’s ADP doesn’t get less certain because your seat is at the turn of the
            snake.
          </Row>
          <Row sample={<span className="bcard__wait bcard__wait--safe">SAFE TO WAIT</span>}>
            Real room past your next pick. The whole row fades back, since these are the players not to spend this
            pick on.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Reading a column</div>
        <div className="draft-board draft-board--legend">
          <Row
            sample={
              <span className="legend-inline">
                <span className="bcol__left bcol__left--low">6</span>
                <span className="bcol__left-label">LEFT</span>
              </span>
            }
          >
            How many players you rated at that position are still undrafted. Red at 7 or fewer.
          </Row>
          <Row sample={<span className="bcol__tiers">1 T1 · 4 T2 left</span>}>
            How many are left in the two shallowest tiers that still have anyone in them. An exhausted tier drops off
            and the next one takes its place. <strong>· full</strong> on the end means your starting seats at that
            position are filled. Tiers are yours: set them in the import or the Players grid.
          </Row>
          <Row sample={<span className="bcard-cliff legend-cliff" />}>
            The talent cliff. Below this rule the tier drops and there are two or fewer left above it. Reaching past a
            cliff costs less than reaching after one.
          </Row>
          <Row sample={<span className="bcard__rank">#21</span>}>
            Your own overall rank for him, under the gutter.
          </Row>
          <Row sample={<span className="bcard__tier">T2</span>}>His tier.</Row>
          <Row sample={<span className="bcard__cats">{'30G   24PPP'}</span>}>
            The two categories he moves furthest from the middle — measured against others at{' '}
            <strong>his own position</strong>, so a defenceman’s shot total isn’t judged against a winger’s.
          </Row>
          <Row sample={<span className="bcard__ong">ONG 46%</span>}>
            Share of his games on off-nights, when fewer teams play and a start is worth more. Only printed at 44% and
            up — below that it’s noise, so it isn’t shown at all rather than shown quietly.
          </Row>
          <Row sample={<span className="bcard__adp">ADP 71</span>}>Where the market takes him.</Row>
          <Row
            sample={
              <span className="legend-inline">
                <span className="bcard__copy">
                  <CopyIcon />
                </span>
                <span className="bcard__copy bcard__copy--done">
                  <CopyIcon done />
                </span>
              </span>
            }
          >
            Copies the player’s name so it can be pasted straight into Yahoo’s draft search. It turns into a check for
            three seconds once the copy lands.
          </Row>
        </div>
      </div>

      <div className="card legend-card">
        <div className="card-title">Season Totals</div>
        <Row
          sample={
            <span className="totals__ring" style={{ background: 'conic-gradient(var(--accent) 38%, var(--track-bg) 0)' }}>
              <span className="totals__ring-inner legend-ring-inner">186</span>
            </span>
          }
        >
          Your running total in that category; the ring fills toward your season target. It turns red when you’re
          under 65% of whoever leads that category — on pace and winning are different questions.
        </Row>
        <Row
          sample={
            <span className="legend-stack">
              <span className="totals__pct totals__pct--losing">58% of leader</span>
              <span className="totals__pct">you lead</span>
            </span>
          }
        >
          Your total as a share of the room’s leader in that category. Hover a ring to see who the leader is and their
          number.
        </Row>
        <Row
          sample={
            <span className="totals__ring" style={{ background: 'conic-gradient(var(--text-primary) 76%, var(--track-bg) 0)' }}>
              <span className="totals__ring-inner legend-ring-inner">76%</span>
            </span>
          }
        >
          <strong>Overall</strong> is the average of your seven category percentages, each capped at 100 first so one
          runaway category can’t hide six empty ones.
        </Row>
        <Row sample={<span className="legend-bench">75%</span>}>
          Bench players count at three quarters toward every manager’s totals, yours included — they cover injuries
          and off nights, but they aren’t in the lineup every week.
        </Row>
      </div>

      <div className="card legend-card">
        <div className="card-title">My Roster and Live Picks</div>
        <Row sample={<span className="wr-roster__num wr-roster__num--hot">47%</span>}>
          ONG in your roster: red at 44% and up, the same line the board uses.
        </Row>
        <Row sample={<span className="wr-roster__nostats">NO STATS</span>}>
          A player the room drafted who isn’t in your list. The name and roster spot are real; there are no
          projections for him, so his numbers are dashes and he contributes nothing to anyone’s totals.
        </Row>
        <Row sample={<span className="legend-shade">#48 Five Hole —</span>}>
          Shaded rows at the top of Live Picks are the picks still to come before yours.
        </Row>
        <Row sample={<span className="legend-blank">(before feed started)</span>}>
          A pick that happened before the live feed was running. The slot is held open so pick numbering stays
          honest; the player taken in it is still in your pool. Fill it in with Manual Draft Mode (Shift+S) if you
          want it counted.
        </Row>
      </div>

      <div className="card legend-card">
        <div className="card-title">Players grid</div>
        <Row sample={<span className="legend-diff legend-diff--good">-1.5</span>}>
          <strong>Diff</strong>: how far your rank sits from the market’s, in rounds — the same number the board’s
          price gutter prints. A negative number is the bargain direction — you can get your own #5 at pick 20. A
          positive one means he goes before you’d ever want him.
        </Row>
        <Row sample={<span className="legend-diff legend-diff--bad">+1.3</span>}>
          The grid colours Diff the way a data table should, red for the costly direction. The board colours it the
          other way round on purpose: red there means “look at this”, and on draft night the thing worth looking at
          is a bargain.
        </Row>
      </div>
    </div>
  );
}
