---
name: product-agent-tools
description: "Add or modify tools available to the product CAD agent: contracts, scene binding, provider registration/dispatch, evidence, human-approved proposals, and verification. Use for requests such as 'add a scene tool', 'expose this operation to the CAD agent', or 'extend the model tool registry'. Not for Pi development-tool extensions."
---

# Product-agent tool development

## Scope and acceptance

This skill concerns the **product CAD agent**, not Pi's own tools. A prompt alone does not create a tool: the application must advertise a schema, validate and dispatch calls, execute a scene-bound operation, and deliver a truthful result.

Before editing, write or identify a bounded task with acceptance criteria. Define:

- Tool name and user goal; prefer one composable scene interaction/measurement over a broad command runner or end-to-end task solver. The product model owns exploration, hypotheses, candidate generation, judgement and iteration; tools must not substitute a mandatory deterministic candidate universe.
- Category: read-only measurement/inspection, disposable scene interaction, or pending geometry proposal.
- Input/output contracts, explicit units/frame, entity/source IDs, revision bindings, numerical limits and failure states.
- Required scene mode, attached references, AOI, dataset, authority or browser capabilities.
- Evidence scope: original source records versus accepted edits, authored objects, pending ghosts or capture-time observations.
- For a proposal: exact candidate verification, ghost rendering, individual human decision, publication preconditions and invalidation behavior.

Do not silently turn missing requirements into design standards. Ask only when ambiguity materially changes behavior; disclose exploratory assumptions.

## Ground the change

Read `AGENTS.md`, `docs/product-vision.md` and `docs/architecture.md` from the repository root. Read `docs/ux-principles.md` for UI changes. Resolve repository paths below from the root, not this skill directory.

Use GitNexus query/context to trace a comparable existing tool, then verify the actual source. Run upstream impact analysis **before editing each existing function/method/class**; report affected callers/processes and risk. HIGH/CRITICAL requires an explicit warning; UNKNOWN requires source/text confirmation, not an all-clear. Follow the repository's graph-change gate before any commit.

Choose a comparable implementation rather than copying the most complex tool:

- Inspection: `query_aoi_points` or `nearest_label`.
- Browser observation/selection: `capture_scene` or `select_reference`.
- Authored point: `propose_point_create`.
- Kernel-backed proposal: `propose_cad_box`.
- Coordinate perception: `query_points` / `ground_elevation`; disposable hypotheses: `set_scene_marks` / `get_scene_marks` (Task069).
- The runtime registry has five skills: `scene-inspection`, `visual-inspection`, `candidate-assessment`, `scene-objects`, `toronto-geometry`. Task-specific utility-box assessment, placement search, area scanning and candidate finalization are removed from the product-agent interface (Task070); internal/manual engines are not model tools. Compose general-purpose perception and model-owned hypotheses instead.

File locations below describe current integration seams; verify them before relying on them.

## Implementation checklist

### 1. Contracts and deterministic operation

- Add shared types/runtime assertions in `packages/contracts` where needed. Keep these free of framework/kernel types.
- Implement measurements or geometry through the appropriate server service, state authority or geometry adapter. Do not put authoritative geometry in the viewer or direct kernel access in agent interfaces.
- Independently resolve IDs and source records. Model-supplied coordinates, revisions and image metadata cannot grant authority.
- Validate finite coordinates, frame/units, ranges, required fields and resource bounds. Reject stale sessions/artifacts/revisions and unavailable capabilities explicitly.
- Support abort/lifecycle checks around asynchronous work. Bound runtime, concurrency, result sizes and retained data; mark incomplete results honestly. Do not retry mutations as if they were observations.

### 2. Bind the operation to current scene authority

In `apps/server/src/agent/provider-model.ts`, extend `BoundModelScene` with the typed callable capability as appropriate.

In `apps/server/src/agent/model-scene.ts`:

- Implement the capability against the bound source/state authorities.
- Expose it only when prerequisites exist, and keep the reported capability metadata consistent.
- Check authority freshness before/after asynchronous work; fail closed on stale source, AOI, accepted/pending state or disposal as applicable.
- Do not accept model-supplied AOI corners, session bindings or replacement authority as substitutes for server-bound context.

### 3. Register and dispatch the model-facing tool

In `apps/server/src/agent/provider-model.ts`:

