# Architecture

## Implemented foundation

The product goal is a VLM harness that inspects point-cloud scenes and makes verified CAD edits. The current implementation is a deterministic demo viewer, bounded Toronto3D preview and concrete read-only point observation boundary, not that product loop. Pi is external development tooling, not a product runtime dependency.

| Boundary | Current responsibility |
| --- | --- |
| `packages/contracts` | Readonly TypeScript project/entity/coordinate types and runtime validation. |
| `packages/project-state` | Demo generation, entity lookup, selection transitions and local/world conversion. |
| `packages/geometry` | `GeometryAdapter.bounds` interface and analytic `boxBounds`; no concrete CAD adapter. |
| `packages/agent-harness` | Agent interfaces, independent bounded observations and headless semantic-query/verifier interfaces with deterministic tool execution. |
| `apps/web` | Svelte scene switcher, preserved demo picking/selection and disposable Three.js Toronto preview; independent display/observation/full-resolution-crop request channels. |
| `apps/server` | Read-only `/health`, `/project`, fixed Toronto metadata/observation/closest-Pole endpoints, a reusable exact Pole category index and Potree adapter with independently backpressured full-resolution AABB/projected-volume streams; independent demo snapshot. |
| `tests/*.test.ts` | Node checks for contracts, coordinates, bounds, rendered dimensions, raycasting and HTTP routes. |
| `scripts/browser-smoke.mjs`, `scripts/browser-toronto-smoke.mjs` | Existing-Chrome CDP checks of demo and actual Toronto preview; console/screenshot evidence. |
| `scripts/check-toronto-preview.ts` | Bounded actual-artifact observation checks, separate from full preprocessing validation. |

Dependencies flow from web/server to project-state to contracts; geometry depends on contracts; agent-harness depends on contracts and the geometry interface. Viewer and kernel types must not leak into product-agent interfaces.

## State and rendering

`ProjectState` carries geometry revision, coordinate metadata, entities and selected entity ID. TypeScript `readonly` expresses intent; it is not runtime deep freezing. Runtime assertions validate finite coordinates, positive box dimensions, unique IDs and valid selection references.

In the default synthetic mode, the browser calls `createDemoProject()` locally. The server calls it independently: the browser does not fetch `/project`, and there is no synchronization, persistence or mutation API. Selection returns a new state wrapper, shares geometry and preserves the geometry revision. Geometry edit transitions are planned, not implemented.

Entity IDs in state are authoritative. Three objects carry IDs as lookup hints; picking checks those IDs against state. Meshes, point buffers, materials and highlighting are render caches, never geometry authority. The viewer currently updates selection only; it does not support geometry updates.

See [coordinate decision](decisions/001-coordinate-conventions.md): meters, right-handed Z-up, translation-only origin. Render local coordinates, not large world offsets. The demo contains 441 synthetic points and a `1.8 × 1.2 × 1.5 m` box centered at `[0, 0, 0.75]`. The box is a mesh proposal, **not an OpenCascade body or verified solid**.

## Read-only dataset observations

Toronto3D is separate from editable `ProjectState`. Shared `DatasetInfo`, `PointLod` and `PointObservation` contracts carry dataset artifact revision, coordinate frame/origin, stable point provenance and concrete bounded sample arrays. `PointObservationSource` in agent-harness exposes `observe(lod, signal)` without renderer, Pi or kernel types; the server's `PotreeDataset` provides the concrete prepared-file implementation. Neither viewer nor sampling changes geometry authority or a project revision.

The web uses independent sampled display, harness and display-only full-resolution crop channels with separate cancellation/settings/results. The editable local-meter crop box/frozen camera window is disposable viewer selection state, not a project entity or CAD edit. Full-resolution queries follow intersecting hierarchy proxies/all levels and test exact points against an AABB plus optional six camera-volume planes; task005 removes total point/source-work/time caps. Backpressured NDJSON batches, bounded source reads and independent progressive GPU chunks replace monolithic results; total GPU memory can still exhaust resources, with explicit incomplete/error/cancel states rather than downsampling. Harness sampling remains the existing bounded first-chunk algorithm. Display progressively replaces a root sample with the selected capped sample; harness produces downloadable observation JSON, not model calls. Vite dev and preview proxy only `/datasets/` to the local read-only server. Fixed asset names, realpath/no-follow checks, numeric/range/per-read safeguards and request concurrency limits prevent arbitrary paths/raw whole-file allocations. A full-resolution selection can intentionally traverse the entire prepared cloud progressively; it is not a raw whole-file download. No raw range/file endpoint is exposed. See [preview design/run instructions](web-preview-lod.md) for exact limits, first-chunk/depth limitations and fingerprint semantics.

