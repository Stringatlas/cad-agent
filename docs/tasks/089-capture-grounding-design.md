# Task089 Phase 2a — captured-frame grounding design

Status: single-pixel slice accepted 2026-10-22 after verification and independent review.
The coordinating owner accepted this design before runtime assignment. [Task089](089-agentic-scene-exploration.md) owns the roadmap.
Phase 1 must be accepted before runtime work. No new model tool, renderer, downloader,
geometry authority or region-query implementation is proposed in this slice.

## Outcome and evidence semantics

An agent can capture a camera view, let the viewer restore its user camera/native
buffers, then ask `resolve_visual_pixel` about that exact image. A retained immutable
pick snapshot supplies original source identity and binary64 coordinates. Navigation,
LOD compaction, recoloring and resize must not redirect the lookup to live geometry.

The result means **one original displayed point center within the declared image-pixel
tolerance, not blocked under the supported visibility rules**. It is not exact sprite
raster identity, a nearest visible surface, a reconstructed solid or verified free
space. More than one eligible source point is ambiguous regardless of depth; never
choose the nearest to make a dense view appear resolvable. Server verification proves
the original record exists with the stated coordinates and binding. It cannot prove
the browser image corresponds to that record or independently certify visibility.

## Source-verified integration seams

| Path | Current behavior / proposed reuse |
| --- | --- |
| `apps/web/src/viewer/visual-capture.ts` | Freezes camera/image metadata, prepares a capture LOD lease, synchronously renders/restores, then hashes. Retains live object references only when `borrowed.changed` is false and live signature still matches. `resolvePixel` consults mutable geometry and `options.resolve`. Snapshot creation belongs inside the borrowed-render critical section before restore. |
| `apps/web/src/viewer/adaptive-loader.ts` / `capture-detail.ts` | Existing capture-owned frozen view demand and shared serial loader/cache. Keep this path; no extra loading for picking. |
| `apps/web/src/viewer/native-cloud-render.ts` | Prepared renderer holds packed Float32 positions and original payload spans; `resolve(index)` searches spans and returns payload/index. Add bounded bulk extraction from spans instead of calling resolve per point. |
| `apps/web/src/scenes/point-cloud/prepared-cloud-viewer.ts` | Overview `sample.positions/sourceIds` and native payload Float64 positions/Uint32 keys are available. `points()` identifies source layers; elevation mesh images explicitly lack point provenance. `prepared-cloud-client.ts` and `prepared-cloud-lod-client.ts` validate sample/native identity. |
| `apps/web/src/scenes/toronto/display/adaptive-render.ts` | Batches hold rendered positions, keys and spans into owned binary64 payloads. It already copies originals separately from committed override projections; bulk export can copy span ranges in current draw order. |
| `apps/web/src/scenes/toronto/inspection/pole-picking.ts` | Overview/manual detail caches privately own binary64 positions and keys. Add a bounded copy-to-target operation; never expose mutable aliases or call object-producing `resolve` millions of times. Existing key copies are Float64: validate integer range before Uint32 snapshot conversion. |
| `apps/web/src/scenes/toronto/toronto-viewer.ts` | Native material uses opaque circular splats through `onBeforeCompile`; source resolution is withheld for point edits or authored imagery. Capture also includes CAD, ghosts, overlays and manual-detail opacity. Preserve image delivery, fail closed for unsupported grounding. |
| `apps/web/src/chat/ModelChat.svelte`, `visual/visual-model-source.ts`, `model-chat-client.ts` | Capture attachment closures currently use `isCurrent`; pixel RPC uses `modelVisualSourcePixel` before resolving then translates coordinates back to the sent image. Add snapshot availability semantics without removing crop/nonce/identity checks or silently widening manual attachment semantics. |
| `packages/contracts/src/model-visual.ts` / `visual-observation.ts` | Original viewport/camera and crop/output mapping are explicit. Results already distinguish resolved/ambiguous/no-hit/stale/invalid/unavailable. Metadata can describe bounded grounding availability using existing JSON extension fields; binary buffers stay browser-local. |
| `apps/server/src/agent/model-chat-routes.ts` | An outer Proxy currently forwards `resolveVisualPixel` directly to `ModelVisualBroker`; remove that bypass when inserting verified runtime resolution. |
| `apps/server/src/agent/model-visual-broker.ts` | Enforces one pending RPC, nonce, request/tool/observation ID and sent x/y. It validates bounded shape, **not original source record correctness**. Keep it transport-only. |
| `apps/server/src/agent/model-agent-runtime.ts` | Selection already independently reads Toronto original source or prepared `current.resolveReference`, checks browser result and rebinds. Reuse those read operations for pixel verification **without selecting or rebinding**. |
| `apps/server/src/agent/cloud-model-scene.ts` / `datasets/source-point.ts` | Prepared `resolveReference` checks cloud/revision and `reader.queryOriginal(...operation:'key')`; Toronto `readSourcePoint(directory,{revision,key},signal)` resolves original native records. Use these established adapters; no parallel source index. |

