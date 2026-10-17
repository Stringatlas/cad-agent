# Task032 — Scene-first workspace

Status: implemented and verified; fresh-session review pending.

## Request and scope
Implement the requested severe clean Apple-style UI overhaul: primary full-height 3D scene, side chat, no document scrolling, restrained overlays and secondary controls. Remove persistent engineering headlines/counts, not merely recolor them. Preserve existing source separation, original/effective provenance, request transparency, explicit approval, Undo and fail-closed behavior. No backend, geometry or authority changes.

## Acceptance
- Desktop scene occupies all available workspace height beside a bounded chat sidebar; only conversation/tools scroll internally.
- Mobile retains a full-height scene with an intentional toggleable chat overlay; no document scrolling.
- Toronto, synthetic and nearest-label scene views resize without fixed-height embedded viewports.
- Primary UI omits engineering slogans, overview count badges and long introductory prose. Diagnostics and secondary tools remain accessible in closed disclosures.
- Existing numbered selection, verified nearest selection, exact preview/Approve/Undo, source switching, chat, screenshot cropping and request inspector remain available.
- Typechecks, tests/build, isolated existing-Chrome layout/workflow checks and visual inspection recorded, without touching existing listeners/operator configuration.

## Design / ownership
App owns the fixed-height shell, source selection, chat visibility and Project popover. Scene components own full-size canvas and local floating scene tools. Chat owns bounded references/tools and a flex conversation/composer. Neutral graphite surfaces, muted text, blue accent, minimal compact controls. No new packages.

## Completion and verification
All layout criteria implemented. UI-only changes in App, Toronto, Demo, ClosestPole, Chat and ModelChat; underlying scene/authority scripts unchanged except App's mobile visibility state. Engineering overview badges/headlines removed; idle crop/query messages suppressed; diagnostics, source metadata and exact review remain in disclosures. Project controls are a bounded header popover. Chat remains mounted when hidden; its draft/history are not lost by toggling.

Commands/results (Node 22.23.3, pnpm 10.34.6):
- `pnpm typecheck`: passed, Svelte 0 errors/warnings. `/tmp/task032-typecheck.log`.
- `node --import tsx --test tests/*.test.ts`: 641/641 passed. `/tmp/task032-tests.log`.
- `pnpm build`: passed; existing >500 kB bundle advisory remains. `/tmp/task032-build.log`.
- `pnpm verify`: blocked by tsx CLI Unix-socket EPERM, not a failing product assertion. Same tests passed using the direct Node invocation above. `/tmp/task032-verify.log`.
- `node --import tsx scripts/browser-scene-workspace-smoke.mjs`: 10 groups passed against final built bundle, existing Chrome CDP9222, isolated ephemeral real backend/tiny prepared fixture. `/tmp/task032-browser/report.json`, 11 screenshot/AX pairs, actual GPU uploads and synthetic provider-body evidence. Full-height/no document overflow desktop 1440×900 across three scenes and mobile 390×844; visible mobile composer; native selection → verified query → explicit winner → exact preview/Approve → Undo; real loaded-point GPU positions restored; request inspector and screenshot crop/attachment checked. No console/page errors. Synthetic provider transport, not live inference.
- Read-only existing-server production visual check: actual 78,320,210-point Toronto source with 50,000 rendered sample, desktop/mobile, synthetic switch/resize; no overflow/errors/mutations. `/tmp/task032-production/report.json`, six screenshot/AX pairs. Captured before the final removal of idle status badges; final fixture screenshots reflect that cleanup. No operator configuration, credentials, existing listeners or source records changed. Parent visually inspected production desktop/mobile and fixture layouts.
- `git diff --check`: passed; actual component diff inspected for unintended changes.
- GitNexus impacts performed before edits. Index is behind HEAD; Svelte file impacts LOW/UNKNOWN with incomplete real caller coverage, confirmed imports/mounts against source. `detect_changes(scope: all)` reports six changed component files, zero mapped symbols/processes; this is a coverage limitation, not a clean graph certification. No commit made.
- Svelte LSP unavailable. Workspace cached LSP retains prior task031 `evidence` diagnostic in point-override-client.ts; full current CLI typechecks pass. Browser daemon setup failed; isolated Playwright attached to existing Chrome instead.

## Remaining / next action
Fresh-session review against this task and actual diff remains pending, especially keyboard accessibility, small-height/virtual-keyboard layouts and legacy smoke selectors that now need to open disclosures or use shortened source labels. Existing request inspector omits the nearest_label parameter schema explicitly; browser evidence records that prior limitation rather than weakening assertions or claiming full schema transparency. No new backend/model/CAD scope authorized. Review task032 next; do not conflate passing implementation checks with review.
