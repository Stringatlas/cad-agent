# 052 — Authored datum points and scene hierarchy

Status: Implemented; fresh-session review pending (known baseline test failures and incomplete graph coverage remain)

## Ownership
- Implementation owner: Pi session and isolated authority/web/model agents
- Review owner: Unassigned (fresh session)

## Goal / scope
Implement the authorized first checkpoint in [decision 002](../decisions/002-scene-object-model.md): bounded volatile Toronto authored datum points, exact retained human-approved proposals, typed references, model discovery/create tools, and a compact top-left hierarchy/Create Point editor. Keep source overrides, native CAD authority and synthetic fixtures separate. No source insertion, general document CRUD, persistence, ECS or associative geometry.

## Acceptance criteria
- [x] Strict versioned datum contracts; finite positions, bounded names/budgets, explicit bindings and authority-reserved IDs.
- [x] Independent volatile datum authority; snapshot/propose/accept/decline/Undo, exact publication, receipts, checked reference preconditions.
- [x] Model list/get/create tools; no model approval; accepted objects discoverable through typed references.
- [x] Top-left hierarchy/Create Point UI, ghosts, per-change review, selection/picking, typed chat attachments.
- [x] Automated contract/authority/routes/client/model/render/UI tests added; typecheck/build pass.
- [x] Bounded desktop/mobile browser checks including Undo, stale recovery, typed later model turn and view-only visibility; limitations recorded below.
- [x] Final graph change analysis attempted and actual task diff inspected; graph remains incomplete/CRITICAL, not a clean certification.
- [ ] Fresh-session review (separate from implementation and focused regression review).

## Implementation progress
- New shared contracts: `packages/contracts/src/scene-objects.ts`.
- New authority/routes: `apps/server/src/scene-object-{session,routes}.ts`, composed once in `apps/server/src/index.ts` sharing existing point-override authority.
- Model integration: `model-scene.ts`, `provider-model.ts`, `model-agent-runtime.ts`, shared model-chat protocol. Tools: `scene.list_objects`, `scene.get_object`, `scene.propose_point_create`; explicit positions or server-resolved object/source aliases plus offset. Retained candidates publish only through human review.
- Web: `SceneObjects.svelte`, `scene-object-{client,render}.ts`; existing Toronto/App/chat/review integration. Selected datums are authored references, never source pins.
- Focused independent regression review fixed two Task052 failures: a source-ID fixture and screenshot-grounding contract checks. It found no serious authority/model safety defect; this is not final fresh-session review.
- Preserve unrelated staged tasks047–051 and operator configuration. No commit requested or made.

## Verification evidence
| Exact command/check | Result | Diagnostics/artifacts |
| --- | --- | --- |
| `pnpm typecheck` | Pass (Svelte 0 errors/warnings) | `/tmp/task052-typecheck.log` |
| `pnpm build` | Pass; existing bundle-size warning | `/tmp/task052-build.log` |
| `pnpm test` | Blocked by tsx IPC pipe `EPERM` | `/tmp/task052-tests.log` |
| `node --import tsx --test tests/*.test.ts` (post-review rerun) | 920/925 pass; five failures reproduced against staged-index baseline | `/tmp/task052-review-full-rerun.log`, `/tmp/task052-regression-review-handoff.md` |
| Focused model suites | 133 pass | `/tmp/task052-model-focused.log` |
| Focused regression/client/grounding suites | 36 pass | `/tmp/task052-regression-review-handoff.md` |
| LSP changed TS files | Clean where checked; workspace cache alone not used as proof | Agent handoffs + current typecheck |
| Graph refresh | Pass with repo-local supported registry; global registry write denied | `/tmp/task052-graph-refresh.log`; `GITNEXUS_HOME="$PWD/.gitnexus/local-registry" node .gitnexus/run.cjs analyze --index-only --pdg` |
| Upstream impact | Model canonical scene validation HIGH (additive regression coverage); startup LOW 9 affected / 2 direct; client event validation LOW 3 affected | Session tool evidence; graph process coverage warns about bounded/missing flows |
| Browser desktop, real Toronto dataset | Idle/expanded/Create Point/pending ghost/decline/accept/selected/focus/scene pick pass | Isolated fixture `http://localhost:5174`, API :3002; `/tmp/task052-browser-server.mts` |
| Browser mobile 390×844 | Collapsed selected hierarchy; scrollable editor; checked datum offset preview/accept pass | Same isolated fixture; real Chrome via browser harness |

