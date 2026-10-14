# Spatial CAD harness

A personal-project foundation for a future VLM harness inspecting point clouds and making verified CAD edits. **Current milestone: a shared-project scene/chat workspace with deterministic read-only inspection, Toronto3D preview, independent observations and a real CAD sandbox API—not an approved-project CAD editor or model loop.** Pi is external development tooling.

## End vision

A web workspace with the **3D scene on the left and the product harness chat in a right-hand panel**. Users ask the harness to inspect the point cloud and propose edits; the chat shows tool evidence, proposed changes, approval controls and verified outcomes. Approved, revision-checked edits update authoritative project state and are reflected in the left-hand scene. A proposal preview is clearly separate from committed geometry; chat prose or a rendered mesh alone never proves edit success.

Chat and viewer must use the same project state, entity IDs and geometry revision—not independent demo snapshots. The viewer remains a disposable projection, CAD operations go through geometry adapters, and Pi remains development tooling rather than the product chat runtime. The read-only scene/chat shell is implemented; model orchestration, approval and editing remain targets.

The [inspection chat](docs/shared-project-chat.md) supports exact commands `metadata` and `observe B D` through the real tool dispatcher. Demo geometry and Toronto artifact frames remain explicitly separate. Scope/evidence: [task012](docs/tasks/012-shared-project-chat.md).

The [CAD sandbox API](docs/cad-engine.md) adds actual OpenCascade box/cylinder solids, booleans, inspection, tessellation and meter STEP export at `/cad/capabilities` and `/cad/execute`. Bodies are ephemeral and separate from the read-only project; no chat/viewer editing or approval bypass. Scope/evidence: [task013](docs/tasks/013-cad-engine.md).

## Setup and run

Requires Node **22.12+ within Node 22** and **pnpm 10.34.6**. The package manager is pinned; the existing Corepack shim selected it successfully. No global installation is required. If your shim cannot find pnpm, use `corepack pnpm` instead of `pnpm` below.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:5173**. Web and server start together; Ctrl-C stops them. Individual processes:

```sh
pnpm --filter @spatial/web dev
pnpm --filter @spatial/server dev
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/project
```

No credentials or environment file is needed. The server binds only to loopback. Project/dataset/chat endpoints are read-only; CAD operations use a separate ephemeral sandbox. It owns the read-only demo snapshot fetched by the browser and shared with chat. Reload refetches it; there is no persistence or mutation service. Toronto mode reads bounded dataset observations from separate read-only endpoints.

## What the viewer does

- Renders 441 deterministic synthetic points and a parameterized box proposal.
- Orbit by dragging, zoom with the wheel, select by clicking the scene or entity list.
- Highlights selection and displays its authoritative entity ID.
- Shows XY ground, X/red Y/green Z/blue reference, meter units, and local origin.
- Uses right-handed Z-up local geometry; `world = local + [1000, 2000, 10]` meters.

The box is **not an OpenCascade body**. Its dimensions are `[1.8, 1.2, 1.5]` m and local center is `[0, 0, 0.75]`. Three objects are disposable projections of project state, not geometry authority. There are no parameter-edit controls yet.

## Toronto3D preview

Choose **Toronto3D preview** after `pnpm dev`. Requires the existing prepared dataset under `data/processed/toronto3d/prepared/`; no data is bundled or regenerated. Display budgets (10k–100k) and harness-input budgets (256–4096), with independent depths 0–3, affect separate concrete outputs. **Shift-click-drag a screen window** to progressively load every point through that frozen camera frustum × dataset extent (near/far clipped depth, including occluded points). A visible overlay shows the gesture; ordinary drag still orbits. Tiny Shift-click places the yellow local-meter box; edit its center/size, Frame box, then **Load full resolution in box**. Both selections have **no total point/source-work cap and no downsampling**. Selection mode/local bounds and loaded/scanned/source-read progress are explicit; the selected total stays unknown until completion (no fabricated percentage). Counts stay partial until complete; Cancel retains explicitly incomplete detail, Clear releases it, Retry repeats the same selection after cancel/error, and editing clears/cancels old detail. Bounded stream/GPU chunks avoid giant responses/allocations, but large selections can exhaust browser/GPU memory; cancellation is not instantaneous. The dim overview stays for context; harness settings/sample are unchanged. This is a display selection, not a CAD box edit. Download the reproducible harness observation JSON; no model consumes it yet. Missing dataset errors are visible; the synthetic demo remains usable while its bootstrap server is available.