Toronto uses its own shared origin `[627285, 4841948, 0]` meters, never the demo origin. Local int32-scaled Potree positions are rendered in a right-handed Z-up frame. This translation-only imported observation adds no CRS conversion or geometry-edit semantics.

## Headless semantic inspection

The [closest-Pole query](closest-pole-query.md) is a separate authority path: explicit local coordinate/source reference and revision → exact semantic search → independent verification. Interactive HTTP uses a complete persisted binary64 Pole category index, spatial bucket search and independent reduction over every indexed Pole; original selected/winning prepared records are checked directly. One-time preparation validates all source records and hierarchy/provenance coverage. The original exhaustive prepared-record search/independent linear-record oracle remains available for offline audits, not per-click work. Shared contracts carry filter/domain/metric/provenance/evidence; agent-harness owns the tool executor and abstract query/verifier boundaries; separate server adapters own one read-only snapshot and cleanup. Only verified found/empty outcomes are complete. The viewer, crop stream and sampled harness observations do not determine the answer. The headless task006 slice added no HTTP/UI integration; task006 records its own evidence and review status. The authorized [task007](tasks/007-closest-pole-ui.md) adds a separate Closest pole tab and fixed read-only closest-pole HTTP route. Cmd/Ctrl overview picks resolve to original observation provenance and artifact revision, never GPU coordinates/indexes. The shared two-operation admission covers resolution/search/verification; bounded NDJSON frames coalesce progress under backpressure. A separate browser query generation/controller validates binding, evidence, terminal framing and EOF before displaying verified outcomes; cancellation, revision changes and disposal suppress stale publication. Markers are disposable local-meter caches, independent of display/harness LOD. Existing uncapped full-resolution crop loading remains independent. [Task008](tasks/008-closest-pole-performance.md) adds the indexed interactive path, a monotonic first-use index-preparation phase and explicit category-index evidence; verification is category-linear, not a fresh full-source scan. Derived caches are disposable OS-temp artifacts bound to source revision/file identities, with integrity checks and resource limits. Cancellation/retry/revision safety and the independent uncapped crop path remain intact. No model loop or CAD mutation is added. Actual production HTTP/client latency, current61-test baseline and rendered existing-Chrome checks pass; task008 records browser evidence and the reactive-selection Retry fix. Fresh-session review remains pending.

## Toolchain and distribution

The private pnpm 10 workspace targets Node 22 (`>=22.12.0 <23`) with TypeScript 5.9, Svelte 5, Vite 7 and Three.js. Workspace packages export TypeScript source; they are not published or independently emitted distributions.

- `pnpm dev`: web at `127.0.0.1:5173` and read-only server at `127.0.0.1:3001`.
- `pnpm typecheck`: recursive checks, including `svelte-check`.
- `pnpm test`: `tsx --test tests/*.test.ts`.
- `pnpm build`: Vite web distribution in `apps/web/dist`; server `build` is `tsc --noEmit`, not an emitted server package. Library packages have no build scripts.
- `pnpm verify`: typecheck, test, build in sequence; explicitly reminds that browser checks are separate.
- `pnpm verify:browser [CDP endpoint]`: starts a built-preview server and checks an existing Chrome; no browser download or launch.
- Browser verification needs a functioning browser harness and CDP-enabled Chrome; a script declaration alone is not evidence of a completed check.

## Planned boundaries (not implemented)

Future work may introduce revision-checked parameter edits, persistence/synchronization, concrete geometry adapters, CAD tessellation, model tool calls and benchmark evaluation. Each requires explicit state ownership, IDs, units, frames, revision preconditions and verification outcomes. CAD operations must go through adapter interfaces; the viewer must remain a projection of state.

Next checkpoint: complete blocked browser verification where applicable and fresh-session review of each implementation against its own task and actual changes. Foundation, preprocessing and preview reviews remain separate; implementing the preview does not approve earlier tasks. A future revision-checked box parameter update would still be **without CAD** unless separately scoped.

## Authoritative references

- [Vite 7 guide](https://v7.vite.dev/guide/)
- [Svelte 5 overview](https://svelte.dev/docs/svelte/overview)
- [Three.js Raycaster](https://threejs.org/docs/#api/en/core/Raycaster) and [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls)
- [TypeScript 5.9 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html)
- [pnpm 10 workspaces](https://pnpm.io/10.x/workspaces)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html) and [test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)
- Future only: [OpenCascade modeling data](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html)
