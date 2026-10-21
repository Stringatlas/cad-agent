# Spatial CAD harness

A personal-project foundation for a future VLM harness inspecting point clouds and making verified CAD edits. **Current milestone: provider-backed read-only scene chat, deterministic inspection, local persistence and human-approved box parameter edits, Toronto3D preview and a real CAD sandbox API—not an autonomous or approved-project CAD editor.** Pi is external development tooling.

## End vision

A web workspace with the **3D scene on the left and the product harness chat in a right-hand panel**. Users ask the harness to inspect the point cloud and propose edits; the chat shows tool evidence, proposed changes, approval controls and verified outcomes. Approved, revision-checked edits update authoritative project state and are reflected in the left-hand scene. A proposal preview is clearly separate from committed geometry; chat prose or a rendered mesh alone never proves edit success.

Chat and viewer must use the same project state, entity IDs and geometry revision—not independent demo snapshots. The viewer remains a disposable projection, CAD operations go through geometry adapters, and Pi remains development tooling rather than the product chat runtime. The shared scene/chat workspace, bounded read-only model loop, local sessions and approved box parameters are implemented; visual observation/evaluation and model-driven project-integrated CAD remain targets.

The [inspection chat](docs/shared-project-chat.md) supports exact commands `metadata` and `observe B D` through the real tool dispatcher. Demo geometry and Toronto artifact frames remain explicitly separate. Scope/evidence: [task012](docs/tasks/012-shared-project-chat.md).

The [CAD sandbox API](docs/cad-engine.md) adds actual OpenCascade box/cylinder solids, booleans, inspection, tessellation and meter STEP export at `/cad/capabilities` and `/cad/execute`. Bodies are ephemeral and separate from the editable parameter project; no chat/viewer editing or approval bypass. Scope/evidence: [task013](docs/tasks/013-cad-engine.md).

The [local project editing guide](docs/project-editing.md) covers original synthetic A/B pins and exact `context`, proposal preview/digest, deliberate human approval, checked atomic box edits, monotonic Undo and explicit Save/Load. Scope/evidence: [task014](docs/tasks/014-project-sessions.md), [task015](docs/tasks/015-approved-box-edits.md). This is parameter verification, not CAD solids or an A→B channel/model workflow.

## Point-cloud data

Point-cloud files are **not bundled in Git**. The prepared Toronto3D cloud combines
all four original sections (L001–L004; 78,320,210 points). Start with the
[dataset acquisition and reproducibility guide](docs/datasets.md): it links the
official download, license, tracked source checksums, pinned converter patches,
and preparation/validation steps. Raw files, generated octrees and local tooling
remain ignored; `pnpm dev` does not download or prepare them.

