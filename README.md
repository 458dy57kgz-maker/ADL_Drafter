# ADL Drafter

A draft-night companion app for a Yahoo Fantasy Hockey league. Live "War Room" dashboard during the draft (best available players by position, roster progress, position scarcity, live pick feed), a full sortable/filterable player data grid, and a Settings area for Yahoo OAuth, league/roster config, rankings import, and draft-day behavior. Reads Yahoo's API — the pick itself still happens in Yahoo's own app/site; this is a decision-support sidekick.

Design source: [`design/`](design/) — the original hi-fi handoff this app is built from (`design/README.md` has the full spec: tokens, layout, state shape).

## Stack

- `client/` — React + Vite. Dark theme matching the design tokens 1:1 (see `client/src/styles/theme.css`).
- `server/` — Express + better-sqlite3. Owns the Yahoo OAuth secret, polls the Yahoo API, persists players/rankings/settings/draft history to a single SQLite file.

Currently seeded with realistic **mock draft data** (see `server/src/lib/mockData.js`) so the UI is fully exercisable before real Yahoo credentials are wired in. Yahoo endpoints (`server/src/routes/yahoo.js`) are stubs — see the TODO there for what real OAuth needs.

## Local development

```bash
# terminal 1 — API server (SQLite file lands in server/data/)
cd server
npm install
npm run dev          # http://localhost:4000

# terminal 2 — client with hot reload
cd client
npm install
npm run dev           # http://localhost:5173, proxies /api to :4000
```

## Deploying on a NAS with Docker

`better-sqlite3` compiles a native addon at install time, so **build the image on the NAS itself** (or push a multi-arch image via `docker buildx`) rather than building on a different-architecture machine and copying it over.

```bash
# on the NAS, with this repo checked out
docker compose up -d --build
```

This builds the client, bundles it into the server image, and serves everything (API + static UI) from one container on port 4000. Draft data persists in the `adl-drafter-data` named volume — back that up before `docker compose down -v`.

## Project layout

```
client/           Vite React app
  src/pages/       WarRoom, Players, Settings (+ 7 settings sub-sections)
  src/components/  NavRail
  src/lib/         API client, rank-delta/scarcity color logic, polling hook
  src/styles/      Design tokens (theme.css) + shared component styles

server/
  src/routes/      players, draft, settings, yahoo, debug, league
  src/db/          SQLite schema + seed
  src/lib/         mock data generator, snake-draft math, rank-delta/scarcity

design/            Original design handoff (reference only, not shipped)
```

## Status / next steps

- [ ] Real Yahoo OAuth2 (`server/src/routes/yahoo.js` is currently a stub)
- [ ] Live draft polling job replacing the mock `draft_picks` seed
- [ ] Real rankings CSV/Google-Sheet import (basic name-matching is wired; fuzzy suggestions are not yet auto-generated)
- [ ] "Manage Columns" and CSV column-mapping UI are visual-only so far