GitNexus query results corroborate the capture/pixel and model route flows; source is
authoritative for dirty capture/LOD code absent from the index. No existing symbol
is changed by this document. Run fresh upstream impact before each implementation
edit, including caches, runtime proxy, route, capture and attachment adapters.

## Browser-owned snapshot

Use one private record per capture owner, never a serialized server capability:

- Detached immutable binding, camera, full source image dimensions, image identity,
  pixel tolerance, created-at/deadline and observation ID.
- Per supported visible source layer: owned Float32 rendered positions (12 bytes per
  point), owned Float64 original coordinates (24), owned Uint32 source-file/row pair
  (8), plus one detached binding/layer descriptor and frozen matrixWorld/draw range.
  Copy only active draw ranges; do not include unused packed capacity. Source and
  display arrays may differ in precision, but edited positions are unsupported.
- Supported occluding meshes: copied position/index attributes, frozen world matrix,
  draw range/groups, material side/depth/visibility flags. No normals, colors,
  textures or full material/scene clone needed for the supported raycast subset.
- The snapshot owns its arrays. No spans, `BufferAttribute`, source cache, material,
  mesh or live resolver alias survives into retention. JS `Object.freeze` is not
  sufficient for typed arrays: keep them private and expose bounded resolution only.

Add bulk writer interfaces to renderers/pick caches. A caller first requests exact
counts/byte costs and a small descriptor list, reserves budget, then copies ranges
into owned destination arrays. Native spans can use typed `.subarray`/`.set`; overview
JSON arrays use numeric loops into typed destinations. Check revision/count/key
limits before admission and per bounded span. One provenance object is constructed
only for the final unique point; no per-point object, string ID or Map is needed.

Capture sequence: revoke prior grounding; prepare lease; preflight support/bytes;
borrow and render frozen camera; extract PNG; copy exactly the geometry/provenance
used for that image while borrowed state is still installed; restore live scene in
`finally`; release lease; hash image; publish snapshot only if capture ticket/source
binding/abort/deadline still valid. A failed snapshot does not make a valid image
unavailable: return the image with explicit grounding unavailable and reason. A render
or image extraction failure still fails capture normally. Partial snapshots are never
published. Recolor does not require copying color buffers for pixel candidate picking.

## Supported visibility and failure policy

Keep the existing three-pixel center tolerance and pixel-center convention. Clip
centers against all six frozen-camera clip planes. Retain original object transform
and layer mask. Test blocking meshes along each candidate's actual projected sightline,
as current code does; a tolerance candidate may not lie on the requested pixel ray.

Initial supported source points: ordinary opaque PointsMaterial with known renderer
state, including the explicitly recognized Toronto opaque circular-splat material.
The circular shader discards sprite corners, so this center-based operation still
cannot assert that the requested pixel was covered by that circle. Declare that limit
in result/method metadata and runtime skill text; do not call it exact pixel identity.
Point-point overlaps stay ambiguous, including front/back points inside tolerance.
Do not infer source visibility from a nearest-depth heuristic.

Supported mesh blockers: static opaque, depth-tested, depth-writing untextured triangle
meshes with standard side semantics, no clipping/displacement/alpha discard/deformation
or custom shaders. Copy index and draw groups accurately. Transparent ghosts, point
edit previews, authored datums, translucent manual overview, arbitrary custom shader,
alpha texture, clipping planes, unsupported render order/depth state, sprites, lines,
instancing/skinning/morph targets and derived raster layers fail grounding closed for
the whole capture until exact conservative handling is implemented. Images remain
usable. In particular, simply omitting an unsupported blocker would falsely claim
unoccluded source visibility. Known source-independent markers may only be ignored
if they were absent from the rendered image; otherwise initially return unavailable.

For supported data: zero eligible points is no-hit; two distinct eligible source
records is ambiguous. Duplicate display records require exact key/binding/original
coordinate agreement before optional deduplication; otherwise ambiguous. If scan or
blocker work stops early, return unavailable, never resolved/no-hit. Stale source,
expired/evicted observation and invalid coordinates remain distinguishable by status
and bounded safe reason. No empty pixel establishes an empty volume.

