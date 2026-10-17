# 035 — Chat-first conversation and scene-native point move review

Status: Implemented; fresh-session review pending

## Ownership
- Implementation: parent integration with isolated chat, backend, point-scene and browser workers.
- Review: fresh-session whole-checkout review unassigned. Focused independent safety inspection found a verified no-op bug; fixed and regression-tested.

## Goal / scope
Make chat the primary conversation surface with left AI/right user bubbles and safely rendered Markdown. Asking “move point 1 and point 2 to their closest poles respectively” must produce independently verified destinations, retain originals and show distinct unconfirmed copies in the scene, with bottom-right individual Confirm/Reject controls. Preserve dirty tasks032–034; no automatic publication, manual-control detour, provider fallback, durable dataset writes or broader tool-budget expansion.

## Acceptance
- [x] Conversation bubbles and safe Markdown; technical controls and actual provider-request inspection remain available but collapsed.
- [x] Two source selections resolve independently through model tools and original-dataset search/verification; no model-supplied destination authority.
- [x] Both retained exact proposals are visible simultaneously; source colors/positions stay unchanged before approval; proposed markers are amber and labeled.
- [x] Each change requires individual Confirm/Reject. Confirming one preserves a disjoint unchanged candidate after authority precondition revalidation at the new revision. Stale approvals fail; conflicts invalidate; Undo clears pending.
- [x] A verified already-at-destination point reports no-change and does not abort the other requested move.
- [x] Appropriate tests, typechecks, build and isolated existing-Chrome checks pass.
- [ ] Fresh-session review against actual combined dirty diff. Task034 review remains separately pending.

## Implementation
- `ModelChat.svelte`, `SafeMarkdown.svelte`, `safe-markdown.ts`: structured escaped Markdown, restricted link protocols, inert raw HTML/images; conversation-first controls and bubbles. No raw HTML injection.
- `model-scene.ts`, `provider-model.ts`: bounded `propose_point_move_to_nearest_label({pointName,label})` performs independent original-source query/verification and retains a one-point exact proposal. Two respective moves fit existing two-call/three-round bounds. A no-change result has evidence but no candidate.
- `point-overrides.ts`: approving one candidate rechecks original records and effective-before preconditions for disjoint survivors before publication; only their revision binding advances. Exact ID/moves remain unchanged, never geometry-rebased. Conflicts invalidate; decline is individual; undo clears all pending.
- `point-override-client.ts`, `PointEdits.svelte`, `Toronto.svelte`, viewer/render caches: authority pending reload after publication, all pending copies and labels, bottom-right per-change controls; manual tools secondary. App owns shared state notifications; sole point-review mount lives in scene, not chat.

## Verification evidence
| Exact command/check | Result | Artifacts |
| --- | --- | --- |
| `pnpm typecheck` | Pass; Svelte 0 errors / 0 warnings | `/tmp/task035-typecheck.log` |
| `pnpm build` | Pass; existing Vite large-bundle advisory | `/tmp/task035-build.log` |
| `pnpm test` | Blocked by tsx CLI IPC `EPERM` on `/tmp/agents/tsx-501/*.pipe`; equivalent direct invocation below | Initial output superseded in full-test log |
| `node --import tsx --test tests/*.test.ts` | Final 695/695 pass | `/tmp/task035-full-tests.log` |
| `node --import tsx --test tests/semantic-disk-storage.test.ts` | 7/7 pass; first full parallel run transiently failed staging cleanup assertion; subsequent full run passes unchanged | `/tmp/task035-storage-retry.log` |
| `node --import tsx scripts/browser-chat-point-moves-smoke.mjs http://127.0.0.1:9222 /tmp/task035-browser` | Five groups pass; console errors empty | `/tmp/task035-browser/report.json`, six PNG + AX snapshots, model bodies and bubble styles |
| `node --import tsx scripts/browser-toronto-cad-smoke.mjs http://127.0.0.1:9222 /tmp/task035-cad-regression` | Six actual-native-kernel regression groups pass | `/tmp/task035-cad-regression/report.json` |
| `git diff --check` | Pass | Combined tracked diff inspected; prior work preserved |

Browser tests use a new tab in existing Chrome, isolated fixture authorities and synthetic provider transport; actual model tool execution, search/verifier, approvals and native CAD worker run. No live account/inference or production-scale task035 claim. Browser daemon unavailable to child; existing-Chrome direct CDP fallback used. Desktop/mobile captures show individual scene review. Mobile chat overlays review until Toggle chat closes it; a review card may obscure a proposed label depending on camera.

## Tooling / limitations
GitNexus graph is two commits behind with missing untracked/Svelte coverage. Scoped impacts range LOW/UNKNOWN; UNKNOWN callers confirmed against source and tests. Combined tasks032–035 detect-changes reports CRITICAL (68 changed / 84 affected / 30 files), with truncated output: unresolved, not clean certification. No commit made. Cached parent LSP reports stale contract/controller errors; fresh command-line TypeScript/Svelte checks pass, not an LSP-clean claim.

## Next action
Fresh-session task035 review against this task and actual diff, preserving other dirty tasks. Review mobile overlap/marker legibility, live-model choice of bounded tools and production-scale latency separately. Handoff: `/tmp/task035-completion-handoff.md`.
