# Task087 — Capture-owned point-cloud detail

Status: implemented; baseline and browser verification passed; fresh-session review pending.

Fix agent screenshots that render a requested camera before that camera's bounded
native LOD target has loaded. Applies to prepared clouds and Toronto. Preserve
concurrent terrain/UI work already present in the checkout.

Acceptance criteria:

- A frozen current/top-down/explicit capture camera owns an independent frustum,
  focus and admitted native-node target. Await that target and its synchronous
  rendered frame, never global queue emptiness or an arbitrary delay.
- Share the existing planner, serial loading lane, binary loaders, payload cache
  and GPU projection. Reuse overlapping/cache-resident nodes. Capture loading
  temporarily takes priority; user camera navigation remains independent.
- Preserve user camera, point colors, layer and detail settings. Retain user
  geometry while loading; restore it even when rendering/extraction fails.
- Bound CPU payload residency to user and capture targets (at most two display
  budgets), GPU native residency to one display budget and capture duration to
  11 seconds within the browser tool's existing 15-second deadline.
- Coverage records admitted target points/nodes, point budget and budget limitation;
  whole-source completeness stays false. Missing/error/timed-out detail fails
  explicitly. Keep capture-time provenance; fail closed on pixel grounding once
  borrowed geometry is restored or the scene changes.
- Abort superseded, cancelled, disposed and stale-source work. Resume background
  refinement after release, without overlapping physical requests or late adds.
- Deterministic tests cover delayed/off-screen loading, concurrent navigation,
  cache reuse, budgets, failures, cancellation and restoration. Check actual browser
  behavior, baseline checks, exact results and artifact paths before handoff.

Implementation:

- `viewer/adaptive-loader.ts` owns user/capture demands and a bounded shared
  payload cache. `toronto/display/adaptive-display.ts` retains Toronto protocol
  validation and uses that scheduler. Existing binary clients/planner are reused.
- `viewer/capture-detail.ts` derives frustum/zoom/focus from the frozen camera.
  `visual-capture.ts` waits for the admitted target, borrows/restores the existing
  render projection synchronously, then hashes immutable pixels. The bridge
  passes turn cancellation through to the viewer. Capture-only load failures do
  not latch or starve the user lane; user-loading errors still require retry.
- The recent capture target stays cached alongside user geometry. Toronto can
  retain a capture-only scheduler while background detail is disabled, then
  transfer it to background demand when enabled. Prepared surfaces keep their
  existing raster layer and skip native-point demand.
- Coverage includes `captureDetail.status`, target points/node count, point
  budget and budget limitation. `complete` remains false. Only an unchanged
  restored render/provenance signature retains pixel grounding; borrowed buffers
  that differ from the user display deliberately leave grounding stale.
- Prepared GPU uploads accumulate across multi-node packing; intermediate
  borrowed sets are never rendered with the user camera.

Verification (2026-10-22, Node 22.23.3, pnpm 10.34.6):

- `pnpm verify > /tmp/capture-verify.log 2>&1` — exit 0; typechecks with zero
  Svelte warnings/errors, 1,025 tests pass, web build/server typecheck pass.
  Existing Vite chunk-size advisory remains.
- `node --import tsx --test tests/viewer/capture-detail.test.ts >
  /tmp/capture-detail-tests-final.log 2>&1` — 9/9 deterministic tests pass.
  They cover deferred off-screen targets, concurrent navigation, shared in-flight
  ancestors, preemption without overlapping requests, warm-cache reuse, budget
  limitation, errors, abort/replacement/config/reset/dispose, stale source,
  extraction restoration, deadline cancellation, GPU uploads and exact provenance.
- `node --import tsx scripts/browser-capture-lod-smoke.mjs
  http://127.0.0.1:9223 > /tmp/capture-browser.log 2>&1` — passes against the built
  app and real STPLS3D/Toronto native artifacts, using a local fixture provider
  (no live inference). Report and screenshots: `/tmp/capture-lod-browser/`.
  Checks: held off-screen target cannot finish early; user geometry remains while
  navigating; semantic screenshot restores RGB; repeat capture makes zero new
  downloads; failed native response returns unavailable; Toronto top-down leaves
  camera/orbit unchanged; disabled background detail remains disabled and its
  capture-only cache is reused. Desktop/mobile restoration and returned capture
  PNGs were visually inspected.
- `git diff --check` — passes. Source diff inspected while preserving pre-existing
  terrain/UI changes. GitNexus `impact` reported LOW for scheduler/capture/render
  helpers; UNKNOWN viewer entry-point callers were confirmed in Svelte source.
  `detect_changes(scope: all)` reports critical aggregate risk over the combined
  working tree (153 changed symbols, 94 affected flows, 32 tracked changed files),
  without partial/truncated flags; `/tmp/capture-lod-graph-analysis.json`.

Earlier diagnostics: the first full test run had an intermittent disk-storage
cancellation-cleanup failure in `tests/spatial/semantic-disk-storage.test.ts`;
its isolated 14-test rerun and subsequent full verification pass. An early
browser fixture attempted continuation after an image and the next turn failed
before provider dispatch; the capture regression script uses isolated fixture
conversations. Continuation behavior was not certified by this check. The initial
Chrome :9222 endpoint closed, so final browser checks use an isolated :9223
profile (`/tmp/capture-lod-chrome`). Browser skill packages named in AGENTS.md
were not installed in the searched locations; existing Playwright smoke patterns
were used.

Remaining: independent fresh-session review against this task and the actual
combined diff, including shared-scheduler cache/lifecycle boundaries. No commit
or live-provider certification was performed. Suggested next action: fresh-session
review; preserve all pre-existing terrain/UI edits.
