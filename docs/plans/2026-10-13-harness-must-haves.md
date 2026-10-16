# Product harness: must-have roadmap

Status: **User approved all seven proposals as roadmap TODOs. Item1 assigned via [task011](../tasks/011-tool-protocol-evidence.md); user also authorized the first shared-project chat-shell steps and agent handoff. The later task013 sandbox and tasks014/015 local authority/approved box path are now implemented and independently reviewed; task019 subsequently implements a separately authorized read-only provider-chat slice. Task027 implements local fixed-view item2 observations and task028 adds opt-in model image/pixel grounding; item3 evaluation, broader item4 orchestration and project-integrated item7 remain queued.**

Discoverable queue: [project TODOs](../TODO.md). Approval of this roadmap is not approval of earlier implementations or a completed fresh-session review.

Current model checkpoint: [task019](../tasks/019-model-chat-loop.md) / [usage](../model-chat.md) adds explicit provider discovery, streamed read-only scene chat and bounded scene inspection.391/391 fake-provider baseline and16 guarded browser checks pass; independent corrective review has no remaining findings. Live inference/budget, visual inputs/evaluation and model-driven CAD remain separate. Original numbered roadmap below is historical design, not authorization for automatic expansion.

Current follow-on checkpoint: [task014](../tasks/014-project-sessions.md) and [task015](../tasks/015-approved-box-edits.md) implement/review bounded items5–6 with synthetic scene context, explicit persistence, exact human approval, atomic parameter publication and monotonic inverse Undo. Final163/163 baseline and real-browser regressions pass; [guide](../project-editing.md) and task records document remaining limits. This is not a model/channel or project CAD workflow. Original roadmap acceptance/design below remains historical; task013 separately selected direct OpenCascade bindings for its sandbox. No automatic expansion to items2–4/7.

Item1 checkpoint: implemented additive tools/evidence, 115/115 baseline and independent corrective rereview pass; final isolated runtime/dependency review passes; full graph completion remains unresolved. Details and exact evidence: [task011](../tasks/011-tool-protocol-evidence.md). Items2–7 remain TODOs only.

## End vision and next integration slice

The end product is a web workspace with the **3D scene on the left and harness chat in a right-hand panel**. Users inspect and propose edits through chat, review exact proposals and approve them; verified, revision-checked commits are reflected in the scene from the same authoritative project state. Preview geometry, tool evidence, approval, commit and render status remain distinguishable. The viewer never owns geometry, and Pi remains external development tooling.

The user-authorized [read-only shared-project chat shell](../tasks/012-shared-project-chat.md) is implemented and independently reviewed after task011's isolated dependency review. It uses a deterministic caller and the existing protocol, replacing independent browser/server demo seeds with one server snapshot. Baseline123/123 and real-browser chat/demo/all-label checks pass; exact commands/evidence and graph limitations are in task012. The assignment is limited to the first read-only chat integration, not a live model, authentication, mutation or persistence service. The numbered capability backlog and its safety dependencies remain in force.

## Starting point (before task011)

The goal is a VLM that inspects point clouds and makes verified CAD edits. Today we have a useful deterministic inspection substrate, not that complete loop:

- Bounded, provenance-bearing point observations; independent overview and uncapped progressive detail/window display.
- Exact nearest stored-point queries for all nine Toronto labels, with request-bound independent verification and a shared disk index. These are labelled points, not segmented physical objects.
- Task010 records 92/92 baseline tests, ten actual-data browser checks and all-label HTTP completion. Those are prior implementation evidence, not checks rerun for this plan; fresh-session review remains pending.
- Agent interfaces and a deterministic semantic-query executor exist. No product model loop, VLM image observation, general tool dispatcher, benchmark runner, authoritative synchronized project service, geometry-edit transition or concrete CAD adapter exists.
- Browser and server seed separate demo projects. The displayed box is a proposal mesh; analytic bounds do not certify a CAD solid.