Run steps, local origin, read/size/security caps and sampling limitations: [preview documentation](docs/web-preview-lod.md). Latest stream/projection/feedback evidence, user browser confirmation and bounded independent-review resolution: [task005](docs/tasks/005-projected-full-resolution.md). Built Toronto preview requires the server running too.

```sh
pnpm exec tsx scripts/check-toronto-preview.ts
pnpm exec tsx scripts/check-toronto-crop.ts # bounded actual full-resolution queries
node scripts/browser-toronto-smoke.mjs # build first; existing Chrome only
```

## Checks and build

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm verify
pnpm --filter @spatial/web preview
```

`pnpm verify` runs package and test typechecking, Node tests (coordinates, contracts, box bounds/rendered dimensions, raycast ID resolution/highlighting, read-only API), and builds. Svelte checking is included. Web output is `apps/web/dist`; server `build` deliberately only typechecks, and `start` runs TypeScript through tsx. Workspace libraries export source, not published distributions.

### Repeatable browser smoke

Connects to **existing Chrome**, never downloads or launches a browser. Enable remote debugging in Chrome and approve access. Supply its HTTP CDP endpoint or browser WebSocket URL if not the default:

```sh
pnpm build
pnpm verify:browser
# Or:
pnpm verify:browser http://127.0.0.1:9222
```

The smoke script starts/cleans up its own bootstrap backend and built-preview server on port 4173, opens/closes only its test page, checks rendered point/triangle counts, canvas picking and selected IDs, clearing, orbit drag, zoom, narrow-viewport resize, metadata, and console/runtime errors. Captures screenshots and a JSON report in ignored `artifacts/browser/`. It fails nonzero if CDP or WebGL is unavailable; this check is separate from the environment-independent baseline. Screenshots complement assertions and still need visual inspection.

Latest shared-workspace results: [task012](docs/tasks/012-shared-project-chat.md); historical foundation evidence: [task001](docs/tasks/001-project-foundation.md). Large Three.js bundle warning is retained.

## Workspace boundaries

| Path | Role |
| --- | --- |
| `apps/web` (`@spatial/web`) | Vite 7, Svelte 5, Three.js viewer |
| `apps/server` (`@spatial/server`) | Read-only demo/data/chat API and isolated ephemeral CAD sandbox endpoints |
| `packages/contracts` | Shared types and dependency-free runtime schemas/assertions |
| `packages/project-state` | Entities, coordinate conversion, selection and revisions |
| `packages/geometry` | Geometry/CAD interfaces, analytic proposal bounds and worker-loaded OpenCascade adapter |
| `packages/agent-harness` | Product interfaces, observation boundary and deterministic sampling policy |

Package names use `@spatial/*` and `workspace:*` imports. The harness has no UI, Pi, or direct CAD-kernel dependency.

See [architecture](docs/architecture.md), [coordinate decision](docs/decisions/001-coordinate-conventions.md), [task board](docs/tasks/README.md), and [standing instructions](AGENTS.md). Dependencies are pinned in manifests/lockfile; authoritative version-family references are in architecture.

## Scope and next step

Real kernel solids exist only in the ephemeral CAD sandbox. No approved project CAD edits, model calls, credentials, simulations, persistence, deployment or push. Toronto3D observations are read-only and separate from geometry revisions. Only demo selection transitions exist; selection does not increment geometry revision.

Review checkpoint: complete outstanding browser checks and fresh-session reviews against each task and actual changes; these implementations do not approve one another. The first [shared-project chat shell](docs/tasks/012-shared-project-chat.md) is implemented and independently reviewed: 123/123 baseline plus chat/demo/all-label browser checks pass. Full graph certification remains unresolved; prior task reviews stay separate. [Provider/kernel direction](docs/TODO.md#provider-and-kernel-direction): OpenAI API keys plus ChatGPT subscription sign-in; actual OpenCascade sandbox implemented using pinned direct bindings in task013. Live auth/model calls and approved project CAD edits remain unimplemented. Task013 passes138/138 baseline tests and independent source review; graph coverage remains incomplete.
