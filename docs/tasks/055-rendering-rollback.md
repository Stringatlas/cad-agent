# 055 — Rendering rollback

Status: Implemented; fresh-session review pending. No commit.

## User direction / scope
User rejected viewport chunk loading behavior and requested the old rendering system. Restore the state immediately before task054, preserving task053 camera controls/focus prioritization, older bounded batching/color modes, and unrelated dirty work. Stop the proposed tight-zoom optimization; no new optimization shipped.

## Changes
- Restored `adaptive-render.ts` and its tests to their staged, pre-task054 versions: full batch rebuild/recolor/bounds computation rather than incremental appends.
- Restored camera-timer admission gate and previous documentation in `adaptive-display.ts`; removed only task054's frozen-timer optimization test. Earlier task053 focus tests remain.
- Retained task054 historical scripts/evidence. Investigation-only `scripts/browser-tight-zoom-profile.mjs` is not product behavior.

## Verification
- `node --import tsx --test tests/adaptive-display-client.test.ts tests/adaptive-render.test.ts tests/point-override-render.test.ts tests/orbit-focus.test.ts tests/visual-capture.test.ts`:40/40 pass; `/tmp/task055-rollback-tests.log`.
- `pnpm build`:pass; `/tmp/task055-rollback-build.log`.
- `pnpm typecheck`:pass, zero Svelte errors/warnings; `/tmp/task055-rollback-typecheck.log`.
- `node --import tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task055-rollback-browser`:13/13 groups pass, including camera movement, budget shrink, native exact picks, error/retry, legacy fallback and mobile; `/tmp/task055-rollback-browser.log`, report/screenshots in artifact directory.
- `git diff -- apps/web/src/adaptive-render.ts tests/adaptive-render.test.ts`:empty, confirming exact staged pre-task054 restoration, not HEAD restoration (which would discard earlier work).
- LSP reported an unrelated scene-object set() arity diagnostic in toronto-viewer.ts; authoritative full typecheck passes. Not modified for this rollback.
- Graph impact: createAdaptiveRender/createAdaptiveDisplay LOW, direct caller createTorontoViewer. Nested pump HIGH with bind/configure/retry/update paths; warning recorded before reverting; lifecycle tests/browser gates pass. Index source may lag dirty work; verified actual diff. No commit or whole-worktree graph certification claimed.
- Full test suite not rerun; previous baseline failures remain outside scope. User visual confirmation and fresh-session review remain pending. This restores pre-task054 behavior; it does not assert all viewport density complaints are solved.
