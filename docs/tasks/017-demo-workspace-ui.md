# Task017 — Demo-oriented scene/chat UI

## Scope and authorization
User requests assigning an agent to clean up the UI toward the final demo: AI chat beside an interactive Toronto3D scene, arbitrary scene point selections feeding chat. Authorized focus is UI/UX, not a model loop, inference spend, CAD integration or backend redesign. User confirmed proceeding.

## Design
- Toronto3D-first scene-left/chat-right workspace, visually coherent and responsive.
- Natural-language local draft with explicit point attachments. Honest unavailable-AI feedback, never a fabricated answer or backend/tool execution disguised as AI.
- Cmd/Ctrl-click rendered overview/detail points to pin A/B with stable prepared-source provenance; preserve original binary64 coordinates, artifact revision, meters and Toronto frame/origin. Arbitrary means any rendered point, not interpolated empty-space or exhaustive unseen-cloud selection.
- Keep Toronto references separate from synthetic authoritative project context. No implicit mapping, CAD mutation or model delivery. Clear/invalidate stale selections on changed artifacts/unmount/source switches; asynchronous display replacement must not publish stale picks.
- Hide technical inspection/LOD/parameter controls in labeled expandable panels while keeping existing functionality and approval safeguards available.

## Acceptance
- [x] Initial desktop view emphasizes Toronto scene + chat, not nested testing panels. Narrow screens stack without horizontal overflow; keyboard focus and readable labels remain available (1440px/375px visual and layout checks).
- [x] Toronto overview and full-resolution detail picks attach original point keys/coordinates/revision/frame to the local draft; A/B replace/clear is explicit and markers show selection (actual observation/detail agreement).
- [x] Plain drag orbits, Shift-drag retains full-resolution window selection, Cmd/Ctrl-drag/cancel/LOD-race cannot pin accidentally. Gesture coexistence and lifecycle disposal verified in task017 browser/source review; historical post-release exact-string diagnostic remains failed below.
- [x] Local natural-language drafting works with attachment chips/details. Sending yields clearly labeled not-connected feedback, sends no model or edit request, and preserves draft/context. No fake assistant outcome. Feedback invalidates on text/reference changes.
- [x] Toronto attachments are not included in synthetic `/project/context`, box proposals or geometry; source switching/reset/artifact changes do not silently reuse them. Artifact replacement is a labeled intercepted fixture, not a rewritten dataset.
- [x] Deterministic inspection, entity selection, synthetic A/B, exact proposal approval/Undo/Save/Load and crop cancellation/error controls remain accessible through technical controls. No weakened verification/safety checks.
- [x] Appropriate unit tests, `pnpm verify`, isolated existing-Chrome visual/interaction tests and fresh-agent reviews run with exact evidence. Earlier dirty work/operator processes preserved. This means checks executed, not a claim every historical browser suite passes.

## Ownership / exclusions
Implementation agent owns `apps/web/src/App.svelte`, `Chat.svelte`, `Demo.svelte`, `Toronto.svelte`, `toronto-viewer.ts`, new frontend-only selection/draft helpers/components and focused tests. Parent owns this task, task index and verification coordination. Browser agents own the new isolated task017 browser script/artifacts and bounded existing-launcher source/expandable adaptations, including Toronto-only diagnostic synchronization; source reviewers are read-only. No auth/provider/server/contracts changes, no dependencies, no commits. Existing dirty tasks014–016 must be preserved.

## Evidence and status
**Implemented; bounded task017 source/corrective/launcher reviews complete.** Not blanket approval of the dirty checkout or a clean historical Toronto suite.

### Commands and results
Node22.23.3 / pnpm10.34.6. Final `pnpm verify` PASS:230/230 tests, package/test typecheck, web/server build. `/tmp/spatial-task017/final-verify.log`; Vite's >500kB chunk warning retained. Svelte CLI has0 errors/warnings; cached workspace LSP still has221 pre-existing errors and hints, not certified clean or worked around.

