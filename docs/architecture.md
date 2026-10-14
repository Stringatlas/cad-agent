# Architecture

## Implemented foundation

The product goal is a VLM harness that inspects point-cloud scenes and makes verified CAD edits. The current implementation is a shared-project scene/chat shell with deterministic read-only inspection, bounded Toronto3D preview, a concrete point observation boundary and an ephemeral real-kernel CAD sandbox, not that approved model/editing loop. Pi is external development tooling, not a product runtime dependency.

| Boundary | Current responsibility |
| --- | --- |
| `packages/contracts` | Readonly TypeScript project/entity/coordinate types and runtime validation. |
| `packages/project-state` | Demo generation, entity lookup, selection transitions and local/world conversion. |
| `packages/geometry` | `GeometryAdapter.bounds` and analytic `boxBounds` for proposals; separate kernel-independent `CadAdapter` and worker-loaded actual OpenCascade implementation. |
| `packages/agent-harness` | Agent interfaces, independent bounded observations and headless semantic-query/verifier interfaces with deterministic tool execution. |
| `apps/web` | Svelte scene switcher, preserved demo picking/selection and disposable Three.js Toronto preview; independent display/observation/full-resolution-crop request channels and generation-gated inspection chat. |
| `apps/server` | Read-only `/health`, `/project`, fixed Toronto metadata/observation/closest-label endpoints (legacy closest-Pole retained), a shared bounded disk-backed all-label spatial index and Potree adapter with independently backpressured full-resolution AABB/projected-volume streams; shared read-only demo snapshot and bounded deterministic `/chat/inspect` transport; separate bounded `/cad/capabilities` and `/cad/execute` sandbox with isolated kernel worker. |
| `tests/*.test.ts` | Node checks for contracts, coordinates, bounds, rendered dimensions, raycasting and HTTP routes. |
| `scripts/browser-smoke.mjs`, `scripts/browser-toronto-smoke.mjs` | Existing-Chrome CDP checks of demo and actual Toronto preview; console/screenshot evidence. |
| `scripts/check-toronto-preview.ts` | Bounded actual-artifact observation checks, separate from full preprocessing validation. |

Dependencies flow from web/server to project-state to contracts; geometry depends on contracts; agent-harness depends on contracts and the geometry interface. Viewer and kernel types must not leak into product-agent interfaces.

## State and rendering

`ProjectState` carries geometry revision, coordinate metadata, entities and selected entity ID. TypeScript `readonly` expresses intent; it is not runtime deep freezing. Runtime assertions validate finite coordinates, positive box dimensions, unique IDs and valid selection references.

The server calls `createDemoProject()` once per instance. The browser must fetch `/project`, validate its state/session/project-frame headers and supply that same snapshot to viewer and chat; there is no independent seed/fallback. Reload aborts/disposes old work and refetches the snapshot. Selection returns a disposable browser state wrapper, shares geometry and preserves geometry revision. This is read-only snapshot integration, not persistence or a mutation API. Geometry edit transitions are planned, not implemented.

Entity IDs in state are authoritative. Three objects carry IDs as lookup hints; picking checks those IDs against state. Meshes, point buffers, materials and highlighting are render caches, never geometry authority. The viewer currently updates selection only; it does not support geometry updates.

See [coordinate decision](decisions/001-coordinate-conventions.md): meters, right-handed Z-up, translation-only origin. Render local coordinates, not large world offsets. The demo contains 441 synthetic points and a `1.8 × 1.2 × 1.5 m` box centered at `[0, 0, 0.75]`. The box is a mesh proposal, **not an OpenCascade body or verified solid**.

## Read-only dataset observations

Toronto3D is separate from editable `ProjectState`. Shared `DatasetInfo`, `PointLod` and `PointObservation` contracts carry dataset artifact revision, coordinate frame/origin, stable point provenance and concrete bounded sample arrays. `PointObservationSource` in agent-harness exposes `observe(lod, signal)` without renderer, Pi or kernel types; the server's `PotreeDataset` provides the concrete prepared-file implementation. Neither viewer nor sampling changes geometry authority or a project revision.

The web uses independent sampled display, harness and display-only full-resolution crop channels with separate cancellation/settings/results. The editable local-meter crop box/frozen camera window is disposable viewer selection state, not a project entity or CAD edit. Full-resolution queries follow intersecting hierarchy proxies/all levels and test exact points against an AABB plus optional six camera-volume planes; task005 removes total point/source-work/time caps. Backpressured NDJSON batches, bounded source reads and independent progressive GPU chunks replace monolithic results; total GPU memory can still exhaust resources, with explicit incomplete/error/cancel states rather than downsampling. Harness sampling remains the existing bounded first-chunk algorithm. Display progressively replaces a root sample with the selected capped sample; harness produces downloadable observation JSON, not model calls. Vite dev and preview proxy `/datasets/`, `/project` and `/chat/` to the local read-only server. Fixed asset names, realpath/no-follow checks, numeric/range/per-read safeguards and request concurrency limits prevent arbitrary paths/raw whole-file allocations. A full-resolution selection can intentionally traverse the entire prepared cloud progressively; it is not a raw whole-file download. No raw range/file endpoint is exposed. See [preview design/run instructions](web-preview-lod.md) for exact limits, first-chunk/depth limitations and fingerprint semantics.

