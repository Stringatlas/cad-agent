# Task089 Phase 3 — composable agent view design

Status: design only, source-verified 2026-10-22. Runtime implementation and fresh
independent review remain pending. [Task089](089-agentic-scene-exploration.md) owns
the checklist; [Phase 2](089-capture-grounding-design.md) owns captured-frame picking.
This document does not change either milestone or claim implemented capabilities.

## Bounded outcome

The model can frame an independently resolved original reference or a declared,
checked spatial region, inspect the image, then orbit/zoom from that returned view.
It does not need to copy camera matrices or invent a world-space camera. Each call
is one observation. The model chooses its exploration sequence and hypotheses.

Reuse `scene.capture_scene`, the existing nonce-bound browser action, cloned capture
camera, capture-owned native detail lease, renderer and restoration path. No new
renderer, loader, orbit controls, viewport panel, geometry authority or general view
manager. Framing does not select/attach a source point or move the person's camera.
Moving their visible camera remains a separately requested interaction.

First implementation slice **3a** supports original source-point references and
inline boxes, top/oblique framing, and relative orbit/dolly from the latest successful
agent capture **within the current turn**. Slice **3b** adds polygon-prism validation
and framing by its enclosing box. No authored-object, CAD-body, cluster, mark-ID,
terrain-feature or arbitrary entity-ID target is advertised by 3a. Such adapters
need their own revision-checked lookup before becoming capture targets.

## Existing source seams

| Source | Current behavior and reuse |
| --- | --- |
| `packages/contracts/src/model-chat.ts` | `ModelCaptureRequest` has current/top-down/explicit camera, optional color mode; shared canonical validation feeds provider and browser. Source references are Toronto key or cloud ID/revision/key. Extend the existing capture request; preserve old forms. |
| `packages/contracts/src/visual-observation.ts`, `model-visual.ts` | Observation ID, source binding, full perspective camera, viewport, sent/source crop mapping and extensible coverage already exist. Use the observation ID as view reference; no second ID namespace. |
| `apps/server/src/agent/provider-model.ts` | Capability-gated registry, runtime visual skill, capture dispatch, image replay and turn-local latest image. Register only supported variants and keep skill/prompt parity. |
| `apps/server/src/agent/model-agent-runtime.ts` | Checks current bound authority around browser capture; selection and Phase 2 pixel verification independently resolve original records. Resolve frame targets using those read seams without browser selection or authority rebind. |
| `apps/server/src/agent/cloud-model-scene.ts` | Prepared `resolveReference` uses original-key query against the bound registered cloud/revision; context has source bounds/frame/origin. Toronto uses `readSourcePoint` and retained source metadata in `model-scene.ts`. |
| `apps/server/src/agent/model-browser-broker.ts` | Existing one-pending-operation, nonce/request/tool matching and 15-second deadline. Extend typed capture payload, keep transport-only role. |
| `apps/web/src/viewer/visual-capture.ts` | Clones camera; current top-down uses user orbit focus; explicit camera sets target; prepares frozen view detail; synchronous render/extract/restore; immutable Phase 2 snapshot precedes restore. Add framing math to this camera construction seam. |
| `apps/web/src/viewer/capture-detail.ts`, `adaptive-loader.ts` | Frozen projection/frustum/effective FOV, one serial lane/shared payload cache, frozen capture target, bounded admission and synchronous borrowed GPU projection. Ready means all admitted target nodes loaded, not whole source. |
| `apps/web/src/scenes/point-cloud/prepared-cloud-viewer.ts`, `scenes/toronto/toronto-viewer.ts` | Supply target, binding, coverage, supported colors, layer state, capture detail and source caches. Preserve their live controls/settings. Current prepared raster layer bypasses native point-detail preparation. |
| `apps/web/src/chat/visual/visual-model-source.ts`, `ModelChat.svelte`, `model-chat-client.ts` | Agent capture uses captureSnapshot when available; transport conversion/crop and browser callbacks already exist. Forward new checked capture variants through these interfaces. |

GitNexus was explicitly bound to `cad-agent`; query/context corroborated
`canonicalModelCaptureRequest`, `createVisualCapture`, `createModelAgentRuntime` and
`createPreparedCloudViewer`. The graph predates concurrent Phase 2/4a edits; current
source above was checked directly. No index refresh or existing symbol edit was
performed for this design. Upstream impact is required again before implementation.