A [generic prepared-cloud adapter](docs/datasets.md#generic-read-only-adapter)
provides a tested read-only integration seam for other cloud identities, frames,
origins and optional semantic mappings. It is not yet connected to the viewer's
scene picker, chat or editing authority; arbitrary raw formats still need their
own ingestion adapters. Toronto remains the product's configured dataset.

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

No credentials or environment file is needed for the deterministic workspace. Optional provider authentication is configured **only in `apps/server/.env`** (copy `apps/server/.env.example`; never put keys in web env files). Open **Account · Sign in with ChatGPT** in the workspace header for connection status, sign-in and sign-out. Sign-in opens the existing **http://127.0.0.1:3001/auth** utility in a separate tab, keeping your scene open. Explicit ChatGPT-plan/API-key modes and setup: [provider authentication guide](docs/provider-auth.md). For real model chat, explicitly **Refresh models → choose a model → Send**; [usage, scene context and limits](docs/model-chat.md). Sending can consume plan usage or incur API charges; no live inference was used for verification. The server binds only to loopback. The server owns one local project authority fetched by viewer/chat, with bounded approved parameter mutations and explicit persistence. Default save path is `~/.spatial-cad-harness/project.json`; operator `SPATIAL_PROJECT_PATH` overrides it at startup. Corrupt existing persistence fails explicitly. Reload reads current authority; Load restores saved geometry and rotates session. CAD uses a separate ephemeral startup-bound sandbox (edit/Load makes it stale until restart). Toronto mode reads bounded dataset observations from separate read-only endpoints.

## Scene workspace

The default view is **Toronto3D on the left and Scene chat on the right**. Choose A/B and Cmd/Ctrl-click any rendered overview or full-resolution detail point to attach its original coordinates, source key, artifact revision and explicit meter/frame metadata to the natural-language chat context. Remove/replace/clear references explicitly; switching sources or reloading clears Toronto attachments. **Refresh models**, select a configured model, then **Send** to stream an answer. Read-only `inspect_scene` can inspect bound references; chat cannot create channels/CAD or approve edits. Toronto references remain unmapped, with exact original records explicitly unverified at this chat boundary.

Expand **Scene tools & data** for LOD/crop/export, **Technical tools** for real deterministic inspection and approved box parameters, and **Project & persistence** for explicit Save/Load. See [task017](docs/tasks/017-demo-workspace-ui.md) for scope, browser evidence and remaining limitations.

## Synthetic viewer

Choose **Synthetic demo**; expand its scene tools for entity/pin metadata.

- Renders 441 deterministic synthetic points and a parameterized box proposal.
- Orbit by dragging, zoom with the wheel, select by clicking the scene or entity list.
- Highlights selection and displays its authoritative entity ID.
- Shows XY ground, X/red Y/green Z/blue reference, meter units, and local origin.
- Uses right-handed Z-up local geometry; `world = local + [1000, 2000, 10]` meters.

The box is **not an OpenCascade body**. Initial demo dimensions are `[1.8, 1.2, 1.5]` m and local center is `[0, 0, 0.75]`; saved/edited state may differ. Three objects are disposable projections of project state, not geometry authority. Chat-side deterministic parameter controls preview exact proposals; a separate deliberate approval commits them. Cmd/Ctrl-click synthetic points to pin A/B for bound context.

## Toronto3D preview

**Toronto3D preview** opens by default after `pnpm dev`; expand **Scene tools & data** for the controls below. Requires the existing prepared dataset under `data/processed/toronto3d/prepared/`; no data is bundled or regenerated. Display budgets (10k–100k) and harness-input budgets (256–4096), with independent depths 0–3, affect separate concrete outputs. **Shift-click-drag a screen window** to progressively load every point through that frozen camera frustum × dataset extent (near/far clipped depth, including occluded points). A visible overlay shows the gesture; ordinary drag still orbits. Tiny Shift-click places the yellow local-meter box; edit its center/size, Frame box, then **Load full resolution in box**. Both selections have **no total point/source-work cap and no downsampling**. Selection mode/local bounds and loaded/scanned/source-read progress are explicit; the selected total stays unknown until completion (no fabricated percentage). Counts stay partial until complete; Cancel retains explicitly incomplete detail, Clear releases it, Retry repeats the same selection after cancel/error, and editing clears/cancels old detail. Bounded stream/GPU chunks avoid giant responses/allocations, but large selections can exhaust browser/GPU memory; cancellation is not instantaneous. The dim overview stays for context; harness settings/sample are unchanged. This is a display selection, not a CAD box edit. Download the reproducible harness observation JSON; no model consumes it yet. Missing dataset errors are visible; the synthetic demo remains usable while its bootstrap server is available.

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

`pnpm verify` runs package and test typechecking, Node tests (coordinates, contracts, box bounds/rendered dimensions, raycast ID resolution/highlighting, inspection and approved project APIs), and builds. Svelte checking is included. Web output is `apps/web/dist`; server `build` deliberately only typechecks, and `start` runs TypeScript through tsx. Workspace libraries export source, not published distributions.

### Repeatable browser smoke

Connects to **existing Chrome**, never downloads or launches a browser. Enable remote debugging in Chrome and approve access. Supply its HTTP CDP endpoint or browser WebSocket URL if not the default:

```sh
pnpm build
pnpm verify:browser
# Or:
pnpm verify:browser http://127.0.0.1:9222
```

The smoke script starts/cleans up its own bootstrap backend and built-preview server on port 4173, opens/closes only its test page, checks rendered point/triangle counts, canvas picking and selected IDs, clearing, orbit drag, zoom, narrow-viewport resize, metadata, and console/runtime errors. Captures screenshots and a JSON report in ignored `artifacts/browser/`. It fails nonzero if CDP or WebGL is unavailable; this check is separate from the environment-independent baseline. Screenshots complement assertions and still need visual inspection.

Latest model-chat evidence: [task019](docs/tasks/019-model-chat-loop.md),391/391 baseline and16 guarded fake-provider browser checks; independent corrective review has no remaining findings. Live inference and complete graph certification remain unrun/unresolved.

Historical UI evidence: [task017](docs/tasks/017-demo-workspace-ui.md),230/230 baseline and14 task017/8 demo/10 chat/15 interactive browser groups pass. Legacy Toronto smoke still fails its post-release exact camera-string comparison (~10⁻¹² m zero-input OrbitControls normalization); not a passing historical suite. Fresh task017 source/corrective reviews are complete; whole-checkout graph/review remains separate.

Latest local authority/editing results: [tasks014/015](docs/tasks/014-project-sessions.md#verification-and-review),163/163 baseline and15 interactive/10 chat/10 all-label-window/8 demo browser checks pass. Original shared-workspace results: [task012](docs/tasks/012-shared-project-chat.md); historical foundation evidence: [task001](docs/tasks/001-project-foundation.md). Large Three.js bundle warning is retained.

## Workspace boundaries

| Path | Role |
| --- | --- |
| `apps/web` (`@spatial/web`) | Vite 7, Svelte 5, Three.js viewer |
| `apps/server` (`@spatial/server`) | Local project authority/persistence/approved parameters, read-only data/inspection and isolated ephemeral CAD sandbox |
| `packages/contracts` | Shared types and dependency-free runtime schemas/assertions |
| `packages/project-state` | Entities, coordinate conversion, selection and revisions |
| `packages/geometry` | Geometry/CAD interfaces, analytic proposal bounds and worker-loaded OpenCascade adapter |
| `packages/agent-harness` | Product interfaces, observation boundary and deterministic sampling policy |

Package names use `@spatial/*` and `workspace:*` imports. The harness has no UI, Pi, or direct CAD-kernel dependency.

See [architecture](docs/architecture.md), [coordinate decision](docs/decisions/001-coordinate-conventions.md), [task board](docs/tasks/README.md), and [standing instructions](AGENTS.md). Dependencies are pinned in manifests/lockfile; authoritative version-family references are in architecture.

## Scope and next step

Real kernel solids exist only in the ephemeral CAD sandbox. No approved project CAD edits, simulations, deployment or push. Task019 implements provider-backed read-only chat with server-only task016 credentials; live inference remains unverified. Explicit local persistence and approved non-CAD parameter edits are implemented. Toronto3D observations are read-only and separate from geometry revisions. Selection/pins do not increment geometry revision; approved box/inverse transactions do.

Review checkpoint: complete outstanding browser checks and fresh-session reviews against each task and actual changes; these implementations do not approve one another. The first [shared-project chat shell](docs/tasks/012-shared-project-chat.md) is implemented and independently reviewed: 123/123 baseline plus chat/demo/all-label browser checks pass. Full graph certification remains unresolved; prior task reviews stay separate. [Provider/kernel direction](docs/TODO.md#provider-and-kernel-direction): OpenAI API keys plus ChatGPT subscription sign-in; actual OpenCascade sandbox implemented using pinned direct bindings in task013. [Task016](docs/tasks/016-provider-auth.md) adds backend ChatGPT/API-key authentication with225/225 baseline and isolated fake-provider browser verification; live sign-in remains untested. Task019 now implements bounded read-only model calls; approved project CAD edits remain unimplemented. Task013 passes138/138 baseline tests and independent source review; graph coverage remains incomplete.