## Resource and lifecycle decisions for the first slice

Proposed fixed internal limits (not a new display setting): **192 MiB total snapshot
admission**, including owned point/blocker buffers, descriptor/matrix bookkeeping and
an explicitly reserved scratch allowance. Point storage alone is `44 * count` bytes:

| Displayed points | Point buffers only | Grounding behavior |
| --- | --- | --- |
| 500,000 | 22,000,000 bytes ≈ 21.0 MiB | Admit if blockers/overheads fit. |
| 3,000,000 default | 132,000,000 bytes ≈ 125.9 MiB | Usually fits, but admission still counts overview/manual layers and blockers. |
| 12,000,000 | 528,000,000 bytes ≈ 503.5 MiB | Reject before point allocation. |
| 50,000,000 custom | 2,200,000,000 bytes ≈ 2.05 GiB | Reject before point allocation; capture image may still succeed. |

Do not increase/reduce the person's 3M default or persistent custom display cap. A
point cap is not total process RAM: existing native cache, packed CPU/GPU buffers,
PNG/base64, decoder buffers and this extra snapshot coexist. Fixed snapshot admission
does not certify that the whole process fits any particular machine.

Reserve 16 MiB for bounded scratch and descriptors; charge actual typed-array byte
lengths plus conservative object bookkeeping. Preflight at most 1,024 source/blocker
objects and 1,000,000 blocker triangles, with all blocker indices/positions counted.
These are proposed implementation constants to validate with actual-source timing.
Reject over-budget or unsupported scenes before allocating large arrays. Catch typed
allocation failures and discard partial state. Free the prior snapshot before starting
replacement so old+new snapshots do not double peak retention; failed replacement
leaves no older resolvable snapshot. Clearing references makes buffers eligible for
GC but cannot promise immediate OS memory reclamation.

Do not call `THREE.Points.raycast` over millions of candidates: its full hit array is
unbounded relative to useful output. Reuse Three camera/vector/projection math with
one bounded streaming candidate scan, bounding-box rejection and reused temporary
vectors. Retain at most two distinct eligible candidates; stop ambiguous when safe.
Use frozen Three mesh raycasts only within bounded blocker admission, or a bounded
first-hit triangle scan when standard raycast output cannot be bounded. No new
renderer or spatial download layer is needed. Explicit operation/elapsed limits and
checks between small fixed spans bound CPU work; synchronous work cannot be cancelled
by a timer that has not run. Use a monotonic deadline inside loops as well as abort
checks, and return unavailable if work is incomplete. Initial proposed per-resolve
CPU deadline 500 ms and per-copy deadline 250 ms require fixture/actual-source timing;
never relax correctness to meet them. A worker can be a later measured optimization.

Retain latest-only for **five minutes from capture**, with monotonic expiry checked
on lookup and a cleanup timer. Starting replacement revokes old; cancelled/replaced
capture cannot publish; dispose, WebGL context loss and source/frame/revision change
release retained state and abort in-flight work. User orbit, resize, display quality,
color or layer change alone does not rewrite an already captured snapshot. An unknown
old ID must not evict the latest. New chat/source teardown explicitly releases the
attachment/owner; account/turn cancellation revokes in-flight results and does not
publish late snapshots. Historical images can remain in conversation after grounding
expires. New-turn history does not grant live grounding: keep current-turn latest-image
dispatch restriction unless a later task explicitly designs resumable observations.

Manual screenshots currently carry live-view-dependent pick semantics. Keep that
legacy path explicit if tests/UI rely on it; introduce a private viewer capture policy
or separate adapter method for **tool** immutable snapshots rather than infer policy
from camera kind. Do not silently change `isCurrent` globally: add a snapshot-valid
query or capture-owned attachment closures and preserve manual legacy checks.

## Independent original-record verification

Move verified pixel resolution into `createModelAgentRuntime` by injecting the current
turn's existing visual broker (or a typed resolve callback). The route must forward to
that runtime method, not its current outer proxy bypass. The broker retains nonce,
observation and coordinate matching; verification follows its consumed result.

Track the latest validated capture metadata in runtime, including attached initial
image; update after `validateModelVisual` succeeds. Require requested observation and
sent pixel to match that metadata. For resolved results, canonicalize a closed original
provenance shape: dataset ID, artifact revision, key, binary64 position, frame, meters,
origin and declared source layer. Require exact current source binding, including
revision. A historically valid image can still be displayed but cannot yield a current
source reference after binding changes. Check current authority before and after all
asynchronous lookups with existing read retry/cancellation guards.