## One compatible region value

Use a framework-free closed shared binding, compatible with the fields of
VisualBinding, but without arbitrary extension/authority keys:

```ts
type SceneSourceBinding = {
  sourceId: string; sourceRevision: string; // registered ID and SHA256 revision
  frameId: string; units: 'm'; origin: Vec3;
};
type SceneRegion = {
  binding: SceneSourceBinding;
  shape:
    | { kind: 'box'; bounds: { min: Vec3; max: Vec3 } }
    | { kind: 'polygon-prism'; polygon: Vec2[]; z: { min: number; max: number } };
};
```

Names are proposed contracts, not already exported types. Root agreed this value
shape as the Phase 4 integration seam. All coordinates are local meters, Z-up/right
handed for the currently supported adapters. Origin is the explicit source/world
translation; do not add/subtract it when local coordinates already match the frame.
Prepared and Toronto source revisions are SHA256 strings. A pole scene without an
original-source binding cannot advertise source-region/reference framing.

Validate exact keys, finite binary64 values, coordinate absolute value <= 1e7,
correct vector lengths, SHA256/token bounds and `min <= max` on every axis. Detach
inputs before asynchronous lookup. Compare every binding field with server-bound
source metadata; model/browser values cannot choose a registration, frame mapping
or replacement authority. Wrong identity/revision fails closed.

Polygon prisms have 3–64 distinct vertices, implicit closing edge, no repeated closing
vertex, holes, self-crossings, touching nonadjacent edges or zero area. Accept either
winding; reject malformed topology rather than repairing it. Use a bounded robust
2D orientation/intersection implementation or an established library already in the
toolchain; do not rely on the terrain validator alone (it checks numeric shape and
delegates topology to Shapely). Any later reuse by terrain tools requires an explicit
adapter and the terrain model's own revision/NoData checks. Z range is required;
omission cannot mean infinite height or an inferred ground surface.

Validation establishes a **declared investigation region**, not occupied geometry,
a measured extent, a source subset, an AOI authority, suitability or free space.
No region/evidence persistence or IDs are introduced. Phase 4 can pass this same value
between tools; tools still declare their own original/effective/derived evidence scope.
For polygon framing, preserve the polygon in the receipt and explicitly report that
only its enclosing box was fitted. Rendering is not polygon masking or cropping.

## Proposed capture requests and results

Keep the model tool name and old capture forms. Add these discriminated variants
(illustrative TypeScript; final JSON schemas must be closed and runtime-validated):

```ts
type FrameTarget =
  | { kind: 'reference'; reference: ModelReferenceSelection; spanMeters: number }
  | { kind: 'region'; region: SceneRegion };
type AgentCapture =
  | { kind: 'frame'; target: FrameTarget;
      orientation: 'top' | 'oblique'; colorMode?: ModelCaptureColorMode }
  | { kind: 'relative'; observationId: string;
      azimuthDeltaDegrees: number; elevationDeltaDegrees: number;
      distanceScale: number; colorMode?: ModelCaptureColorMode };
```

Reference targets reuse existing source-key forms and independent bound lookup.
`spanMeters` is the requested framing width around that one original point, not its
physical extent; require 0.2–100,000 meters and report it as requested context. Never
trust a position attached to a reference or resolve by nearest displayed point.
Toronto targets use original coordinates even when accepted overrides are visible;
the receipt says original-source target and distinguishes the rendered accepted state.
No automatic switch to effective coordinates. Object/body references remain unsupported.

The server resolves a reference to an exact original point and a centered framing
cube, or validates a declared region and derives its enclosing box. Check bound
source/authority before and after lookup and after capture. Region/source AABB overlap
may be reported, but never silently clamp the requested region. A disjoint region
returns recoverable `outside-source-bounds`; overlap alone does not promise points.
Binding and identity violations remain hard errors, not recoverable observations.

Separate model-facing targets from a **normalized browser capture payload**. The
browser receives only checked binding, numeric framing box/pivot/orientation or a
bounded issued base-view record plus relative deltas, never a model-supplied assertion
that a source/entity was verified. Add a shared BrowserCaptureRequest type at the
existing browser-action boundary rather than passing unresolved references through
to the viewer. Canonicalize both boundaries. No server direct Three.js/kernel import
is needed: source lookup/region validation stay server-side, camera construction
stays in the shared browser capture path.

