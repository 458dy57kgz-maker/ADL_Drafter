# Handoff: Draft Urgency Row (fantasy hockey draft)

## Overview
A live widget for a fantasy hockey draft room. One horizontal row of 10 player cards (10 = number of teams in the league). Each card counts down the picks remaining until the **current draft pick** reaches (a) **my rank** for that player (ME) and (b) the player's **average draft position** (AV). Urgency builds visually as the pick gets closer and flips to red once it reaches or passes each number. Players drafted by other teams are locked with an overlay that shows who took them. Under the cards, a slim **team carousel** shows the next 10 picks in snake order, sliding left on every pick. The team on the clock sits at the far left.

Target file in the prototype: section **2a** in `Draft Urgency Widgets.dc.html`. Sections 1a–1c are earlier explorations; ignore them.

## About the design files
The files in this bundle are **design references built in HTML**. They are prototypes that show the intended look and behavior, not production code to copy. The task is to **recreate this design in the existing app**, using its framework, component patterns, state management and styling approach. The prototype fakes the draft (a timer advances the pick; draft results are hard-coded). In the app, connect everything to the real draft state.

## Fidelity
**High fidelity.** Colors, type, spacing, states and motion are final. If the app already has design tokens, map the values below to the nearest existing tokens. Keep the zero corner radius and the 2px ink rules.

---

## Data model (inputs)
```ts
type Player = {
  id: string;
  firstName: string;
  lastName: string;
  pos: 'C' | 'LW' | 'RW' | 'D' | 'G';
  myRank: number;      // ME — my own ranking (overall pick number I value him at)
  adp: number;         // AV — average draft position
  draftedAt?: number;  // overall pick number he was taken at (undefined = available)
  draftedBy?: string;  // team name
};

type DraftState = {
  currentPick: number;       // overall pick number on the clock (1-based)
  teams: string[];           // draft order for round 1, length = teamCount (10)
  myTeam: string;
  removedIds: Set<string>;   // players the user dismissed manually
};
```
Snake order: for overall pick `k`, `round = floor((k-1)/teamCount)`, `i = (k-1) % teamCount`, team = `teams[round % 2 ? teamCount-1-i : i]`.

## Derived values (per player)
- `dME = myRank - currentPick`
- `dAV = adp - currentPick`
- `dMin = min(dME, dAV)`

**Numeral text** for d: `d > 0` → `"d"`; `d === 0` → `"0"`; `d < 0` → `"+|d|"` (picks past).

**Tone** (pip fill color) for d:
| d | color |
|---|---|
| > 15 | neutral-500 `#9b9797` |
| 6–15 | accent-400 `#ff9783` |
| 1–5 | accent `#ec3013` |
| 0 | accent-700 `#ae1800` |
| < 0 | accent-900 `#4d170e` |

**Pip count** (10-pip fuse per cell): lit = `clamp(10 - d, 0, 10)`. Pips light left→right in the last 10 picks. Unlit pips are neutral-300 `#d7d3d3`.

**Cell fill** (ME / AV cell backgrounds):
- `d < 0` → bg accent `#ec3013`, text `#f3f2f2`
- `d === 0` → bg accent-700 `#ae1800`, text `#f3f2f2`
- else → transparent, text ink `#201e1d`

**Card background** (optional tint, on by default):
- `dMin < 0` → accent-200 `#ffe0d9`
- `dMin <= 5` → accent-100 `#fff2ef`
- else → bg `#f3f2f2`

## Which 10 players are shown
From my target list sorted by `myRank` ascending, take the first 10 that pass all of these:
1. not in `removedIds`
2. if drafted: `currentPick < draftedAt + 5` (drafted players stay visible for 5 picks, then drop off automatically)
3. if not drafted: `max(myRank, adp) - currentPick > -teamCount` (hide undrafted players who are more than a full round past both numbers)

As players drop off the left, the next target fills in on the right.

---

## Layout

### Row container
- Width: fills the draft-room column (prototype: 1112px). CSS grid, `grid-template-columns: repeat(10, minmax(0, 1fr))`, `gap: 2px`.
- Container `background: rgba(32,30,29,0.4)` (divider color, shows through the gaps as the 2px rules) and `border: 2px solid #201e1d`.
- Card height is about 110px (content-driven). Don't let it grow more than 30% beyond that.

### Player card (each grid cell)
`position: relative; display: flex; flex-direction: column; min-width: 0; background: <card bg>; transition: background .4s`

1. **Header**, padding `8px 6px 6px 8px`, column, gap 1px
   - Row: last name + copy button, `display:flex; align-items:center; gap:2px`
     - Last name: Archivo 700, 13px, line-height 1.2. Single line, ellipsis (`flex:1; min-width:0`).
     - **Copy button**: 20×20, transparent, no border, color neutral-700 `#605d5d`. Hover: bg neutral-200 `#eae7e7`, color ink. Icon: Lucide `copy`, 12px, stroke 2. On click, copy the **full name** (`"First Last"`) to the clipboard and swap the icon to Lucide `check` (stroke 2.5, color accent-700) for 1200ms.
   - Sub line: `First · POS`, 10px, neutral-700. The first name is truncated with an ellipsis; `· POS` never truncates (`flex:none`).
2. **Twin cells**: `display:grid; grid-template-columns:1fr 1fr; border-top:2px solid #201e1d; flex:1`
   - Each cell: padding `6px 5px 7px`, column, gap 4px, `min-width:0`, bg/text per "Cell fill", `transition: background .4s`. The left cell has `border-right:2px solid #201e1d`.
   - Label: 10px, uppercase, letter-spacing .04em, nowrap. Copy: `ME: {myRank}` (left) and `AV: {adp}` (right).
   - Numeral: Archivo 800, 20px, line-height 1, `font-variant-numeric: tabular-nums`, nowrap. Shows the picks remaining (see "Numeral text").
   - Pips: grid of 10 equal columns, gap 1px, each 5px tall, `transition: background .3s`.

