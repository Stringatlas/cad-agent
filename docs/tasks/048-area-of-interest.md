# Task048 — Shift-drag AI area of interest

## Scope / acceptance
- Toronto Shift-drag selects a camera-aligned, potentially rotated XY rectangle, not a camera frustum. XY plane is at the orbit target's Z (reference plane, not estimated terrain); AOI applies through all elevations.
- Persistent scene outline, compact Area of interest / Clear control. Tiny Shift-click retains existing box placement. Closest-label fixture keeps its independent crop gesture.
- Automatically capture the selected scene and prepare the existing bounded JPEG attachment. Coordinates with Toronto artifact/frame/meters/origin and snapshot enter subsequent explicit chat sends; selection itself makes no paid inference request.
- Clear/replacement/artifact/mode/disposal suppress late capture and remove AOI/image from future context. Selection is not geometry authority or a whole-dataset query filter.
- Dynamic rendering never starts an uncapped full-resolution load from this gesture. Manual box full-resolution tools remain.
- Targeted geometry/protocol/client/server tests, typecheck/build and desktop/mobile browser inspection. Fresh-session review pending; preserve task047/operator changes.

## Pre-edit impact
GitNexus index two commits behind. canonicalModelScene HIGH: modelScene, canonicalModelTurnRequest and controller.bind feed browser streaming/server handle. Additive optional schema preserves existing callers. bindModelScene LOW (server handle). createTorontoViewer/pointerUp/modelScene and Svelte selectWindow UNKNOWN/unindexed; source confirms Toronto and ClosestPole viewer callers, DOM listeners, Chat scene builder. Preserve ClosestPole behavior with an optional callback.

## Evidence
Implemented. All acceptance paths above exercised except live-provider inference (intentionally replaced by a local browser fetch fixture; no paid request). Existing image sends start fresh conversations; the retained AOI snapshot accompanies each subsequent send until cleared. Snapshot errors block Send rather than silently dropping the image.

- `pnpm typecheck`: passed, including tests. `pnpm build`: passed (existing Vite >500kB chunk warning).
- `pnpm --filter @spatial/web typecheck`: final UI check passed, 0 errors/warnings.
- `node --import tsx --test --test-concurrency=1 tests/area-of-interest.test.ts tests/model-chat-client.test.ts tests/model-chat.test.ts tests/model-visual-client.test.ts tests/model-visual.test.ts tests/model-nearest-tool.test.ts tests/model-chat-ui-context.test.ts tests/crop.test.ts tests/visual-capture.test.ts tests/screenshot-crop.test.ts`:164/164 passed. Nine new projection/schema/client/server tests. Existing source-extracted composer test updated to supply its new derived attachment dependency, not weakened.
- Logs: `/tmp/task048-typecheck.log`, `/tmp/task048-build.log`, `/tmp/task048-web-final.log`, `/tmp/task048-tests.log`.
- Actual Toronto Chrome desktop: selected rotated 28.5×16.2m rectangle, automatic1280×710 JPEG, explicit fixture Send carried AOI+image with null conversationId; Clear then Send carried neither and null conversationId. No crop points loaded. Mobile390×844: visible outline/Clear, no horizontal overflow; capture after646 native nodes settled passed. Clear during asynchronous capture suppressed late image/outline; injected capture failure showed recovery and no image, reselect succeeded. No model proposal or approval semantics changed.
- Fixed a discovered existing screenshot issue: native node arrays exceeded the model metadata array limit after display settled. Coverage now explicitly samples32 names with actual node/omission counts; capture signatures still include all actual drawable geometry.
- Screenshots under `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/`: desktop `pi-browser-screenshot-pi-nnpmhna1-c30c15a6-ee14-45c2-9117-d5d9afed00f8.jpeg`; mobile selected `pi-browser-screenshot-pi-nnpmhna1-d5fe816e-53fb-4b39-86f6-6c533e28103f.jpeg`; injected error `pi-browser-screenshot-pi-nnpmhna1-2f9ad58c-b90a-4fd0-8977-bb4ddca788a1.jpeg` exposed generic alert CSS overriding positioning, corrected with a scoped selector Final mobile error-position recheck passed: error top236px below selection bottom228px, no image; inspected screenshot `pi-browser-screenshot-pi-nnpmhna1-19477920-7bb9-426b-ad62-f9eb486bfb63.jpeg`.
- `git diff --check`: passed. GitNexus detect_changes(all) reported aggregate CRITICAL across the mixed dirty checkout (46 symbols,38 affected,15 tracked files); captured output `/tmp/task048-graph.json` is cut off, so not a clean graph certification. Index two commits stale and new untracked helpers absent. No commit created. Toronto viewer LSP still reports cached pre-existing AdaptiveCallbacks.removeMany errors; current compiler/Svelte checks pass. Full suite not rerun for this bounded task.