The existing captured observation/image delivery remains the result. Put a bounded,
versioned `coverage.agentView` receipt in the existing JSON extension slot; validate
it explicitly, not merely as arbitrary JSON. It contains pivot, fitted box, original
region/target classification, orientation/azimuth/elevation/distance, requested/applied
relative deltas, actual active layer/color, and scope/lifetime. The full camera and
binding remain in their established observation fields. Server-side target receipt
fields are assembled from normalized inputs/lookups; browser-observed camera/coverage
are labeled as such. Do not echo extra browser fields as verified evidence.

Only `observationId` is needed as the subsequent view argument. Do not expose loader
node names, cache keys, render-object UUIDs, capture tickets, nonce or authority session
IDs as model view handles. An ID grants neither original geometry nor approval.

Successful output examples are a captured, ready target with `budgetLimited: true`
or a valid image with grounding unavailable. Both can still supply a usable view
base. The region fit never promises that it is visible, unoccluded or well sampled.
Keep captureDetail readiness, target-budget limitation, whole-source completeness,
image validity, grounding availability and view-base availability separate.

## Deterministic camera construction

Use a pure helper called from the existing capture-camera construction seam; reuse
Three.js vector/camera math, not OrbitControls or a second scene. The following rules
are part of the testable behavior:

- Pivot is framing-box center. For a point the framing cube uses requested span.
  Flat/line/point boxes are valid declarations; use a **0.2 m minimum visual envelope**
  only for fitting and disclose expansion. Do not rewrite the region's coordinates.
- Top looks along -Z, with +Y image-up and +X image-right. Oblique defaults to
  azimuth 45 degrees and elevation 45 degrees. Azimuth zero places the camera toward
  +Y; positive azimuth rotates toward +X. Elevation is measured above XY.
- Use a fixed 50-degree vertical perspective FOV and zoom 1 for new framed views;
  aspect comes from the frozen drawing-buffer dimensions, independent of CSS pixels.
  Current/top-down/explicit-camera legacy behavior stays as currently defined.
- Fit all eight box corners with a 1.1 padding factor in both screen-space axes. For each corner
  offset q in the camera right/up/back basis, choose distance d satisfying
  `d >= q.back + 1.1*abs(q.right)/tan(horizontalFov/2)` and the corresponding vertical
  inequality, plus positive depth clearance. This handles depth and narrow/mobile
  aspects; a diagonal-size-only fit is insufficient. Recompute projection matrices.
- Compute near/far from the target envelope's positive camera depths with explicit
  safety margin, near >= 0.01 m, far > near. These planes may clip other scene data;
  return them in camera metadata and label scope as target-framed. Do not claim
  whole-source coverage. Reject infeasible finite ranges instead of silently clipping
  the target or manufacturing an identity camera.
- Relative operations keep the issued pivot and lens; add azimuth/elevation, then
  multiply camera-pivot distance by distanceScale. This is a dolly, not image cropping
  or a change to the user's display zoom. It can intentionally crop the old target;
  report target-fit no longer guaranteed after an inward dolly.
- Deltas are finite, azimuth [-180,180], elevation [-85,85], distanceScale [0.25,4].
  Normalize azimuth; resulting elevation must be [5,90]. Top retains its stored
  azimuth even though it is visually indeterminate, making the next oblique step
  deterministic. Clamp neither elevation nor distance silently: reject out-of-range
  results with a recoverable reason and supported limits.
- Require distance in [0.2,1e7] m, camera/pivot components within +/-1e7, finite
  projection/matrices and far/near <= 1e7. Recompute depth planes around the pivot
  envelope after relative movement. Include pivot depth d and every positive corner
  depth; near is half their minimum (at least 0.01 m), far is their maximum plus
  `max(1 m, 0.1 * positive-depth-range)`. Corners behind the camera are excluded only
  from this plane calculation and explicitly mark target-behind/cropping in the receipt;
  never imply the old region still fits. Pathological depth precision returns
  `numerical-range` and no capture. These are proposed numerical constants to verify
  on actual prepared/Toronto bounds before runtime acceptance.

No arbitrary up vector or quaternion in the new model-level variants. This avoids
singular parallel-up inputs and removes camera-matrix copying from ordinary work.
The existing explicit-camera form remains available as a lower-level operation.

## Ephemeral base-view lifetime