- Prepared: construct a checked cloud-point reference from **server-bound** cloud ID
  and revision plus returned key; use `current.resolveReference`. Compare returned
  original Float64 coordinates exactly, independently validate frame/origin/units.
- Toronto: use server-bound artifact revision and `readSourcePoint(directory,{revision,
  key},signal)`, then compare original position and fixed Toronto frame/origin. Do not
  grant original provenance to effective/preview positions. Preserve current edit
  authority checks around lookup.

Only a matching original record produces a reusable checked source reference and
server verification receipt. Do not echo arbitrary browser-supplied fields as verified.
The browser's capture-time visibility claim remains separately labeled. Wrong IDs,
wrong coordinates or protocol violations fail closed; no proposal/selection/approval
or authority rebind occurs as a side effect. Preserve canonical event result limits,
request/tool/nonce consumption, sent/source crop coordinate checks and replay data
boundaries. Update runtime skill and exact prompt parity only where semantics change.

## Sequential implementation slices and acceptance

1. **Snapshot ownership/admission and bulk exports.** Add private typed record and
   count/byte preflight, bounded copy interfaces in prepared/Toronto caches/renderers.
   Test exact Float64/key order after compaction, no live alias, draw-range/transform
   preservation, byte arithmetic overflow, 3M accounting and 50M early rejection.
2. **Immutable capture retention and picking.** Integrate before borrowed restore,
   separate legacy/manual availability, bounded center candidate and supported blockers.
   Test off-screen/top-down, borrowed mutation/restoration, occluded/no-hit/ambiguous,
   clip planes, circular-splat limitation, unsupported shader/alpha/edits, expiry,
   replacement/cancel/dispose/source changes, resize/navigation and allocation limits.
3. **Verified runtime result.** Route broker result through runtime source verification;
   test forged key/position/frame/revision/origin, stale async result, expired ID,
   cross-observation/turn/nonce replay, crop mapping and checked reusable references.
   Existing approval/rebind tests must continue passing.
4. **Built-browser evidence and review.** Extend fixture-provider smoke to capture an
   off-screen native view, restore/repack/navigate the user view, resolve a unique known
   source point from the captured image and independently compare its source record.
   Exercise dense ambiguity, unsupported/edited images, cancellation, resource denial,
   source replacement and mobile/crop behavior. Record actual latency/bytes. Run focused
   tests, typecheck/build/baseline and independent fresh-session review before acceptance.

Do not mark Phase 2 complete after design, a browser-only snapshot or nonce validation.
Both immutable captured-frame behavior and independent original-record verification
are required. No actual-model competence claim follows from fixture transport tests.

## Deferred region query

A future image-region tool needs a defined polygon/crop coordinate convention, visible
support/occlusion semantics, deduplication, pagination, sample/coverage limits and
server verification budget. It must not reinterpret a 2D empty region as free 3D volume.
Keep this explicitly deferred; single-pixel grounding is the first bounded primitive.

## Implementation evidence

The four implementation slices are present; see Task089 Phase 2 evidence for exact
commands/logs and the review handoff `/tmp/agent-scene-agency-phase2-review-handoff.md`
for scoped hunks. Runtime uses a bounded streaming projection/triangle scan rather
than unbounded Three point/mesh hit arrays. All point arrays and blocker arrays are
owned; metadata is per snapshot/layer, never a provenance object per point. Legacy
manual captures retain their live-view signature behavior; tool attachments explicitly
choose `captureSnapshot`. `ModelVisualBroker` remains transport-only; the runtime now
performs original source lookup before producing verified record evidence.

Final typecheck/build passed and baseline passed 1,066 tests. A preceding concurrent
baseline had one unrelated semantic-disk staging-directory cancellation assertion;
its preserved log and isolated 14-test passing rerun are recorded in Task089 rather
than hidden. Sparse native fixture browser forces a larger capture target than the
restored live target, then verifies the original record after human orbit/resize.
Real prepared/Toronto capture smoke also passes. No live model competence is claimed.

A synthetic three-million-point sample on this machine measured 148,778,240 admission
bytes (including 16 MiB reserve), 177.5 ms copy and 137.8 ms full no-hit scan; see
`/tmp/task089-grounding-performance.json`. Deadlines remain unchanged; other machines
may return unavailable. Existing process/cache/GPU buffers are additional memory.
Source-instance image regions and multiple retained observations remain deferred.