## Follow-up — persistent selected-area overlay
User clarified the selected AOI must remain visibly overlaid. Replaced the subtle one-pixel-only outline with a persistent18% mint XY fill and brighter border, drawn above scene geometry until Clear/replacement. It follows orbit/resize in world space and appears in automatic snapshots. The tint is explicitly marked in capture coverage and cannot intercept raycasts or pixel-grounding sightlines; it is not a CAD surface. Both materials/geometries dispose on replacement/teardown.

- Pre-edit createTorontoViewer impact UNKNOWN (stale index); source confirmed Toronto/ClosestPole callers and setArea lifecycle. No boundary/authority change.
- `node --import tsx --test tests/area-overlay.test.ts tests/area-of-interest.test.ts tests/visual-capture.test.ts`:10/10 passed; new test checks XY mesh, alpha/depth, no occlusion, replacement/clear/disposal.
- `pnpm typecheck` and `pnpm build` passed; logs `/tmp/task048-overlay-typecheck.log`, `/tmp/task048-overlay-build.log`. Cached viewer LSP limitation unchanged; new helper/test diagnostics clean.
- Actual Toronto Chrome: overlay persists after pointer release and orbit; snapshot attached without errors. Desktop1280×800 and mobile390×844 screenshots inspected, Clear removed context/image/overlay and no mobile horizontal overflow. No inference request.
- Screenshot files in the same OS-temp directory above: desktop `pi-browser-screenshot-pi-nnpmhna1-5dd14398-7b17-4a50-91bb-7e5aa5a71436.jpeg`; mobile `pi-browser-screenshot-pi-nnpmhna1-d3aa1765-700d-4919-8dde-af8a1d27e654.jpeg`.
- `git diff --check` passed. No commit or full-suite rerun.

## Follow-up — all elevations and first-drag reliability
User clarified all Z levels and reported first Shift gesture intermittently missed. AI context already means all elevations; visual overlay now extrudes the rotated XY footprint through the dataset's entire Z extent (actual116.689–171.263m), with low-opacity walls/caps and12 edges. This finite display extent does not impose a model-context Z filter. Compact label says All heights. Overlay test checks eight vertices,36 face indices and24 edge indices.

Gesture fixes: allow Shift arriving immediately after mouse-down before an orbit passes the4px threshold, cleanly terminate OrbitControls' pointer before takeover; ignore unrelated cancel events and stale capture loss when the current pointer is captured; suppress automatic startup street reframing after user scene interaction. Source identified these concrete failure paths, but operator's exact intermittent event trace was not captured.

- `node --import tsx --test tests/area-overlay.test.ts tests/area-of-interest.test.ts`:10/10 passed. `pnpm typecheck`, `pnpm build`, `git diff --check` passed. Logs `/tmp/task048-z-gesture-tests.log`, `/tmp/task048-z-gesture-typecheck.log`, `/tmp/task048-z-gesture-build.log`. Existing cached viewer LSP warnings unchanged.
- Actual Chrome fresh-page first drag passes with Shift already down and with Shift after mouse-down; tested from composer focus and with synthetic unrelated pointercancel/delayed capture-loss noise. Tests clear prior AOI before each attempt. Snapshot attaches, full dataset Z overlay shown, no error/inference calls.
- Delayed final display observation by3s on a fresh page, selected against the root display during startup, then confirmed camera unchanged when final LOD arrived. Browser injection removed afterward.
- Desktop1280×800 and mobile390×844 screenshots inspected in same OS temp directory: `pi-browser-screenshot-pi-nnpmhna1-d76e0e46-f74a-4603-80dc-153421b1928a.jpeg`, `pi-browser-screenshot-pi-nnpmhna1-8aba8c45-b6af-4eed-9f58-6021c15139f3.jpeg`.
- No commit/full-suite rerun. Graph impacts remain UNKNOWN/stale; current source confirmed helper/viewer callers. No claim of clean graph certification.

Fresh-session review remains pending. Preserve task047 and `.pi/sandbox.json` operator work.