`node scripts/browser-demo-workspace-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task017/browser-final` PASS14/14 groups, no failures/findings/console errors. Read initial AX snapshot before permitting visual captures via its `allow-screenshots` acknowledgement file. Final build JS `index-DtfGhDdy.js`, CSS `index-DpJ3P4Cz.css`. Report/screenshots/logs: `/tmp/spatial-task017/browser-final/`; method and actual-data versus fixture distinctions: `/tmp/spatial-task017/browser/HANDOFF.md`. Initial low stale-acknowledgement finding corrected and rerun; final `draft-feedback-invalidation.json` proves clearing feedback without losing text.

Updated legacy launchers keep functional/safety assertions while explicitly selecting the source and opening technical panels; snapshot replacement reopens keyed tools. Commands (each followed by `http://127.0.0.1:9222` and corresponding temp artifact directory):
- `node scripts/browser-smoke.mjs`: PASS8/8 — `/tmp/spatial-task017/legacy-browser/demo/`.
- `node scripts/browser-shared-chat-smoke.mjs`: PASS10/10 — `…/shared-chat/`; expected backend-shutdown HTTP errors retained. Unavailable synthetic authority now retains LOCAL draft, but binding/geometry/tools are absent and Save/Load disabled.
- `node scripts/browser-interactive-edit-smoke.mjs`: PASS15/15 — `…/interactive/`; injected WebGL failure errors and disposal warnings recorded. Exact proposal/approval/inverse/render-loss assertions preserved.
- `node scripts/browser-toronto-smoke.mjs`: **FAIL**, original and synchronized runs preserved. Synchronized evidence: `/tmp/spatial-task017/toronto-triage/synchronized/`. In-gesture strict frozen-camera equality passes; post-release strict equality differs ~10⁻¹²m. Runtime capture plus independent bit-for-bit OrbitControls spherical-roundtrip reproduction proves zero-input resumed normalization, not gesture orbit. **No tolerance changed/assertion deleted/product fix made.** Later groups in this launcher not completed; do not report it passing. Diagnosis: `/tmp/spatial-task017/toronto-triage/HANDOFF.md`, `normalization-proof.json`.

All owned launchers syntax-check; `git diff --check` passes. Owned ports/tabs cleaned; operator3001/5173, persistence, credentials and actual dataset files untouched. No model/auth/inference or commits.

### Independent review and graph limitations
- `/tmp/spatial-task017/review/source-review.md`: no actionable implementation finding;51/51 focused tests.
- `…/feedback-review.md`: no corrective finding; compiled/runtime reactive-dependency probe and26 targeted tests pass.
- `…/legacy-review.md`: no launcher-adaptation defect; original safety checks retained, normalization reproduced independently, Toronto failure still open.
- Repository `cad-agent`, checkout/index HEAD4dc9c760. Pre-edit Svelte/runtime/new-script UNKNOWN results source-confirmed, not treated as unused. No HIGH/CRITICAL task017 pre-edit impact; whole-checkout `detect_changes` includes earlier dirty tasks and returns aggregate **CRITICAL**, with incomplete untracked/Svelte coverage. MCP output is transport-truncated; CLI rerun `node .gitnexus/run.cjs detect-changes --scope all --repo .` records121 symbols/22 flows and elides listings. `/tmp/spatial-task017/graph-final.json`, `graph-final-cli.log`. This is unresolved graph certification, not a clean check. No staging/reindex/commit.

### Artifacts / remaining action
Before-change sources/diff/status: `/tmp/spatial-task017/before/`; implementation patches: `…/implementation/`; legacy before/patches: `…/legacy-browser/`; final redacted continuation: `/tmp/spatial-task017/completion-handoff.md`.

Remaining: separately scope a mathematically appropriate post-release camera invariant before changing legacy Toronto acceptance. Whole-checkout fresh review/graph certification and prior task reviews remain pending. Model integration, actual agent delivery, Toronto/project mapping and CAD workflow remain unimplemented/unassigned.
