# Handoff: Fantasy Hockey Draft Assistant

## Overview
A draft-night companion app for a Yahoo Fantasy Hockey league. It shows a live "War Room" dashboard during the draft (best available players by position, roster progress, position scarcity, live pick feed), a full sortable/filterable/editable player data grid, and a Settings area covering Yahoo OAuth connection, league config, roster structure, rankings import/matching, draft-day behavior, and a debug log. The app polls Yahoo's API read-only — the actual draft pick happens in Yahoo's own app/site; this tool is a decision-support sidekick.

## About the Design Files
The files in this bundle are **design references built in HTML** — interactive prototypes showing intended look, layout, and behavior, using fake/generated data. They are not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, native, etc.), using its established patterns, component library, state management, and data layer — or, if no environment exists yet, choose the most appropriate stack and implement fresh.

## Fidelity
Mixed:
- **`Fantasy Hockey Draft Assistant.dc.html` is high-fidelity.** Real dark theme, exact colors/type/spacing, working interactions (tab nav, filters, sort, tier editing, settings toggles) — recreate pixel-for-pixel using the codebase's component/styling conventions.
- **`War Room Wireframes.dc.html`, `Data Grid Wireframes.dc.html`, `Settings Wireframes.dc.html` are low-fidelity** — sketch-style option explorations from the design process (hand-drawn look, placeholder "Player A/B/C" names). They exist only to show layout alternatives that were considered; the finally-chosen layout for each area is fully realized in the hi-fi file. Use the wireframes just for extra structural/behavioral context if the hi-fi file is ambiguous — style comes only from the hi-fi file.

## Screens / Views
The hi-fi file is a single-page app with a persistent left icon-rail nav (84px wide) switching between three tabs: **War Room**, **Players**, **Settings**.

### Left Nav Rail
- Width 84px, background `#0e1114`, right border `1px solid rgba(255,255,255,0.07)`, padding `16px 0`, vertical flex, `gap:6px`.
- Logo chip: 40×40px, `border-radius:9px`, background `#e0603f`, "FH" text, 800 weight 15px Inter, color `#0a0c0f`.
- 3 nav items (War Room / Players / Settings), each 64px wide, icon 26×26px + 10px label below. Icon shapes distinguish sections: War Room = rounded-square, Players = circle, Settings = diamond (rotated square).
- Active state: item background `#1a1e23`, icon background `#e0603f`, label color `#e8eaed`. Inactive: icon background `#2a2f36`, label color `#5a6068`.

### 1. War Room (default tab)
**Purpose**: Real-time draft dashboard consulted during a live Yahoo draft.

**Layout**: Column flex, full height.
- **Header bar** (padding `14px 22px`, border-bottom, bg `#0e1114`): left group has "PICK {n}" chip (bg `#e0603f`, text `#0a0c0f`, 800/26px JetBrains Mono, `151×44px`, `border-radius:8px`), "Round {n}" label (600/15px Inter, `#c7cbd1`), and a pill "{n} picks until you" (bg `#1a1e23`, border `1px solid rgba(255,255,255,0.1)`, `border-radius:20px`, text `#f2c34d` 700/14px). Right group: green-dot "Yahoo connected" status (dot `#3fa66b`), and a "poll 8s" mono chip.
- **Best Available strip**: label "BEST AVAILABLE — NEXT PER POSITION" (12px uppercase, `#8b929c`, letter-spacing 0.06em). 5-column grid (`repeat(5,1fr)`, gap 12px) — one card per position (C/LW/RW/D/G). Each card: bg `#14171b`, border `1px solid rgba(255,255,255,0.08)`, `border-radius:10px`, padding 12px, min-height 230px. Card header = position label (800/15px) + a "scarcity" pill showing "{n} left" color-coded green/amber/red by scarcity threshold (≤3 red, ≤7 amber, else green — see Design Tokens). Below: up to 3(+) player rows, each: name (600/12.5px) + stat contribution text (600/10.5px JetBrains Mono, e.g. "+22G +6PPP"), a rank badge "#{overallRank}" color-coded by how far the player's rank is from the current pick (see rank-delta gradient below), and a star toggle (☆/★) to track the player. A "+N more" expander reveals 2 more rows at a time.
- **Bottom 3-column grid** (`1.15fr 0.9fr 1fr`, gap 14px, fills remaining height):
  1. **My Roster** card — grid table of roster slots (SLOT / PLAYER / G / A / P / PPP / +/- / SH), filled or "empty" placeholder rows, plus a "Bench x{n} · IR x{n} — empty" footer line.
  2. **Target Progress** card — one row per stat goal (Goals, Assists, PPP, +/-, Shots, Wins, Saves): label + "{current} / {goal}" (JetBrains Mono) + a 6px-tall progress bar (track `#1e2226`, fill `#e0603f`).
  3. **Right column**, stacked: **Position Scarcity** (per-position row: pos label, "{n} left" pill, taken-progress bar in `#3a3f46`, "{n} taken" text), **Live Pick Feed** (reverse-chron rows "#{pick} {team} → {player} ({pos})"), **Tracked Players** (name — pos, plus status "Still available" (green `#7fd9a3`) or "Taken by {team}" (red `#e8837a`)).

