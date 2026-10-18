# Task041 — Opt-in camera-driven rendering

## Request
“make this a togglable option (DONT EAT UP UI SPACE), and revert default to old point rendering system”

## Scope / acceptance
- Default Toronto rendering restores sampled overview (50k/depth3 default, old adjustable budget/depth) plus exact startup street crop; camera movement does not load adaptive native nodes.
- One compact Camera-driven detail checkbox inside existing collapsed Display quality. No new toolbar, permanent mode UI or panel. Adaptive parameters appear only while enabled; legacy controls otherwise.
- Enabling cancels/releases retained crop and starts native streaming. Disabling cancels/disposes native requests, source-pick caches and GPU chunks, restores overview/street rendering. Rapid toggles cannot publish stale results; geometry authority, selections and provenance stay intact.
- Browser checks actual default crop/no native requests, on/off/rapid switching, adjustable modes, clean desktop/mobile idle/UI. Typecheck/tests/build and diff check. Preserve existing task040 and unrelated changes.

## Plan
Small parent-owned viewer/UI lifecycle change; update adaptive browser smoke to explicitly opt in and verify fallback. No new module boundary/backend change. No >10k-token subtask anticipated, so no implementation delegation needed. Use isolated verification only if necessary.

## Impact
GitNexus viewer/Svelte impacts UNKNOWN (stale graph lacks Svelte callers); source verification confirms Toronto/ClosestPole callers. Make adaptive channel creation lazy and opt-in, preserving ClosestPole's non-adaptive behavior. No shared backend/provenance-helper edits.

## Completed implementation
- `Toronto.svelte` defaults `adaptiveEnabled=false`, restores old sample budget/depth controls and automatic exact street crop. The single checkbox resides inside existing collapsed Display quality; adaptive controls are conditional, with no new persistent surface. Current DOM value is applied explicitly in change handlers.
- Viewer constructs the adaptive channel lazily on opt-in. `stopAdaptive()` aborts/disposes it, releases native geometry/source caches, resets stats/errors/revision and reveals overview. A subsequent opt-in creates a fresh channel; disposed callbacks cannot republish. Existing channel cancellation tests retained. Mode switches clear disposable detail and disabling reframes/reloads the representative street; point references/authoritative geometry are untouched.
- Updated `scripts/browser-adaptive-display-smoke.mjs` to verify old default/no native traffic, legacy controls, explicit opt-in, native regression scenarios, off/rapid toggles and hidden mode-specific settings. This updated script is **not browser-verified yet**.

## Checks / evidence
- `pnpm typecheck`: PASS, Svelte0 errors/warnings; `/tmp/task041-typecheck.log`.
- `pnpm build`: PASS; `/tmp/task041-build.log`.
- `node --import tsx --test tests/*.test.ts`:746/746 PASS; `/tmp/task041-tests.log`.
- `node --check scripts/browser-adaptive-display-smoke.mjs` and `git diff --check`: PASS. Inspected source/diff for scoped default/lifecycle/control changes. Preserved earlier task040 work and unrelated `.pi/settings.json`.
- LSP checked edited TS/Svelte/JS. JS clean; no Svelte LSP, CLI svelte-check clean. Viewer cache still reports an obsolete3-argument native-pick signature from before the task040 child changed it to4; current source/CLI typecheck/build accept the correct4-argument call. No test/compiler weakening.
- Browser attempt: `node --import tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task041-browser` fails before page creation: **ECONNREFUSED127.0.0.1:9222**, `/tmp/task041-browser-run.log` and `/tmp/task041-browser/report.json`. `browser_setup` also fails starting daemon. Current desktop/mobile screenshots, default/toggle rendering and rapid-toggle interactions are **blocked/unverified**, not passing; task040 screenshots are historical only. Did not launch a replacement browser or disrupt operator processes.
- Graph impacts UNKNOWN require source-confirmed callers as above. CLI `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 10000` completes; `/tmp/task041-graph.log` reports critical inherited shared-backend impact/87 indexed symbols/40 flows across the combined checkout. Stale graph/untracked omissions/display caps persist; no clean certification or commit.

## Status / next action
Implementation complete. Reconnect existing CDP Chrome and run `pnpm build` then the updated browser script, also legacy `scripts/browser-street-testing-smoke.mjs` if available; inspect desktop/mobile default/opt-in/off screenshots. Fresh-session review pending against task041 and the combined uncommitted diff. Redacted handoff: `/tmp/task041-opt-in-rendering-handoff.md`.
