# Task072 — Local screenshots independent of model availability

## Request / acceptance
User: screenshot gets grayed out; it should always be available. Proceed with bounded correction; pause for important behavioral questions.

- [x] Capture available with a mounted source regardless of model catalog/account/selection or streaming state.
- [x] Capture available with AOI context; local screenshot overrides its automatic snapshot, without clearing the AOI. Removing local image restores automatic AOI snapshot.
- [x] Keep duplicate crop/capture prevention, byte limits, error recovery, cancellation/disposal and scene-mode invalidation.
- [x] Provider/model selection changes retain locally prepared pixels. Sending remains independently gated; human approval untouched.
- [x] Focused checks, desktop/mobile visual inspection, independent scoped source review.
- [ ] Fresh-session whole-checkout review (existing unrelated changes remain).

## Cause / implementation
`apps/web/src/ModelChat.svelte` gated the camera on `catalogModelSelected` (including read-only catalog refresh), streaming, and any AOI. Its click handler also rejected capture without a selected discovered model. Manual capture is local viewer work, not provider work.

The camera now depends only on `visualSource`, `cropOpen`, and `captureBusy`. Local attachment takes precedence over the AOI snapshot; the remove action targets the displayed image. Clearing the AOI while streaming remains blocked. Captures during responses prepare the NEXT message, not a mutation of the in-flight request. Existing send/authority gates unchanged.

Graph: cad-agent index timestamp 2026-10-20T20:47:31; handler unresolved and File impact UNKNOWN. Confirmed literal integration: Chat owns ModelChat, App forwards viewer source and Toronto AOI. No claim UNKNOWN means unused. Whole-checkout detect_changes reports CRITICAL (242 changed symbols/103 affected,37 tracked changed files); output incomplete, unrelated dirty changes and untracked coverage unresolved. No commit.

## Verification / exact commands
- `pnpm typecheck` PASS; `/tmp/task072-typecheck.log` (Svelte0 errors/warnings). Svelte LSP unavailable; CLI authoritative. TS LSP clean.
- `pnpm build` PASS; `/tmp/task072-build.log` (existing bundle-size warning).
- `node --import tsx --test tests/screenshot-availability.test.ts tests/model-chat-ui-context.test.ts tests/screenshot-crop.test.ts tests/model-visual-client.test.ts` PASS36/36; `/tmp/task072-focused.log`.
- `node --import tsx --test tests/*.test.ts` FAIL1233/1246,13 failed assertions/subtests; `/tmp/task072-full-test.log`. Broad removed-legacy-workflow and UI-source expectations remain; not a clean baseline or repository certification. No unrelated tests weakened.
- `git diff --check` PASS before documentation; final rerun required.
- Independent focused child source review: no concrete introduced findings; whole-checkout review remains pending.

### Browser evidence
Own managed-headless tab on existing dev server `http://localhost:5173/?smoke`; actual synthetic WebGL capture and JPEG preparation. Provider catalog/turn fetch overridden in that tab only; no paid inference. Offline camera/crop/Attach JPEG succeeded; held catalog request kept model disabled while camera enabled and attachment retained; mocked streaming request admitted, camera remained enabled, crop opened and attached pixels for next message while phase remained streaming.

Visually inspected:
- `/tmp/task072-mobile-crop.png` (500×844 offline crop; actual rendered box/cloud).
- `/tmp/task072-desktop-streaming-crop.png` (1440×900 mock-streaming crop).
- `/tmp/task072-mobile390-crop.png` and `/tmp/task072-mobile390-crop-actions.png` (390×844 offline crop, scroll to reachable Cancel/Attach JPEG; existing dialog scroll design unchanged).

Standalone attempt `node --import tsx /tmp/task072-browser-smoke.mjs` failed before assertions: initially Vite5173 occupied, then separate Chrome launch blocked by macOS sandbox/ProcessSingleton permissions. `/tmp/task072-browser.log` and `/tmp/task072-browser/report.json` record that failure, NOT a passing automation report. Managed-browser checks above were the fallback. AOI override and failure lifecycle covered by focused handler/source tests, not real Toronto AOI browser interaction. Requested project spatial-rendering/pi-browser-harness skills absent in installed paths. No live model, production-scale, or full repeatable browser certification claimed.