Toronto uses its own shared origin `[627285, 4841948, 0]` meters, never the demo origin. Local int32-scaled Potree positions are rendered in a right-handed Z-up frame. This translation-only imported observation adds no CRS conversion or geometry-edit semantics.

## Headless semantic inspection

The [closest-Pole query](closest-pole-query.md) is a separate authority path: explicit local coordinate/source reference and revision → exact semantic search → independent verification. Interactive HTTP uses a complete persisted binary64 Pole category index, spatial bucket search and independent reduction over every indexed Pole; original selected/winning prepared records are checked directly. One-time preparation validates all source records and hierarchy/provenance coverage. The original exhaustive prepared-record search/independent linear-record oracle remains available for offline audits, not per-click work. Shared contracts carry filter/domain/metric/provenance/evidence; agent-harness owns the tool executor and abstract query/verifier boundaries; separate server adapters own one read-only snapshot and cleanup. Only verified found/empty outcomes are complete. The viewer, crop stream and sampled harness observations do not determine the answer. The headless task006 slice added no HTTP/UI integration; task006 records its own evidence and review status. The authorized [task007](tasks/007-closest-pole-ui.md) adds a separate Closest pole tab and fixed read-only closest-pole HTTP route. Cmd/Ctrl overview picks resolve to original observation provenance and artifact revision, never GPU coordinates/indexes. The shared two-operation admission covers resolution/search/verification; bounded NDJSON frames coalesce progress under backpressure. A separate browser query generation/controller validates binding, evidence, terminal framing and EOF before displaying verified outcomes; cancellation, revision changes and disposal suppress stale publication. Markers are disposable local-meter caches, independent of display/harness LOD. Existing uncapped full-resolution crop loading remains independent. [Task008](tasks/008-closest-pole-performance.md) adds the indexed interactive path, a monotonic first-use index-preparation phase and explicit category-index evidence; verification is category-linear, not a fresh full-source scan. Derived caches are disposable OS-temp artifacts bound to source revision/file identities, with integrity checks and resource limits. Cancellation/retry/revision safety and the independent uncapped crop path remain intact. No model loop or CAD mutation is added. Actual production HTTP/client latency, task008's61-test baseline and rendered existing-Chrome checks pass; task008 records browser evidence and the reactive-selection Retry fix. Fresh-session review remains pending. [Task009](tasks/009-closest-label-window.md) generalizes the Closest tab and query contract to all nine Toronto3D scalar labels (Pole default). Category-specific caches/witnesses remain request-bound; deliberate category/spatial index memory bounds select the exact exhaustive independently verified source scan, not a sampled result. The legacy closest-pole route enforces label6. Shift-drag loads a frozen projected display-only window with uncapped progressive detail and cancel/clear/retry. Detail batches include source provenance; Cmd/Ctrl picks retain original binary64 values and revision, preferring detail over overview. Window/LOD/camera never restrict the whole-dataset answer. Task009 baseline78/78 and nine actual-data browser checks pass; its abundant-category fallback/timing limitation is now superseded by [task010](tasks/010-all-label-disk-index.md). All nine labels share one persisted physical-page index and externally partitioned source-row lookup. Actual per-label page bounds/counts, complete physical-page coverage and lazy checksummed bounded reads support production Euclidean search and a separately implemented L-infinity-bound verifier; both establish their own radius/reduction and reread original selected/winning records. Interactive resource bounds produce incomplete outcomes, never exhaustive fallback; the exhaustive offline oracle remains available. Startup loads small metadata only; explicit spool/metadata/page budgets avoid whole-category or whole-lookup allocations. Actual cold build29.69s, persisted HTTP first184ms; ten warm production HTTP/client queries per label measured p95 Ground909ms, Building159ms, Pole42ms (all labels<2s). Baseline92/92 and ten actual-data existing-Chrome checks pass, including all-nine-label native completion. Task010 records exact evidence, memory/disk tradeoffs and remaining limitations. Fresh-session review remains pending; GitNexus graph checks unavailable.

## Read-only shared-project chat

[Task012](tasks/012-shared-project-chat.md) supplies the left scene/right chat workspace. Exact commands `metadata` and `observe B D` call task011's real allowlisted dispatcher through a bounded local HTTP seam. Server-owned session/project revision and browser generation/request identity gate publication; cancellation, reload and disposal suppress late results. Tool outcomes and evidence references stay distinct from CAD verification. Toronto frame/artifact revision/content digest are separate from demo geometry—no implicit mapping or geometry changes.

[Command/API guide](shared-project-chat.md) documents bootstrap, preparation, limits and statuses. Independent verification passes123/123 baseline, ten shared-chat browser checks and ten exact-nine-label/window checks. Independent fresh-context review found no actionable defect. Graph access recovered, but stale/untracked/Svelte/PDG coverage gaps prevent clean graph certification. No model/provider/auth, persistence, mutation or CAD was introduced.

