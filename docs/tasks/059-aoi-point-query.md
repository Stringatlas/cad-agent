# Task059 — Product-agent AOI point query

## Scope / acceptance
Expose `scene.query_aoi_points` only with a bound Toronto AOI. Query actual original-source data inside its rotated XY footprint across all elevations, optionally filter semantic label, and return exact counts with at most 64 deterministic witnesses. Include coordinates, semantic names, revision/frame/units, stable source keys and selection references. Reuse existing selection and human-approved datum proposal tools. Reject stale bindings; budget/cancellation failures never become empty/complete results. No geometry mutation, clearance or suitability certification; no new UI.

## Implementation / evidence
- `apps/server/src/spatial-page-index.ts`: additive `aoi()` using existing disk-page BVH, conservative XY pruning and rotated rectangle projection; bounded deterministic source witnesses. Existing queries unchanged.
- `apps/server/src/model-scene.ts`: artifact/session-bound query, 30s setup/query deadline, semantic names and usable `selectReference` outputs; no AOI means no tool. Resource limits return `complete:false`, not empty success.
- `apps/server/src/provider-model.ts`: conditional strict tool schema, input validation/dispatch and model instructions explaining source-only sampling limitations and existing human-approved proposal workflow.
- `packages/contracts/src/model-chat.ts`: allow tool evidence through the event protocol.
- Updated task048 assertion in `tests/area-of-interest.test.ts` to reflect newly authorized read-only querying (not mutation).

Graph impact: shared SpatialPageIndex HIGH; additive method only, existing callers unchanged. bindModelScene/provider/event validator LOW (provider receiver-call caveat). No commit.

`pnpm typecheck` passed after fixing semantic-label map indexing; log `/tmp/task059-typecheck.log`. `git diff --check` passed. Child reported existing spatial-page-index tests 5/5 passed using tsx; initial Vitest attempt unavailable. Parent did not run test suite or browser/live-provider calls, keeping verification bounded per user preference. No AOI-specific executable query tests run. LSP cache contains stale cross-file errors despite current CLI typecheck passing, plus unrelated pre-existing toronto-viewer.ts:486 diagnostic. No browser UI changed. Fresh-session review remains pending; preserve unrelated dirty work.