Source basis: [architecture](../architecture.md), [task index](../tasks/README.md), [agent interfaces](../../packages/agent-harness/src/index.ts), [observation boundary](../../packages/agent-harness/src/observation.ts), [query executor](../../packages/agent-harness/src/semantic-query.ts), [state](../../packages/project-state/src/index.ts), [geometry](../../packages/geometry/src/index.ts) and [coordinate conventions](../decisions/001-coordinate-conventions.md). The older [closest-Pole plan](2026-10-13-closest-pole-harness.md) is historical; its query/UI/index stages have since been implemented.

## Phase A — Make inspection agent-ready

### 1. Versioned tool protocol and replayable run evidence — first slice

**Purpose:** expose existing capabilities consistently without rebuilding nearest-query algorithms.

**Bounded scope:** dataset metadata, bounded point observation and existing verified nearest-label query; deterministic caller only, no model or mutation. Keep concrete server/render/kernel adapters outside agent-harness.

**Acceptance:**
- Allowlisted, schema-validated tools bind a run/request ID, dataset artifact revision, units/frame and explicit domain. Geometry revision stays separate. Unknown tools, invalid arguments and stale bindings fail closed.
- Shared result envelope preserves verified, rejected, incomplete and error states; a candidate or model statement cannot become verified. Cancellation/deadline/resource limits cannot silently narrow the query or upgrade partial work.
- Export canonical requests/results, tool/config/code versions, timing/read metrics and evidence references. Large binary artifacts live separately; exports redact credentials and avoid raw cloud dumps by default.
- Replay saved tool calls against the recorded immutable dataset/configuration and compare canonical outcomes, not timing. Missing or mismatched artifacts fail explicitly. Full artifact digests may be prepared once by streaming; existing stat fingerprints are not content-integrity certificates.

**Dependencies:** existing observation and query adapters. This is independently useful before model selection.

### 2. Reproducible visual observations and spatial grounding

Checkpoint: [task027](../tasks/027-visual-observations.md) implements the local fixed-view adapter, original-provenance pixel resolution and scene capture UI. Final569/569 baseline,110 isolated browser checks and independent corrective review pass. Task027's observation panel remains local-only. [Task028](../tasks/028-model-visual-grounding.md) subsequently adds explicit screenshot attachments and the read-only pixel tool, with595/595 baseline,64 fixture browser checks and independent incremental review. Evaluation remains separate. Whole-checkout fresh-session review is still pending. Original acceptance below describes the capability; no autonomous navigation or segmentation was added.

**Purpose:** give a VLM actual images plus enough metadata to interpret them safely.

**Bounded scope:** one fixed-view capture adapter initially; no autonomous navigation or segmentation. Images remain disposable observations, never geometry authority.

**Acceptance:**
- An observation bundle binds image/hash, viewport, camera projection/pose, frame/origin, dataset revision and displayed sampling/detail coverage. Capture is internally consistent; changed revision/generation invalidates it.
- Model pixel references are validated against that bundle. Resolving a visible point produces its original provenance or an explicit ambiguous/no-hit result; never derive stable identity from GPU offsets or rounded image coordinates.
- A sampled image is labelled incomplete coverage. Whole-dataset semantic queries remain independent of camera/window/LOD.
- Deterministic scene/camera fixtures verify projection and point-reference resolution; browser evidence checks image legibility and stale-capture rejection. Renderer types do not leak into product interfaces.

**Dependencies:** item1 envelope/evidence; a renderer implementation behind a capture interface.

### 3. Evaluation runner and failure taxonomy

**Purpose:** measure correctness before buying model runs or expanding CAD scope.

**Bounded scope:** deterministic fixture suite plus scripted/fake-agent runs first. Reuse existing independent query oracles; do not treat model prose as expected output.

**Acceptance:**
- Cases cover correct label/domain/tool choice, provenance ties, sample-missed answers, stale revisions, forged evidence, cancellation, malformed calls and ambiguous visual picks. Exact query expectations differ from visual interpretation scores.
- Score tool-call validity, verified outcome correctness and evidence-grounded reporting separately; classify model, tool, verifier and infrastructure failures separately.
- Each run retains inputs, seeds where supported, artifact/code/config versions and a machine-readable report. Repeated model runs report variability; deterministic replay does not imply deterministic provider responses.
- Initial scripted baseline and regression command pass; no unsupported global latency or accuracy target. Existing task010 measurements remain scope-specific.