## Real CAD sandbox

[Task013](tasks/013-cad-engine.md) implements actual OpenCascade using pinned `replicad-opencascadejs@1.1.0` direct bindings (no Replicad JS wrapper). A new `CadAdapter` accepts kernel-independent operation contracts; only geometry's `/cad-kernel` implementation imports native types. The server lazily loads that implementation in an isolated worker, not the HTTP thread or agent interfaces. [API/limits guide](cad-engine.md) covers box, Z-cylinder, immutable union/subtract/intersect, inspection, plain-array tessellation, meter STEP export and deletion.

Sandbox bodies have immutable IDs/revision1 and explicit demo session/source revision/frame provenance, local meter right-handed Z-up coordinates. They are not project entities, commits or approved edits. Exactly one nonempty positive-volume solid, native geometric/exact BRep checks, measured bounds/volume/topology and STEP meter roundtrip gate separate real solid validity from rendering. Application-specific verified edit postconditions remain future work. Existing `/project`, chat and viewer proposal meshes do not change.

One admission includes bounded body reading; no queue. Input/registry/boolean-complexity/topology/output limits and hard15s kernel timeout contain native work. Cancellation of dispatched operations, kernel-operation timeout (not body-read timeout), unexpected worker failure or server close terminates the kernel and invalidates all sandbox handles; next use starts fresh after termination. JS heap limits do not cap WASM memory; bounded native workloads are not a peak-memory/security proof. Production remains loopback-only and unauthenticated—Host/Origin checks do not authorize public hosting. Task013 baseline138/138, independent HTTP/kernel/failure probes and fresh source review pass. New untracked graph coverage and parent stale-LSP cache remain incomplete; no clean graph certification claimed. No rendering/UI changes or task013 browser check.

## Toolchain and distribution

The private pnpm 10 workspace targets Node 22 (`>=22.12.0 <23`) with TypeScript 5.9, Svelte 5, Vite 7 and Three.js. Workspace packages export TypeScript source; they are not published or independently emitted distributions.

- `pnpm dev`: web at `127.0.0.1:5173` and local server at `127.0.0.1:3001` (read-only project/data/chat plus separate CAD sandbox).
- `pnpm typecheck`: recursive checks, including `svelte-check`.
- `pnpm test`: `tsx --test tests/*.test.ts`.
- `pnpm build`: Vite web distribution in `apps/web/dist`; server `build` is `tsc --noEmit`, not an emitted server package. Library packages have no build scripts.
- `pnpm verify`: typecheck, test, build in sequence; explicitly reminds that browser checks are separate.
- `pnpm verify:browser [CDP endpoint]`: starts a built-preview server and checks an existing Chrome; no browser download or launch.
- Browser verification needs a functioning browser harness and CDP-enabled Chrome; a script declaration alone is not evidence of a completed check.

## Planned boundaries (not implemented)

### End-state web workspace

The target UI puts the **3D scene on the left and harness web chat in a right-hand panel**. Chat accepts inspection/edit requests and exposes tool evidence, proposals, exact-proposal approval and verified outcomes. Approved edits are reflected in the scene by publishing and rendering the same authoritative project state; the chat and viewer cannot keep independent editable demo snapshots. Proposal previews are disposable and visibly distinct from committed geometry.

The product harness—not Pi—drives this workflow through contracts and adapter interfaces. One project authority owns entity IDs and geometry revisions; view/selection state stays separate. Dataset revisions and frame mappings remain explicit. Geometry candidates must pass postconditions and revision checks before atomic publication; a model response or successful render is not verification. A rendering failure must be reported separately from geometry commit status.

The implemented [first chat slice](tasks/012-shared-project-chat.md) is a read-only shared-project shell using the existing tool protocol and deterministic requests. It establishes the browser/server integration seam, not a model loop, persistence service, mutation API or CAD adapter. Items5–7 still gate authoritative editing and verified project CAD. Task013 independently establishes sandbox kernel operations, not those authority/approval gates.

Future work may introduce revision-checked parameter edits, persistence/synchronization, project-integrated CAD adapters/tessellation, model tool calls and benchmark evaluation. Sandbox CAD operations/tessellation already exist separately in task013. Each requires explicit state ownership, IDs, units, frames, revision preconditions and verification outcomes. CAD operations must go through adapter interfaces; the viewer must remain a projection of state.

Next checkpoint: complete blocked browser verification where applicable and fresh-session review of each implementation against its own task and actual changes. Foundation, preprocessing and preview reviews remain separate; implementing the preview does not approve earlier tasks. A future revision-checked box parameter update would still be **without CAD** unless separately scoped.

## Authoritative references

- [Vite 7 guide](https://v7.vite.dev/guide/)
- [Svelte 5 overview](https://svelte.dev/docs/svelte/overview)
- [Three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster) and [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls)
- [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [pnpm 10 workspaces](https://pnpm.io/10.x/workspaces)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html) and [test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- [OpenCascade modeling data](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html)