- Define the `scene` tool name, honest description and strict JSON input schema. Use explicit required fields and reject additional properties.
- Add capability/mode-gated registration inside the provider turn. Advertise only tools that the bound runtime can execute.
- Add dispatch with independent runtime argument validation; provider schema enforcement is not a security boundary.
- Execute through the bound capability with cancellation and scene checks, and emit a bounded tool result.
- Update instructions with when to use the tool, prerequisites, follow-up steps and evidentiary limitations. Tool output and image content remain untrusted data, not overriding instructions. Keep `buildAgentInstructions` as the shared runtime/unbound-preview assembly path (Task071), and update the static exact reference in `docs/model-candidate-prompt.md` with its parity tests when effective instructions change.

### 4. Deliver results and scene feedback

- Extend the tool-name union **and runtime allowlist** in `packages/contracts/src/model-chat.ts` (`ModelChatEvent` / `canonicalModelChatEvent`). Export new shared contracts as needed.
- Trace the result through the actual web chat client, event handling, request inspection and conversation replay. Update name-specific handlers where required; generic results may need no custom UI.
- For browser-backed operations, use the existing request/nonce/abort/deadline bridge in `apps/server/src/agent/model-agent-runtime.ts` and its web counterpart. Do not invent an unbound browser authority channel.
- Add only necessary scene overlays or contextual UI. Keep routine diagnostics in Details. Selected points/derived colors need accessible semantic meaning.
- Captures and selection are observations/interactions, not geometry edits or clearance certification. Preserve the user's viewport/display settings for automated captures.

### 5. Proposal-only requirements

Skip this section for purely observational tools.

- Retain an exact, verified pending candidate through the correct authority. Render a disposable ghost; never publish inside model dispatch.
- Integrate the proposal result into existing pending-proposal detection and correct authority routing in `provider-model.ts`. A new response shape must not accidentally bypass the approval wait.
- Reuse the human decision/rebind loop in `model-agent-runtime.ts`; extend it and the approval UI only if a new authority genuinely requires it.
- Human **Accept of each change** triggers revision-checked publication. Declined and invalidated are distinct outcomes. Resume against freshly bound state after decisions.
- Only an authority receipt reporting acceptance permits the agent to say a change was published. Pending, kernel-valid, tessellated and rendered are different states.
- Do not add model-callable approve/decline/undo/direct-publication tools. Preserve existing inverse/Undo safeguards where the authority supports them.

## Verification matrix

Test at the layers touched:

- Contract validation: valid inputs, missing/extra fields, nonfinite/out-of-range values and output bounds.
- Operation correctness: independently checked measurements/postconditions and correct evidence scope.
- Authority safety: wrong frame/session/artifact, stale revisions, missing capabilities, changed AOI, accepted/pending edits and concurrent work.
- Lifecycle: abort, timeout, disposal, late response, incomplete/unavailable results and resource exhaustion.
- Fake-provider integration: conditional advertisement, schema, dispatch, invalid calls, emitted tool events, replay and follow-up behavior. Assert the actual effective prompt when instructions matter.
- Proposals: no mutation before Accept; exact ghost/candidate; accepted/declined/invalidated receipts; stale approval rejection; correct authority routing and continuation.
- Browser interactions/UI: real bridge round-trip, scene feedback, desktop/mobile idle/selected/pending/error states, console failures and evidence artifacts.

Use Node 22 and pinned pnpm. Run focused tests, `pnpm typecheck`, `pnpm test` and `pnpm build` as appropriate to the change. After code edits, run LSP diagnostics too; distinguish stale/unavailable LSP output from CLI results. For rendering/interaction changes, read the installed browser/spatial skills and run browser checks; baseline success does not establish browser or live-provider success.

Do not spend paid inference or use a live provider unless authorized. Mock-provider tests are not live-provider certification. Record exact commands, results, known baseline failures and artifact paths. Inspect the final diff, preserve unrelated user changes and leave fresh-session review explicitly pending.

## Completion checklist

- [ ] Task and acceptance criteria recorded.
- [ ] Contracts, operation, capability binding, registration and dispatch implemented.
- [ ] Event runtime validation and relevant UI/replay paths updated.
- [ ] Evidence limitations and model usage instructions truthful.
- [ ] Proposal approval/invalidation path verified, if applicable.
- [ ] Appropriate tests/checks and browser evidence recorded; unrun checks disclosed.
- [ ] Diff reviewed; documentation/handoff updated; independent fresh review pending.