### 2. Players (full data grid)
**Purpose**: Full sortable/filterable/editable player database — the "spreadsheet" view behind the War Room summaries.

**Layout**: Column flex, padding `20px 24px`.
- Header row: title "Players — Full Data" (700/18px), right-aligned "Manage Columns" (secondary button) and "Save" (primary, bg `#e0603f`, text `#0a0c0f`).
- Filter bar: pill-shaped selects for Position (All/C/LW/RW/D/G) and Drafted (hide/show), a search input ("Search player…"), and a "{n} players shown" counter.
- Data table (sticky header, scrollable body, wrapped in bordered rounded container): columns Name, Pos, Team, Rank, ADP, Tier (editable number input, highlighted amber `#221c14` bg/`#f2c34d` text), G, A, P, PPP, +/-, Sh, W/GAA/SV (goalies only), Status (drafted state — "You" in gold, team name in gray, "Available" in green). Header cells are clickable to sort (▲/▼ glyph appended). Zebra striping via faint row background alternation.

### 3. Settings
**Purpose**: Configuration for Yahoo OAuth, league, roster, rankings import, draft-day polling behavior, hosting, and a debug log.

**Layout**: Left sidebar (230px, bg `#0e1114`) listing 7 sections; content area (flex:1, padding `24px 30px`, max-width varies 480–760px per section) shows the selected section only.

Sidebar items: Yahoo Connection, League, Roster, Rankings Import, Draft-Day Behavior, App / Hosting, Debug Log. Active item: bg `#1a1e23`, text `#e8eaed`; inactive text `#8b929c`.

Section content (each in `#14171b` bordered cards, `border-radius:10px`, padding 16px):
- **Yahoo Connection**: header with green "Connected as {username}" pill. "Token Health" card (last call, auto-refresh status, token expiry, "Reconnect" button). "Guided Setup" card: Step 1 Client ID/Secret inputs (Client Secret is `type=password`); Step 2 connection-mode picker — two selectable option cards ("I have a domain/reverse proxy" vs "No public HTTPS" paste-code fallback), selected card gets accent border `#e0603f` + bg `#221c14`; a redirect-URI readout row with a Copy button.
- **League**: League ID, Season (with Refresh button), Team count, "My team" select, and a full-width accent "Start New Season" button.
- **Roster**: "Slots per Position" card — one numeric input per slot type (C/LW/RW/D/G/BENCH/IR). "Targets" card — one numeric input per season-goal stat (feeds the War Room Target Progress bars).
- **Rankings Import**: CSV/Google-Sheet upload card with column-mapping note. Alias/Exceptions table (name-correction mappings) with "+ Add Row". "Unmatched at import" card with a red count badge and per-row fuzzy-match suggestions (✓ accept / ✗ reject).
- **Draft-Day Behavior**: Polling-interval range slider (5–60s). Draft-start-detection segmented toggle (Auto-detect vs Manual "Go Live"). Two notification checkboxes (Sound, Desktop).
- **App / Hosting**: Leagues select + "+ Add League"; Timezone select; Data actions "Export All" and destructive "Reset App" (red-tinted button, bg `#2a1414`, text `#e8837a`).
- **Debug Log**: green "All systems ok" status pill. Filter chips (All / Errors / Yahoo calls) — active chip bg `#e0603f`/text `#0a0c0f`. "Clear" / "Copy Log" buttons. Log rows (monospace): timestamp, message, status (OK green / ERROR red); error rows get a faint red row tint.

## Interactions & Behavior
- **Nav**: clicking a rail item swaps the visible tab (no transition/animation specified — instant swap).
- **War Room**: star icon toggles a player's "tracked" state, adding/removing them from the Tracked Players list. "+N more" expands each position lane by 2 rows at a time (no collapse control shown).
- **Players grid**: Position/Drafted selects and the search box filter rows live. Clicking a column header toggles sort (ascending → descending → ascending), with only one sort column active at a time. Tier is the only editable stat column — a number input per row.
- **Settings — Yahoo Connection**: clicking a connection-mode card selects it (single-select, visually highlighted) and swaps the redirect-URI text shown below.
- **Settings — Roster/Targets**: all numeric fields are plain number inputs, committed on change.
- **Settings — Draft-Day**: slider updates a live "{n}s" readout next to its label. Auto-detect/Manual is a 2-way segmented toggle. Checkboxes toggle independently.
- **Settings — Debug Log**: filter chips narrow the row list by type (all/error/yahoo); Clear/Copy buttons are visual-only in the prototype (no wired behavior beyond potential log clearing).
- No modal, loading, or error states beyond what's described above (e.g. the amber "unmatched" rows in Rankings Import) are designed — implement sensible equivalents using the target codebase's existing patterns when wiring real behavior (loading a slow Yahoo call, a failed save, etc).
- Not responsive — designed as a fixed desktop-density app (assume desktop web or a desktop-class window). No breakpoints were designed for mobile.