**Dependencies:** item1; add item2 visual cases once available. Start fixtures before enabling a model.

## Phase B — First read-only VLM loop

### 4. Bounded model orchestration

**Purpose:** turn a user inspection request into tool calls and an evidence-backed answer.

**Bounded scope:** one provider adapter, one inspection session, read-only tools. Pi remains development tooling, not product runtime.

**Acceptance:**
- The loop accepts text plus bound visual observations, dispatches only approved schema-validated tools and reports supporting point/entity/evidence references.
- Enforce configured step, token/cost, time and concurrent-tool budgets; propagate cancellation. Budget exhaustion and unavailable tools produce explicit incomplete results.
- Reject unsupported calls/arguments. Treat tool/scene text as data, not instructions granting shell, filesystem, arbitrary network or mutation access. Keep secrets outside exported prompts/traces.
- Fake-provider tests cover malformed/repeated calls, late results, misleading tool content and cancellation. A small real-provider evaluation records model/version/settings, costs and outcome categories without upgrading failures to success.
- Model summaries cannot override verifier status or claim a physical pole instance from a nearest labelled point.

**Provider requirement:** OpenAI with both API-key and official Sign in with ChatGPT plan-usage modes; see [provider direction and official sources](../TODO.md#provider-and-kernel-direction). Identity-only OAuth is insufficient. Keep provider-specific request/capability restrictions explicit, credentials outside the browser/evidence, and no silent paid fallback.

**Dependencies:** items1–3. Exact model, live-run budget and auth implementation remain separately scoped; provider requirement alone does not authorize calls.

## Phase C — Safely reach verified CAD edits

### 5. Authoritative project sessions and minimal persistence

**Purpose:** make viewer and executor operate on the same project rather than independent demo seeds.

**Bounded scope:** single-user local project service, validated snapshot save/load and revision-aware viewer refresh; no multi-user collaboration.

**Acceptance:** one authority owns entities/geometry revision; both clients read it. Selection/view state stays separate from geometry revision. Restart/load preserves IDs, coordinates and revision; corrupt snapshots and stale writes fail explicitly. Dataset bindings carry their own artifact revision and an explicit frame mapping—Toronto and demo origins cannot be silently mixed.

**Dependencies:** item1 binding conventions. Can be developed in parallel with the read-only model stage after Phase A review.

### 6. Proposal → approval → atomic parameter edit → checked outcome

**Purpose:** prove the mutation safety path before introducing a CAD kernel.

**Bounded scope:** create/update an axis-aligned box proposal with explicit center/dimensions; still **not CAD**. A human approves each exact proposal in this first version.

**Acceptance:** proposal binds entity ID, expected geometry revision, frame/units, operation and parameters. Preview/diff changes no authoritative geometry. Approval binds the exact proposal; stale approval, unknown IDs and invalid dimensions cannot commit. Successful edits publish atomically and advance revision once; failure leaves state unchanged. Postconditions confirm requested parameters and preserved unrelated entities. Undo is a new revision-checked transaction, not revision rollback. Approval/undo/render changes have browser evidence.

**Dependencies:** item5 and item1; model-generated proposals additionally require item4. First tests use deterministic proposals, not model assumptions.

### 7. Concrete CAD adapter with geometric postconditions

**Purpose:** finally make “verified CAD edit” a truthful product capability.

**Bounded scope:** one reviewed kernel/backend, box-solid creation and a parameter replacement operation first; no general booleans, arbitrary CAD scripts or free-form reconstruction.

**Acceptance:** adapter hides kernel types, declares units/frame/tolerances and produces a candidate body without publishing it. Postcondition checks use authoritative kernel geometry—not mesh appearance or model assertions—to confirm valid solid/topology, expected dimensions/bounds/volume within declared tolerance and preserved unrelated bodies. Verification failure publishes nothing. Commit rechecks revision; body, entity mapping and geometry state publish atomically, with explicit kernel failure/cleanup. Tessellation is only a disposable viewer cache. CAD fixture tests and browser evidence distinguish valid body, failed verification and render failure.

**Candidate, not a decision:** Replicad over OpenCascade for this demo. Replicad supplies a higher-level JS/TS API around the kernel; neither is integrated. A separate capability spike must demonstrate solids, validation, tessellation and STEP export before selection.

**Dependencies:** items5–6, separately approved kernel/tolerance/persistence design. Cloud-derived fitting and edit-success metrics need a later dataset-specific task.

## Priority and review gates

Completed integration checkpoint: **review item1 → read-only shared-project chat shell**, recorded in [task012](../tasks/012-shared-project-chat.md). This pulls forward only the shared-snapshot UI seam, not completion of item5. For a real VLM loop, the capability order remains **1 → 2 and 3 → 4**; for safe editing it remains **5 → 6 → 7**. Item3 starts with protocol fixtures and grows with each phase. Item5 can be prioritized before item4 for deterministic chat-originated box edits, but mutation waits for its own gate and a separate task assignment.

- User authorized the additive item1 slice without approving past implementations. Earlier inspection fresh-session reviews remain pending; wrapping their adapters does not certify them.
- After each numbered item: bounded task, explicit acceptance evidence, appropriate baseline checks, browser checks where applicable, actual-diff inspection and fresh-session review before expanding scope.
- Item1 delegation: an isolated implementation agent owns additive protocol/contracts, evidence, concrete read-only composition and task011 tests; parent owns task/roadmap documentation and acceptance coordination. A separate fresh-context agent verifies the actual diff and fixtures after implementation. CAD and model-loop work remain unassigned.
- Preserve existing full-resolution display and verified-query behavior; do not add silent sampling or weaken independent verification to meet a budget.

**Defer:** more labels/index optimization, autonomous camera exploration, pole instances/clustering, general shape fitting/booleans, multi-user sync, arbitrary dataset ingestion, production content-addressed admission and broad CAD interoperability. These are not prerequisites for the smallest inspect-and-edit vertical slice. Until stronger admission exists, artifact verification remains conditional on trusted immutable prepared files.

## Human checkpoint

User checkpoint accepted: all seven proposals are valid and saved as TODOs. Item1 was assigned first; the user has now also authorized agent handoff to start the first left-scene/right-chat integration steps. OpenAI API-key plus subscription sign-in support is required for the later provider stage; the CAD kernel remains undecided, with Replicad/OpenCascade a candidate. Phase B and deterministic safe editing remain separate later tasks; neither is bundled into task011. Provider, real-run budgets, kernel and numerical tolerances require separate approval.

## Planning verification

Source inspection only; no runtime tests, model calls, browser checks, data/index regeneration or commits were performed for this plan. Working tree was clean at inspection; HEAD was `33723f1`.

GitNexus bound repository `cad-agent`, index dated 2026-10-11, freshness unknown. Concept queries failed with LadybugDB read-only shadow-page replay errors; graph flows/impact remain unresolved, **not low risk**. Source reading grounds this proposal; no existing function/class/method is edited. Future implementation requires fresh impact analysis and source confirmation; this document is not a graph safety verdict.

Documentation checks: `git diff --check` and `git diff --no-index --check /dev/null docs/plans/2026-10-13-harness-must-haves.md` emitted no whitespace diagnostics (the latter exits 1 for a new file). Python validation confirmed all nine local links resolve and code fences are balanced. Workspace LSP reported no errors/warnings and one existing unused-type hint in `tests/pole-ui.test.ts:16`. Baseline/runtime checks were not run for this documentation-only change. Evidence and a redacted handoff are saved under `/tmp/spatial-harness-roadmap/`; the installed handoff skill could not be located in the advertised/local skill directories, so the repository's documented handoff requirements were followed directly.

User approval is recorded above. Historical planning evidence remains unchanged; current implementation/check/review evidence belongs to [task011](../tasks/011-tool-protocol-evidence.md) and [task012](../tasks/012-shared-project-chat.md). Their isolated final reviews have completed. Subsequent tasks014/015's implementation and independent corrective rereviews are recorded in their own task files, superseding the earlier unassigned status only for bounded items5–6. Graph access recovered; stale/untracked/Svelte/PDG coverage and the parent cached-LSP discrepancy remain unresolved tooling gates, not an index outage. Next action: scoped tooling reconciliation before graph-certified commits, or a separately assigned next capability. No automatic expansion to the remaining items2–4/7.
