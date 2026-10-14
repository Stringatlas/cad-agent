# Product TODO queue

User approved all seven proposals on 2026-10-13. Item1 and the first shared-project chat-shell slice below were authorized and implemented. User subsequently authorized the bounded real CAD sandbox as task013; items2–7's full authority/approval/model integration remain queued capabilities. Approval is not implementation or fresh-session review. Full scope, acceptance and dependencies: [must-have roadmap](plans/2026-10-13-harness-must-haves.md).

## End vision

A single web workspace: **left-hand 3D scene, right-hand harness chat**. Chat presents inspection evidence and edit proposals; exact approval, revision-checked commit and geometric verification precede reporting success. Committed edits appear in the scene from the same authoritative project state. Previews are not commits, the viewer is not geometry authority, and Pi is not the product runtime. See [architecture](architecture.md#end-state-web-workspace).

## Next reasonable step — shared-project chat shell

**Implemented and independently reviewed as [task012](tasks/012-shared-project-chat.md).** Exact commands/API: [inspection chat](shared-project-chat.md). Task011's isolated runtime/dependency review found no new issues; full graph coverage remains unresolved. The authorized scope was the smallest browser-to-harness integration: the existing 3D view on the left, a read-only chat panel on the right, and a deterministic caller for a small documented set of inspection requests using item1's tool protocol. No provider is needed to prove this seam.

**Scope and acceptance:**
- In the integrated workspace, load the demo project from the server rather than seeding a second browser copy. Viewer and chat/session context show the same authoritative entity IDs, units/frame and geometry revision; selection/camera remain view state. This is a read-only snapshot integration, not the complete item5 session/persistence service.
- Support a documented inspection request through the real allowlisted tool dispatcher and display its request/result/evidence references. Unsupported text reports an explicit unsupported request; no fake model answer or arbitrary tool access. Dataset tools keep separate artifact revisions and do not silently map Toronto coordinates into the demo project.
- Chat distinguishes pending, completed, rejected, incomplete, error and cancelled work without upgrading unverified results. Cancellation and stale session/revision/generation results cannot publish into the active chat or scene.
- Preserve picking/orbit, exact all-label queries and uncapped display detail. Add deterministic integration tests and browser checks for left/right layout, request/result flow, cancellation, stale-result suppression and server failure.

**Exclusions:** model/provider calls, visual capture, save/load, geometry mutations, approval/undo implementation and CAD. No edits are claimed or demonstrated in this slice. Follow it with item5's full authority/persistence gate and item6's deterministic approved box-edit path to prove that chat-originated edits update the left scene; that remains non-CAD until item7. Items2–4 still gate a real VLM loop.

**Verification:**123/123 baseline, eight focused integration tests, ten real-dispatcher chat browser checks and ten exact-all-label/window browser checks pass; demo browser regression passes. Separate fresh-context review found no actionable defect. Exact artifacts/commands and graph/cached-LSP caveats are in task012. Implementation/review do not certify full graph coverage or approve earlier tasks.

**Why first:** it makes the intended workspace usable and tests the real protocol/UI boundary without bundling paid model orchestration or geometry safety. Shared-state integration avoids building chat around the independent demo snapshots that later editing must replace. A focused implementation agent owned task012; a separate fresh-context reviewer checked its actual diff and browser evidence. Any expansion still requires its own bounded task.

## Provider and kernel direction

- **OpenAI provider:** support both server-held API keys and **Continue with ChatGPT** with separately authorized ChatGPT plan usage. This is a requirement for the later real-provider stage, not auth implementation in the first chat shell. Eligible local personal/open-source integrations are documented; paid/remotely hosted use needs access approval. Identity-only sign-in does not grant inference. Subscription mode has distinct model/request capabilities; do not silently fall back to paid API-key usage. Sources: [quickstart](https://developers.openai.com/siwc/quickstart), [local integration](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
- **CAD kernel:** [task013](tasks/013-cad-engine.md) implements the authorized real sandbox using pinned **`replicad-opencascadejs@1.1.0` direct OpenCascade bindings**. The higher-level Replicad JS wrapper was not needed. Actual primitives/booleans, BRep validation, measured bounds/volume, tessellation and meter STEP roundtrip pass; [API](cad-engine.md). This is separate from the read-only chat slice and does not implement approval, persistence or project publication.

## Approved capability backlog

| TODO | State / next gate |
| --- | --- |
| [1. Versioned tool protocol and replayable run evidence](plans/2026-10-13-harness-must-haves.md#1-versioned-tool-protocol-and-replayable-run-evidence--first-slice) | Implemented: [task011](tasks/011-tool-protocol-evidence.md), deterministic read-only caller; 115/115 baseline, independent corrective rereview passes. Final isolated runtime/dependency review passes; full graph completion unresolved. |
| [2. Reproducible visual observations and spatial grounding](plans/2026-10-13-harness-must-haves.md#2-reproducible-visual-observations-and-spatial-grounding) | TODO; depends on item1, fixed-view adapter and browser evidence. |
| [3. Evaluation runner and failure taxonomy](plans/2026-10-13-harness-must-haves.md#3-evaluation-runner-and-failure-taxonomy) | TODO; deterministic fixtures before model runs, grows with item2. |
| [4. Bounded model orchestration](plans/2026-10-13-harness-must-haves.md#4-bounded-model-orchestration) | TODO; depends on items1–3, provider and real-run budget approval. |
| [5. Authoritative project sessions and minimal persistence](plans/2026-10-13-harness-must-haves.md#5-authoritative-project-sessions-and-minimal-persistence) | TODO; separate authority/persistence gate, no multi-user scope. |
| [6. Exact-proposal approval and atomic parameter edits](plans/2026-10-13-harness-must-haves.md#6-proposal--approval--atomic-parameter-edit--checked-outcome) | TODO; depends on items1/5, human approval and revision-checked undo; not CAD. |
| [7. Concrete CAD adapter and geometric postconditions](plans/2026-10-13-harness-must-haves.md#7-concrete-cad-adapter-with-geometric-postconditions) | Sandbox foundation implemented independently in [task013](tasks/013-cad-engine.md); project-integrated verified edits remain TODO and depend on items5–6 plus approved operation-specific postconditions. |

Keep project/dataset revisions distinct, preserve exact all-label search and uncapped display detail, and never equate an observation/model assertion/rendered mesh with verified geometry. The assigned read-only chat integration is implemented/reviewed; live model/provider auth, authoritative mutation and persistence remain unassigned. Task013's real kernel sandbox is separately implemented and reviewed, not an approved project-edit path.
