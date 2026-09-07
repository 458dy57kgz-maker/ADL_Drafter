# Archive — the retired value engine

Nothing in the running app imports anything in this folder. It is kept, not
deleted, because the scoring work here may be worth revisiting.

## Why it was retired

`draftValue.js` / `draftPlan.js` drove the War Room's "Best Pick" and "Next
Best Pick" panels — a win-probability / marginal-value engine that produced a
single recommendation. Across several live mock drafts it kept recommending D
and G long past the point the roster needed them (5 D and 2 G by round 7 with
no forwards drafted). Rather than keep chasing the cause, the decision was to
hand the call back to the drafter and show a dense Best Available board
instead. See `client/src/lib/draftBoard.js` for what replaced it — lookups,
sorts and comparisons against the pick number, no probability math.

## What's here

The four files the retirement note named:

- `draftValue.js` — the scoring engine (`buildContext`, `recommend`, VORP,
  replacement levels, season-target blending)
- `draftPlan.js` — `planNextTwo`, the two-pick lookahead built on it
- `diagnose.js` — the standalone diagnostic harness (this one was never in the
  repo; copied in from ~/Downloads/Diagnose so the set is complete)
- `config.local.js` — local engine overrides

Plus everything whose only reason to exist was to serve them. These came along
so that no file left in `client/src` imports an archived module — leaving them
behind would have meant a `client/src` that still referenced this folder:

- `engineConfig.js` — layered engine defaults < config.local.js < app settings
- `draftPlan.worker.js` — the worker that owned the engine context
- `useDraftPlan.js` — the React hook driving that worker
- `DraftPlanPanel.jsx` / `.css` — the two retired cards
- `planFixtures.json`, `plan-fixtures.mjs` — the fixture generator and its output

## If you bring it back

`plan-fixtures.mjs` reads the engine by relative path
(`../client/src/lib/draft/draftValue.js`) and writes its output into
`client/src/lib/draft/`. Both paths are now wrong; fix them before running it.
The server also no longer sends `engineConfig` or `poolVersion` in
`/api/draft/state` — `git show cdc122b:server/src/routes/draft.js` has the
version that did.