## State Management
Reference implementation state shape (see `Fantasy Hockey Draft Assistant.dc.html`'s logic class), to guide what a real data layer needs to support:
- `tab`: 'warroom' | 'players' | 'settings'
- `settingsSection`: which settings sub-page is shown
- `players`: full player list — id, name, pos, team, rank, adp, tier, per-position stats (skaters: g/a/p/ppp/plusMinus/shots; goalies: w/gaa/saves), `drafted`/`draftedBy`, `mine`, `tracked`
- `expandedPos`: per-position "how many rows shown" count for the Best Available lanes
- `connectionMode`: 'proxy' | 'pastecode' (Yahoo OAuth redirect strategy)
- `rosterSlots`: counts per slot type (C/LW/RW/D/G/BENCH/IR)
- `targets`: season-end stat goals (goals/assists/ppp/plusMinus/shots/wins/saves)
- `pollInterval`: seconds between Yahoo draft-state polls
- `draftMode`: 'auto' | 'manual' (how draft-start is detected)
- `notifSound` / `notifDesktop`: booleans
- `debugFilter`: 'all' | 'error' | 'yahoo'
- Players-grid state: `gridPosFilter`, `gridSearch`, `gridSort` ({col, dir}), `gridDraftedFilter`

Real data requirements: Yahoo Fantasy Sports API (OAuth2) for league, roster, and live draft-pick polling; a rankings source (user-uploaded CSV / Google Sheet) with a persisted name-alias table for fuzzy matching Yahoo's player names against imported rankings.

## Design Tokens

### Colors (hi-fi app — dark theme)
- Background (app): `#0a0c0f`
- Background (panels/rail): `#0e1114`
- Background (cards): `#14171b`
- Background (nested rows/inputs): `#191d22` / `#1a1e23`
- Border (hairline): `rgba(255,255,255,0.07–0.1)`
- Text primary: `#e8eaed`
- Text secondary: `#c7cbd1`
- Text muted/tertiary: `#8b929c`
- Text faint: `#5a6068`
- Accent (brand/primary action): `#e0603f` (hover-ish lighter used for links: `#ef7454`)
- Accent-on text (gold, tiers/highlights): `#f2c34d`
- Success/green: `#3fa66b` (bg tint `#12241a` / `#1e2a20`, text `#7fd9a3`, border `#2a4a35`)
- Danger/red: text `#e8837a`, bg tint `#3a2020` / `#2a1414`, border `#4a2020`
- Warning/amber: bg `#3a2f18`, text `#f2c34d`, border `#4a3a22`

**Rank-delta gradient** (colors the "#rank" badge next to each Best-Available player, based on `player.overallRank − currentPickNumber`): ≤0 → red hue 358°, 1–10 → orange hue 24°, 11–20 → yellow hue 46°, 21+ → green hue 150°; each band interpolates lightness/saturation across its range (see `rankDeltaStyle()` in the source for exact HSL math) so magnitude within a band still reads.

### Typography
- UI text: **Inter** (weights 400/500/600/700/800)
- Numeric/tabular data & mono labels: **JetBrains Mono** (weights 400/500/600/700)
- Both loaded from Google Fonts.
- Sizes in use range 10–26px; body/table text mostly 11–13px, headers 13–20px, the Pick-number hero chip is 26px.

### Shape / spacing
- Card radius: 10px. Small chip/pill radius: 5–8px (pills that read as fully-rounded use 20px). Icon-nav squares: 6–9px, or `border-radius:50%`/45°-rotate for circle/diamond icon variants.
- Card padding: 12–16px typical. Section content max-width per settings page: 480–760px.
- Progress bar height: 6px, track `#1e2226`, fill accent or neutral gray depending on context.

### Wireframe palette (low-fi files only — style reference for structure, not for final visuals)
Paper `#efece5`, ink `#1a1a1a`, card `#fdfcf8` with 2.5px black border + hard drop shadow, hand-drawn font "Patrick Hand". Status tags: hot/red `#e8b4ab`, warm/amber `#f0d9a8`, cool/green `#dfe8dc`, accent `#c0392b`.

## Assets
No external image/icon assets — all icons in the hi-fi nav rail are plain CSS shapes (rounded square, circle, rotated square), and all "star" track glyphs are Unicode characters (★/☆). Fonts are loaded via Google Fonts CDN links (Inter + JetBrains Mono for the hi-fi app; Patrick Hand + Architects Daughter for the wireframes, though only Patrick Hand is actually used).

## Files
- `Fantasy Hockey Draft Assistant.dc.html` — **the hi-fi build**, primary reference for pixel-accurate recreation. Single interactive prototype with all 3 tabs and mock/generated data (612 fake players, deterministic pseudo-random stats).
- `War Room Wireframes.dc.html` — sketch-style exploration of War Room layout options (multiple rounds of iteration; the hi-fi War Room tab is the finally-chosen direction).
- `Data Grid Wireframes.dc.html` — sketch-style exploration of the Players grid layout options.
- `Settings Wireframes.dc.html` — sketch-style exploration of the Settings shell and each settings sub-section.

Open any `.dc.html` file directly in a browser to view/interact with it.