Use the runtime's latest **successfully validated agent capture**, with a detached
small camera/pivot record, as the only base. It is issued under the current turn,
source binding and authority checks. Initial user attachments, historical replay
images, model-provided matrices and browser-provided IDs do not create an issued base.
Make the validation/receipt assembly explicit for every capture variant; old captures
with no pivot receipt are not silently interpreted using the person's current target.

The first slice retains at most one record, <=16 KiB including a 64-vertex region,
with a maximum five-minute monotonic lifetime and the current turn's shorter lifetime.
Expiry starts when the source image was captured, not when hashing/delivery finishes.
Use existing observation identity. Resolve/copy the base for a relative request before
starting replacement; replacement revokes the prior ID, even if the new capture fails.
Do not pin the previous Phase 2 snapshot while making another view. Navigation,
recoloring and resize do not change that issued base camera; a resize only changes
the next image's aspect. The requested relative direction/pivot remains explicit.

Grounding and base metadata have independent availability. A snapshot memory denial,
unsupported blocker or disabled picking does not prevent a valid camera receipt from
being used to request another view. A new capture invalidates the previous pixel
snapshot under Phase 2 policy. No relative operation extends old pixel validity.
Clear base on source/frame/origin replacement, any authority rebind in the first
slice, cancellation, account change, new chat, disposal/context loss and turn end.
Late results cannot recreate cleared records. Wrong/expired/evicted ID returns bounded
`view-unavailable` with a reason; it never falls back to the user's current camera.

Cross-turn 'zoom in there' is explicitly **not supported by 3a**: the historical ID
is evidence, not a usable view handle after turn end. Phase 7 can retain the same small
issued record as one optional conversation-owned last view (no image/binary snapshot),
bounded by the same five-minute/source/account/model lifetime and only published after
successful turn completion. Inject it into the next runtime after admission/revalidation.
That extension must test failed-turn nonpublication, authority invalidation and expiry;
it should preserve observationId-based calls rather than require manual world cameras.

## Layers, LOD, restoration and resource bounds

The first slice inherits the current visible scene layer. It does **not** accept a
layer-switch argument. Advertise per-adapter supported capture colors, source target
kinds and current layer; unsupported combinations return `unsupported`, not RGB or
a different layer by fallback. Prepared RGB/semantic/type-alias/instance depend on
actual attributes; Toronto's supported set remains adapter-specific. A derived
elevation image declares its layer/model revision/NoData coverage and cannot claim
point-detail readiness or original-point grounding. A point color request on a raster
layer is unsupported. Adding temporary layer choice later needs a render-only lease
with exact restoration and capability disclosure.

Use the same capture-owned LOD planner with the resolved camera/pivot/effective FOV.
Await all nodes of that frozen **admitted** target and render/extract the frame before
returning; do not await the continuously changing user queue. Missing/error/timeout
target data returns unavailable, not ready. Empty admitted target is explicitly empty
display support, not a whole-region no-point/free-space result. Keep the shared cache
and one physical lane; no duplicate source downloads, scene clone or extra GPU cloud.

Preserve the 3M default and persistent custom cap through 50M. View requests cannot
raise budgets, enable the user's background detail, change layers, write localStorage,
change selection or annotation state. Camera/color/render buffer borrowing remains
synchronous with restoration in finally. User navigation during asynchronous loading
updates their live view and must be the view shown after restoration. Do not restore
a stale pre-navigation camera/settings snapshot. Resize, layer/budget/source changes,
superseding capture, cancellation and disposal cancel incompatible jobs; late results
cannot render into a new viewer. Continue Phase 2 source checks and snapshot limits.

New overhead is bounded numeric validation (64 polygon vertices, bounded intersection
checks), eight fit corners and one <=16 KiB base record. Existing limits remain: one
pending browser RPC, 15-second broker deadline, 11-second capture preparation bound,
image/dimension/history/tool-call limits, shared native cache/GPU budgets and Phase 2
192 MiB snapshot admission. Do not claim those point/snapshot caps bound total process
RAM. No new unbounded history, task pool, render loop or retained region collection.

Safe read failures use a closed result/reason vocabulary: invalid-region,
outside-source-bounds, invalid-view-adjustment, numerical-range, unsupported,
view-unavailable (expired/replaced/turn-ended), detail-unavailable and cancelled.
Implement only needed variants and keep reasons bounded. Wrong source identity,
forged reference/receipt, stale authority or nonce violations retain existing hard
errors. Never retry mutations or turn failure into a valid observation.

