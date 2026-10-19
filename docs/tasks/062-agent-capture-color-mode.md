# Task062 — AI capture color mode

## Scope / acceptance
User: allow AI scene capture to toggle natural RGB and point type. Bounded to `scene.capture_scene`; no new permanent UI, geometry authority, paid inference or commit.

- [x] Optional `colorMode: "rgb" | "type"` on current/top-down/explicit-camera requests; omission preserves current display mode and old request shape.
- [x] Provider advertises the option; strict runtime canonicalization and browser bridge preserve it or reject invalid values.
- [x] Toronto recolors overview, resident adaptive nodes and manual detail for capture only. User's camera/display mode return synchronously, including render/extraction errors.
- [x] Capture-time `coverage.pointColorMode` is truthful; type captures carry a labeled semantic palette (including Unknown). Fixed edit/ghost/derived overlay styling is unchanged.
- [x] Live pixel grounding survives temporary recoloring, but subsequent user view/scene/mode changes still invalidate it.
- [x] Viewers without source color-mode support (synthetic) report unavailable for explicit mode rather than inventing RGB/types; omitted mode still works.
- [x] Deterministic contract/provider/bridge/render tests and desktop/mobile actual-source capture inspection.
- [ ] Fresh-session review; live-model behavior is not certified.

## Implementation
`packages/contracts/src/model-chat.ts` and barrel: additive optional mode. `apps/server/src/provider-model.ts`: optional enum/schema and bounded tool description; task061 instruction constants/readback unchanged. `apps/web/src/visual-capture.ts`: synchronous render-only mode adapter, capture-time coverage, finally restoration and post-restoration signature for grounding. `apps/web/src/toronto-viewer.ts`: shared recoloring for UI/capture and type-key metadata. No browser-result wire changes are needed.

## Verification
Node22.23.3, pnpm10.34.6.

- `pnpm typecheck` — passed, including zero Svelte errors/warnings; `/tmp/task062-typecheck.log`.
- `pnpm build` — passed; normal >500kB chunk warning; `/tmp/task062-build.log`.
- `node --import tsx --test tests/model-capture-bridge-colors.test.ts tests/model-capture-color-mode.test.ts tests/model-capture-render-colors.test.ts tests/model-capture-camera.test.ts tests/visual-observation.test.ts tests/model-agent-runtime.test.ts tests/model-visual-client.test.ts tests/candidate-assessment-prompt.test.ts tests/point-colors.test.ts tests/adaptive-render.test.ts tests/crop-render.test.ts` — **134/134 passed**; `/tmp/task062-regression.log`.
- `pnpm verify` — typecheck passed, then blocked by tsx CLI IPC `EPERM /tmp/agents/tsx-501/59292.pipe`; `/tmp/task062-verify.log`.
- Equivalent direct full-suite runner `node --import tsx --test --test-concurrency=1 tests/*.test.ts` — **1014/1016 passed** (before adding the three passing bridge tests), `/tmp/task062-tests.log`. Two existing UI-copy failures in untouched `tests/model-request-inspection-client.test.ts` (expects `inspection.source === 'client'`) and `tests/safe-markdown.test.ts` (expects old credentials sentence). These are also documented in tasks057/060; not weakened or changed here.
- LSP requested after changes: Toronto viewer/new bridge tests clean; cached cross-file errors still refer to the old capture contract/export in visual capture/render tests/barrel. Current CLI typecheck passes; no assertion that stale LSP is clean.
- `git diff --check` passed. Inspected task-owned changes while preserving the extensive dirty checkout; unrelated skill deletions appeared during this session and were not authored/reverted by this task.

### Browser evidence (no inference/mutations)
Used managed headless browser, own tab at existing local Vite `http://127.0.0.1:5173`, dynamically importing the actual Toronto viewer into an isolated temporary host. Loaded a read-only 10,000-point actual-source observation (`/datasets/toronto3d/observation?purpose=display&budget=10000&depth=3`), all nine semantic labels present. No approval/authority route invoked.

- Explicit desktop emulation **1280x720**: both capture modes × all three camera kinds × both UI modes (12 captures). Asserted differing RGB/type hashes, correct mode/key metadata, and exact baseline live-view hash after every request. Camera and UI mode preserved. `/tmp/task062-browser-captures.json` contains captured image bytes, hashes, cameras and viewport metadata.
- Mixed layers: actual viewer with 1,000 manual-detail points and nonempty adaptive source nodes, point budget100,000. Correct type metadata and exact RGB baseline restoration. `/tmp/task062-browser-mixed-layers.json`.
- Explicit mobile emulation **390x844**, DPR1: RGB/type pixels differ and omitted-mode capture exactly matches baseline after restoration. `/tmp/task062-browser-mobile.json`.
- Visually inspected comparison screenshots: `/tmp/task062-desktop-capture-comparison.png`, `/tmp/task062-mobile-capture-comparison.png`. Natural source appearance vs category palette visible; no camera displacement. Browser error/warning console list empty before final emulation. Development-module checks, not built-app or live-provider end-to-end certification.

## Graph / review
Repository/worktree `cad-agent` at `/Users/kevin/Coding/spatial-cad-harness`; index one commit behind. Pre-edit canonical validator impact **CRITICAL** (provider turn, browser-action canonicalization, visual capture and their downstream flows); explicit warning issued. `createVisualCapture` LOW, callers both viewers. `createTorontoViewer` and `CAPTURE_TOOL` UNKNOWN; confirmed Toronto/ClosestPole Svelte callers and provider tool assembly in source before edits. Aggregate `detect_changes(scope: all)` CRITICAL, 230 changed/142 affected symbols across39 files; not a task-isolated clean certification. No commit. Fresh review pending.

## Next action
Fresh-session review against this task and task-owned diff; keep the two unrelated broad-suite failures separate. No live/paid model call without authorization.
