# Task047 — WASD camera flight

## Scope
Add keyboard flight to synthetic and shared Toronto viewers without replacing OrbitControls. W/S translate along the viewing direction (including pitch); A/D strafe camera-right/left. Translate camera and orbit target equally, preserving view direction and orbit radius. Fixed speeds: synthetic 3m/s, Toronto 10m/s. No pointer lock, new panels, terrain collision, vertical bindings, speed settings or geometry changes.

## Acceptance
- Click or Tab to focus the scene; only a focused canvas consumes unmodified physical WASD keys. Text fields, shortcuts and other controls remain unaffected.
- Time-based normalized diagonal movement; clamp long frame gaps. Key release, focus/window blur, hidden document, disabled controls, render failure and disposal stop movement without sticky keys.
- Existing orbit/zoom/picking and Toronto Shift-window/query gestures remain intact. Flight invalidates image grounding, redraws the demand-rendered scene and updates adaptive camera observations; idle remains quiet.
- Concise existing help and visible keyboard focus, no permanent flight overlay.
- Automated movement/lifecycle tests, typecheck/build/full tests and existing-Chrome desktop/mobile interaction/visual evidence. Fresh-session review remains pending.

## Plan
Implement one disposable shared keyboard controller and viewer integration; delegate focused controller tests; verify baseline and browser interactions; inspect diff and save review handoff. No commit requested.

## Pre-edit risk
GitNexus impact(createViewer/createTorontoViewer, upstream) reports UNKNOWN (no resolved callers), not low risk. Text confirmation: Demo.svelte mounts createViewer; Toronto.svelte and ClosestPole.svelte mount createTorontoViewer. Both own disposable view state only. Indexed execution flows include viewer → animate → updateStableOrbitControls and Toronto gesture/invalidation. Index initially two commits behind; refresh attempted (result to be recorded). Scope is shared viewer lifecycle, camera/capture and native LOD interactions; no module boundary change.

## Status / completed criteria
Implemented. Shared disposable controller, focusable canvases and unobtrusive focus outline, existing navigation help, equal camera/target translations, frame-gap clamp, lifecycle reset and explicit image/demand-render invalidation. No geometry/authority changes or new panels. Fresh-session review pending; no commit created.

## Verification
- Node22.23.3 / pnpm10.34.6. `pnpm verify`: typecheck passes (Svelte0 errors/warnings), then blocked by tsx CLI IPC `EPERM /tmp/agents/tsx-501/*.pipe`; build not reached by that composite. Log `/tmp/task047-verify.log`.
- `node --import tsx --test tests/*.test.ts`:832/833 twice, unrelated parallel race in `semantic-disk-storage.test.ts:181` shared `.building-*` directory assertion. Logs `/tmp/task047-tests.log`, `/tmp/task047-tests-rerun.log`. No acceptance weakened or unrelated test changed.
- `node --import tsx --test --test-concurrency=1 tests/*.test.ts`:833/833 pass (`/tmp/task047-tests-serial.log`). Focused camera/orbit suite33/33, including26 new flight tests (`/tmp/task047-focused-tests.log`).
- `pnpm build`: passes; existing large-bundle warning (`/tmp/task047-build.log`).
- LSP: new controller/tests clean. Cached Toronto `AdaptiveCallbacks.removeMany` diagnostics are stale: source defines optional removeMany; current compiler/typechecks pass.
- Existing Chrome, live Vite `http://127.0.0.1:5173/?smoke`, actual Toronto3M native points: four flight directions, equal camera/target delta, release/focus/chat/shortcut safety, mouse orbit and zoom, frozen Shift-window and restart, idle draw suppression, synthetic selection and Tab focus; Find nearest shared viewer remount and WebGL-loss flight stop. No page errors in main run. Browser reports and inspected desktop/mobile screenshots: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/task047-browser/{report.json,extra-report.json,*.png,*.ax.txt}`. Temporary replay scripts alongside that directory: `task047-browser.cjs`, `task047-browser-extra.cjs`. Browser tab closed after checks. These are dev-runtime checks; build passes separately, not a built-preview browser claim.
- Main browser script initially sampled residual OrbitControls damping before Shift-window; rerun waits for stable camera and passes exact unchanged camera/target across gesture. No product change made to suppress damping or weaken motion checks.
- Desktop1440x900/mobile390x844 idle/selected/chat-open/chat-dismissed/error inspected: scene remains primary, keyboard outline visible, error actionable. Pending-proposal UI is unchanged and not exercised by this camera-only task.
- `git diff --check` passes; inspected tracked diff and new helper/tests for unintended edits. Initial checkout was clean (earlier tasks already in HEAD); `.pi/sandbox.json` changed externally during the session and is preserved untouched.

## Graph evidence / limitations
`node .gitnexus/run.cjs analyze --index-only` failed on registry guard permissions; `/tmp/task047-index.log`. `detect-changes --scope all` reports HIGH aggregate risk,10 symbols/8 flows across viewer animation, orbit stabilization, selection and context restoration (`/tmp/task047-detect-changes.log`). No partial/truncated flag in that result, but index remains two commits stale and omits untracked helper/tests; graph coverage is unresolved, not clean certification. Manual/source/browser checks cover the changed paths; this does not waive HIGH graph risk.

## Next action
Fresh-session review task047 against its actual diff, especially focus/keyboard lifecycle and capture/demand-render interactions. Full parallel-suite race and graph registry permissions remain separate unresolved verification limitations; no live provider calls, approvals or geometry edits were needed.