### Drafted overlay (when `draftedAt <= currentPick`)
Absolute, `inset:0`, background neutral-200 at 97% (`color-mix(in srgb, #eae7e7 97%, transparent)`), padding 8px, column, gap 4px, `cursor: not-allowed`. It blocks interaction with the card underneath.
1. Top row, `justify-content: space-between`:
   - Tag `DRAFTED`: bg ink `#201e1d`, text `#f3f2f2`, 10px, 800 weight, letter-spacing .08em, padding `2px 5px`.
   - **Remove button**: 24×24, 1px border divider, bg `#f3f2f2`, Lucide `x` 12px, stroke 2.5. Hover: bg accent, text bg, border accent. Click adds the player to `removedIds` right away.
2. Name block (line-height 1.2): last name 12px/700 ink, then first name 10px neutral-800. Both single line with ellipsis.
3. Team: `→ {draftedBy}`, 11px/600, neutral-900 `#2d2b2b`, single line with ellipsis (never wraps).
4. Pinned to the bottom (`margin-top:auto`), 10px, line-height 1.3, tabular numbers, nowrap:
   - `Pick {draftedAt}`: 800 weight, ink
   - `AV {adp} · ME {myRank}`: neutral-800
   Purpose: lets the user compare where opponents actually took a player against ADP and their own rank.

### Team carousel (directly under the row)
- Sits flush under the card row: same outer width, `border: 2px solid #201e1d; border-top: 0; overflow: hidden; background: #f3f2f2`.
- Inner track: `display:flex; width:110%`. It holds **11 cells**, one for each pick from `currentPick-1` to `currentPick+9`. Each cell is `flex: 0 0 calc(100%/11)`, so every cell is exactly 1/10 of the visible width and lines up with the card columns above.
- At rest the track is `transform: translateX(-9.0909%)` (one cell), so the visible cells are `currentPick`…`currentPick+9`.
- Cell: padding `5px 8px`, `border-right:2px solid rgba(32,30,29,.4)`, column, line-height 1.25, `transition: background .3s`.
  - Top label, 10px uppercase, letter-spacing .04em: `On the clock` when k === currentPick, otherwise `Pick {k}`.
  - Team name, 11px/700, single line with ellipsis. Show `You` when the team is `myTeam`.
  - Colors: my team → bg accent `#ec3013`, text `#f3f2f2`. On the clock (not mine) → bg ink `#201e1d`, text `#f3f2f2`. Otherwise → bg `#f3f2f2`, label neutral-700, name ink. If it's my turn, my-team red wins.
  - Picks < 1 render as empty cells.

---

## Interactions & motion
- **Pick advance (+1)**: in one frame, render the track with `translateX(0)` and `transition: none`. Cell 0 is now the previous pick, so nothing appears to move. On the next animation frame (use a double rAF), set `translateX(-9.0909%)` with `transition: transform .45s cubic-bezier(.3,.7,.3,1)`. The row appears to slide left by one team. For jumps of more than one pick (reconnect, scrubbing), snap with no animation.
- Card and cell backgrounds cross-fade over .4s and pips over .3s, so urgency color changes animate rather than flash.
- Copy button: clipboard write plus a 1.2s check-mark confirmation.
- Remove button on the drafted overlay: removes the player immediately and the list refills from the right.
- Auto-removal: a drafted player disappears when `currentPick >= draftedAt + 5`.
- Keyboard focus on both buttons: `outline: 2px solid #ec3013; outline-offset: 2px`. No browser-default focus ring.

## State
- From the app's draft source: `currentPick`, `draftedAt`/`draftedBy` per player, team order, `myTeam`.
- Local UI state: `removedIds` (persist per draft if the app supports it), `copiedId` (with a timeout), and the carousel's `slide` flag, which drives the one-frame reset described above.
- The prototype's play/pause, speed and scrubber controls are demo-only. Don't build them.

## Design tokens (Modernist)
- Font: **Archivo** (headings 800, body 400/600/700). Zero border radius everywhere.
- Ground `#f3f2f2` · surface `#eae9e9` · ink `#201e1d` · divider `rgba(32,30,29,0.4)`
- Accent ramp: 100 `#fff2ef`, 200 `#ffe0d9`, 300 `#ffc4b8`, 400 `#ff9783`, 500 `#ff563c`, base `#ec3013`, 600 `#dd2b0f`, 700 `#ae1800`, 800 `#7c1405`, 900 `#4d170e`
- Neutral ramp: 100 `#f8f4f4`, 200 `#eae7e7`, 300 `#d7d3d3`, 400 `#bab6b6`, 500 `#9b9797`, 600 `#7d7979`, 700 `#605d5d`, 800 `#444141`, 900 `#2d2b2b`
- Rules: 2px solid ink for the outer frame and cell separators. The 2px gaps between cards use the divider color.
- Full token sheet: `styles.css` in this folder.

## Assets
Icons are from Lucide (`copy`, `check`, `x`), drawn as inline SVG with `stroke="currentColor"`, round caps and joins. Use the app's existing Lucide package if it has one (e.g. `lucide-react`). No images.

## Files
- `Draft Urgency Widgets.dc.html`: the prototype. Section **2a** is the target. Open it in a browser alongside `support.js`. All logic is in the `class Component` script at the bottom of the file (`renderVals()`, `teamFor()`, `componentDidUpdate` for the carousel slide).
- `support.js`: the prototype runtime (reference only).
- `styles.css`: the Modernist token sheet the prototype uses.