Browser screenshot artifacts:
- Desktop pending: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-c9b1cd07-72e2-49af-8386-f6caa48143d4.jpeg`
- Mobile selected/chat: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-a11ea9a2-2f21-42c6-8ba4-e502d5212e7a.jpeg`
- Mobile pending offset: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-89a4383d-bb6c-43db-988f-8d44156b53ef.jpeg`

Browser observations: decline left revision0/empty objects; accept published exact `[238.77,538.488,160]` at revision1; accepted reference+`[1,0,0]` published `[239.77,538.488,160]` at revision2. Camera interaction left original datum bytes unchanged. Native controls are clipped by bounded navigator until scrolled; keyboard focus and normal region scrolling expose them. No paid/live inference calls were made. Disabled fake fixture provider does not verify production provider inference.

## Final continuation evidence
- Added view-only per-datum Hide/Show. Hidden committed datums cannot be picked/selected; hiding clears selection, pending ghosts remain visible and authority snapshots/revisions do not change. Visibility resets with mounted view/artifact; it is not persisted. Derived disclosure now says its inventory is not listed, rather than falsely asserting no layers are loaded. Full derived hierarchy integration remains follow-up.
- Mobile UI Undo removed the offset datum at revision3, then the original at revision4, leaving no objects/proposals. Stale test deliberately advanced isolated authority externally to revision5, then submitted the old UI binding: visible `stale-revision` error blocked mutation and offered Refresh objects. Refresh recovered. External acceptance was solely a concurrency fixture, not the primary approval-path test.
- Desktop fake-model fixture `http://127.0.0.1:5175`, API3003: manually previewed/accepted `Typed browser datum` at `[238.77,538.488,160]`; selected it and sent a later typed turn. Scripted transport received its authored reference and called list/get/create, proposed exact `[239.77,538.488,160]`, paused for human acceptance, then resumed with `Human outcome: accepted`. Real authority ended at revision2 with exactly these two datums. No external inference or paid calls. Fixture and exact effective-input/tool evidence: `/tmp/task052-fake-model-browser-server.mts`, `/tmp/task052-fake-model-requests.ndjson`.
- Desktop and mobile390×844 Hide/Show controls work; hidden rows are disabled, showing restores selection eligibility. Desktop authority remained revision1 with exact original position while toggling visibility. A mobile account panel could overlap the chat toggle in the existing header; DOM activation closed chat for scene checks. This is not a claim that the entire existing header has passed mobile interaction review.
- Final mobile hierarchy visibility/layout screenshot: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-3d085dd8-b6c7-4d87-a419-75357bcade1a.jpeg`.
- Error-state screenshot: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-6e3y8ul1-b535e8e9-7ad6-4cb2-af5c-b3da827a6c1a.jpeg`.
- Final `pnpm typecheck` and `pnpm build` pass: `/tmp/task052-final-typecheck.log`, `/tmp/task052-final-build.log`. Final `node --import tsx --test tests/scene-object*.test.ts tests/model-scene-objects.test.ts`:28/28 pass, `/tmp/task052-final-focused.log`. Hierarchy focused15/15 and independent final inspection36/36 also pass (`/tmp/task052-hierarchy-focused.log`, `/tmp/task052-final-review-focused.log`). Final full rerun `node --import tsx --test tests/*.test.ts` remains920/925 with the same five staged-baseline failures (`/tmp/task052-final-full.log`); failures are not waived. Workspace TypeScript LSP cache clean; typecheck remains the primary compilation evidence.
- Final graph refresh and `detect-changes --scope all --repo .` plus reruns with `--limit 5000` and unstaged scope completed. Whole dirty checkout:72files/748symbols/153affected processes, **CRITICAL**; unstaged:16files/69symbols/56processes, **CRITICAL**. CLI still displays bounded results despite raised limit; refresh also warns of missing flows. Logs: `/tmp/task052-final-graph-refresh.log`, `/tmp/task052-final-graph-changes-full.log`, `/tmp/task052-final-graph-unstaged.log`. No clean complete graph claim; untracked additions were inspected directly, not assumed covered by diff detection.
- Actual unstaged task diff plus all13untracked files inspected independently; no new serious authority/model/approval defect found. Evidence `/tmp/task052-final-diff-inspection-handoff.md`. Staged tasks047–051 and operator config preserved, no commit. `git diff --check` clean. ADR002/architecture/task index updated to reflect bounded implemented scope.

## Graph coverage follow-up
User requested completion of graph analysis and fixture cleanup. A forced PDG rebuild completed (40,172 nodes/99,462 edges/606 sampled flows). Raw backend evidence now includes every untracked file and recovers the full change listing without the CLI presentation cap: task052 delta509symbols/88sampled processes, full dirty checkout1,184symbols/176sampled processes. Exact ID unions validated; no partial/truncated task052 result. Evidence: `/tmp/task052-graph-investigation-handoff.md`, `/tmp/task052-graph-raw-task052.json`, `/tmp/task052-graph-all-symbols-union.json`, `/tmp/task052-graph-validation-summary.json`.

Targeted CRITICAL caller audit accounts for all23reference +7snapshot impacted nodes and manually traces missing Svelte/controller/renderer paths. Object-focused41/41 tests pass; broader135/138 retains three reproduced baseline failures. No new task052 authority/publication defect found. Evidence matrix: `/tmp/agents/task052-critical-impact-closure.md`. A separate pre-existing synchronous callback-reentrancy display defect was reproduced against baseline (`model-chat-client.ts:453,469–470`); it cancels correctly but can leave stale streaming text, not an authority bypass. No live-browser manifestation claimed; leave as bounded follow-up rather than unrelated task052 change.

CRITICAL remains the truthful cross-module blast-radius classification, not a failed correctness assertion to suppress. Complete graph certification is unavailable in installed GitNexus1.6.12: entrypoint200cap is hardcoded, process extraction omits542candidate entries/2,458callees/50walks/one deep trace, Svelte has File nodes only, and some generic method names falsely resolve across runtimes. No supported configuration removes those limitations; no installed-tool monkeypatch or reduced checks used. Raw listing completeness is resolved; static/dynamic flow certification is not claimed.

Fixture cleanup rechecked: `lsof` confirms task processes26929(:3002/:5174),27952(:3003/:5175) still listen. Sandbox denies process inspection/signaling; requested temporary operator `/sandbox-disable` before verified scoped cleanup. Operator servers:3001/:5173 must remain untouched.

## Review / next action
Fresh-session review against task052 and actual task diff remains pending. Baseline suite failures and incomplete CRITICAL graph analysis remain explicit limitations; implementation/focused inspection is not final review. Review should also inspect mobile header overlap and the bounded virtual Sources/Derived sections without expanding this slice into general document CRUD.
