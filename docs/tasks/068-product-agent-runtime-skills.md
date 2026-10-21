# Task068 — Product-agent runtime skills

## Scope
Refactor product runtime workflow instructions into discoverable, referenceable skills. Not Pi development skills. Preserve bound tools, model-led candidate judgement, and individual human approval. No paid inference.

## Acceptance criteria
- Always-on authority, frame, untrusted-input, evidence and human-approval safety rules remain in every request.
- Capability-filtered catalog plus list/load scene tools expose stable IDs and exact workflow instructions.
- Workflow instructions must be delivered in an earlier provider request before workflow tool execution; unloaded calls return actionable recovery without side effects. Loading grants no capability. inspect_scene remains an always-available bootstrap tool.
- Dependencies load together; current capabilities are independently checked on every round. Readiness is turn-local and instructions visible in effective request inspection.
- Preserve provisional scan → actual targeted capture → model finalization and existing authority checks.
- Fixture tests, typecheck/build/full tests recorded accurately; independent focused review plus fresh whole-checkout review remain distinct.

## Plan / delegation
1. Extract workflow catalog (delegated isolated module).
2. Integrate discovery/loading, prerequisites and shared tool-event contract.
3. Add fixtures and migrate existing mock-provider workflows; delegate independent regression review.
4. Record checks and limitations; preserve unrelated task067 changes.

## Status
Implemented with independent scoped corrective review complete; full-suite and whole-checkout review remain incomplete. No paid inference or commit. [Runtime guide](../product-agent-skills.md).

GitNexus ProviderModel impact MEDIUM (server creation/chat/runtime imports); turn impact LOW but lower-bound with dropped receiver call sites, confirmed via source. Extracted constants UNKNOWN (confirmed provider uses). Shared canonicalModelChatEvent LOW, affects browser event validator/stream. Final client stream impact LOW through ModelChatController.send; limit constant UNKNOWN verified by source usages. No UI rendering/layout change.

## Completed criteria and corrections
- Nine stable capability-filtered runtime skills, explicit list/load, dependency loading and effective-request inspection implemented. Bound workflow tools require instructions in an earlier provider request. Same-response load, historical readiness and unavailable capabilities cannot authorize execution.
- Core authority/frame/untrusted-input/evidence rules and individual human approval remain always on. Independent review restored the always-on utility-box assessment/current-turn assessmentId/no-generic-CAD-bypass guard.
- Provisional scan → targeted actual capture → model-selected count/subset/order/rationale → finalization preserved. No-image results remain provisional.
- Independent review corrected discovery overhead: separate 16-call skill and workflow budgets, 33 provider rounds, matching browser/server guards. New stream fixture accepts 32 combined events/33 rounds and independently rejects each overflow.
- Existing mock-provider fixtures explicitly load skills; negative malformed-input cases now have independent fixtures and cleanup to avoid EOF-versus-admission-cleanup races. Assertions and negative cases retained, no retries or sleeps. Followup independent reviews found no remaining scoped issues (runtime guard fixes, client budget fix and fixture isolation).

## Verification / evidence
All logs below are OS-temp artifacts, not committed fixtures. No real-provider judgement/adherence claim.

| Command / check | Result / evidence |
| --- | --- |
| `pnpm typecheck` | Pass, including server tsc and Svelte 0 errors/warnings; `/tmp/task068-typecheck-completion.log` |
| `pnpm build` | Pass; existing bundle-size warning; `/tmp/task068-build-final.log` |
| `node --import tsx --test tests/product-agent-skills.test.ts tests/candidate-assessment-prompt.test.ts tests/model-agent-runtime.test.ts` | 40/40; `/tmp/task068-runtime-completion.log` |
| `node --import tsx --test tests/model-chat-client.test.ts tests/model-request-inspection-client.test.ts` | 124/125; sole known inspector UI source assertion; `/tmp/task068-followup-client-review-tests.log` |
| `node --import tsx --test tests/area-candidate-tools.test.ts tests/placement-search-tools.test.ts` | 44/44, independently repeated; `/tmp/task068-final-review-focused.log` |
| `node --import tsx --test tests/*.test.ts` | Final two post-isolation runs 1179/1182 and 1178/1182; `/tmp/task068-full-isolated.log`, `/tmp/task068-full-isolated-recheck.log`. NOT green. |
| `git diff --check` | Pass |
| LSP diagnostics | Changed client/tests clean. Workspace cache retains six unrelated area-candidate-judgement errors despite clean CLI typecheck, plus hints; not reported as workspace-clean. |

Full-suite failures: two known source-UI assertions (`inspector UI...`, `chat-first UI...`); both post-isolation runs also failed unchanged semantic-storage `cancellation at build/wait/read/check...` staging-list check; last run additionally failed unchanged placement-client `client accepts bounded additive placement tool events...` undefined-snapshot rejection. These remain unresolved, not certified baseline-only. Target malformed-settings/allowlist tests passed both full runs. Earlier intermittent429 in those tests was consistent with server admission still active during asynchronous post-EOF binding cleanup; fixtures were isolated without changing production cleanup.

### Browser protocol
Delegated temporary mock-provider harness `/tmp/task068-browser-harness/smoke.mjs` exercised production runtime/validators via current Vite source, explicit list/load in earlier rounds, real scan/capture and mocked model finalization:
- `node --import tsx /tmp/task068-browser-harness/smoke.mjs /tmp/task068-browser-final`
- `AREA_CANDIDATE_COUNT=3 node --import tsx /tmp/task068-browser-harness/smoke.mjs /tmp/task068-browser-count3`

Both passed desktop1440×900/mobile390×844, 5/3-point pools, exact delivered-image SHA256, subset/reorder to C1/C2, capture-unavailable provisional behavior, preserved camera/authority and no console errors. Artifacts contain reports, tool results and screenshots. These runs preceded the final client counter correction and did not exceed16 combined calls; that correction has independent stream fixtures, not a successful new browser run. Parent rerun `/tmp/task068-browser-completion` was blocked before checks by Chrome ProcessSingleton/socket-directory permission errors; `/tmp/task068-browser-completion.log`. No built-bundle or manual visual-review claim. No paid inference.

### Graph and review limits
Graph refreshed with PDG during independent review. `node .gitnexus/run.cjs detect-changes --scope all --repo .` reported critical broad impact (22 tracked files/119 symbols/75 flows at that checkpoint), abbreviated output `/tmp/task068-graph-final.log`; aggregate/limited graph output is not a clean gate or task-only certification. Final rerun after documentation/isolation reports24 files/131 symbols/75 flows, critical, still abbreviated: `/tmp/task068-graph-completion.log`. This is not clean graph certification. No commit attempted. Preserve unrelated task067 authority-transport changes and prior developer-skill docs.

## Remaining / next action
Fresh-session whole-checkout review is pending. Investigate full-suite storage/placement-client races separately without weakening checks; rerun final-source browser smoke where Chrome can launch. Live-model skill selection/judgement quality and production Toronto completeness remain untested. Redacted handoff: `/tmp/task068-product-agent-skills-handoff.md`; suggested skills: gitnexus-review, browser-policy, harness-evaluation, handoff.