The current browser answer/adapter represents unavailability without a reason, and
`model-chat-client.ts` catches capture errors into that generic answer. To deliver the
new bounded recovery codes, add an optional closed capture reason to that existing
unavailable answer and a typed capture-unavailable result through runtime/provider.
Only expected safe camera/layer/detail failures become these codes; arbitrary browser
exception text is never echoed. Preserve old `{status:'unavailable'}` compatibility,
nonce/action validation, and the hard cancellation/security paths. This is capture
result plumbing within 3a, not a new general error framework or permanent UI panel.

## Implementation slices and acceptance

1. **3a: references, boxes and relative views.** Add closed source binding/box target
   contracts and high-level frame/relative variants; adapter capabilities; independent
   original lookup; normalized browser payload; shared camera helper; typed receipt and
   turn-local latest base; capture/registry/runtime-skill/prompt/replay integration.
   Preserve all existing forms, source checks and approval waits. Advertise exactly
   source-point/box/top/oblique/relative/current-layer combinations implemented.
2. **3b: polygon-prism values.** Add bounded topology validation and enclosing-box fit,
   preserving the original region and fit method. Reuse shared region contracts in
   future Phase 4 operations through explicit adapters; no durable IDs or occupancy
   claims. Do not advertise polygon before this slice is verified.
3. **Cross-turn/layer/entity extensions are separate.** Phase 7 owns resume retention;
   later source-bound entity adapters and render-only layer choice require new scopes.

Before each runtime edit, perform fresh graph-first exploration/upstream impact,
warn on HIGH/CRITICAL and verify dynamic callers in source. Existing source is changing
under Phase 2/4a; do not implement against old line numbers or replace their runtime
verification/marks work. Read architecture/product vision and product-agent-tools;
use installed rendering/browser skills if available and record absence honestly.

| Verification | Required oracle/scenarios |
| --- | --- |
| Contracts and targets | Missing/extra keys; nonfinite/oversized vectors; SHA/source/frame/origin drift; degenerate boxes; zero/negative span; unknown/cloud-mismatched key; polygon topology and 64-vertex cap in 3b; closed schema/runtime parity. |
| Original lookup | Frame an unattached real source point, independently compare exact binary64 center; forged client position ignored; Toronto accepted override never changes original target; stale lookup rejects before browser dispatch. |
| Camera geometry | All box corners project to normalized absolute X/Y <= 1/1.1 after fitting in portrait/landscape; top axes and fixed oblique; flat/line/point visual expansion; huge/narrow/negative-coordinate boxes; near/far positivity and target clipping; deterministic relative signs, top-to-oblique azimuth, inward crop and limits. |
| Issued view base | Latest ID only; wrong/historical/attachment IDs; five-minute/turn expiry; failed replacement; captured-but-grounding-unavailable base works; relative capture revokes old pixel lookup; resize keeps pivot; no silent current-camera fallback. |
| Bridge and lifecycle | Real nonce-bound request/result/image replay; stale async lookup/capture; cancellation/context loss/dispose/source/account/authority change; same-scene supersession; no mutation or approval endpoint. Existing approval/rebind tests pass. |
| LOD and user state | Hold an admitted native node: no early image; navigate/recolor while loading; image uses requested view; final user camera/target/colors/layer/selection/cap/background-detail remain theirs; cache reused; unsupported raster/color and incomplete target are honest. |
| Built browser | Fixture provider frames a known prepared/Toronto reference/box, returns observation, then orbits/dollies from its ID and grounds a supported captured point through Phase 2 verification. Exercise mobile aspect, error/cancel and budget-limited/grounding-unavailable states; inspect screenshots and page errors. |

Run focused contract/camera/runtime/bridge tests, typecheck, build, relevant baseline
tests and fixture-browser checks; record exact commands, counts, bytes/latency and
artifacts. No paid/live inference is included. Independent fresh-session review is
required after each runtime slice; this design is not runtime verification.

## Concrete next action

After Phase 2 acceptance and independent review of this design, assign **3a only**:
source-point/box framing plus current-turn relative orbit/dolly through the existing
capture path, with the matrix above as acceptance criteria. Root owns Task089 checkbox
updates. No runtime code or roadmap checkbox was changed by this design assignment.
