# Task064 — connected scan-grounded placement slice

## Superseded scope correction
User rejected this small-area/manual box-first slice as fulfillment of their actual request. It remains equipment-fit groundwork only. [Task065](065-large-area-candidate-points.md) implements the corrected primary workflow: model-driven LARGE-area search with ranked candidate POINTS, no box prerequisite, CAD only downstream on explicit request.

## Authorization / scope
User superseded item-1-only authorization: continue the checklist until a user-facing feature can be tested, then provide testing instructions. Implement the smallest connected cardinal-yaw AOI → deterministic ranked shortlist → visible comparison → exact chosen native proposal → individual approval/Undo slice, plus shared product-agent orchestration. No paid/live inference. Existing task044 remains compatible; no effective-edited-scene certification or automatic acceptance.

Acceptance for this slice:
- Explicit user-editable/disclosed settings, fully bound runtime specification; complete relevant source queries rather than capped AOI witnesses as domain.
- Deterministic cardinal lattice search/ranking, hard rejection and missing-ground handling, retained exact evidence, budgets/cancellation and stale invalidation.
- Numbered non-authoritative scene alternatives/access regions, chosen exact native proposal only, existing independent human review and Undo.
- Shared agent tools/fake-provider tests; current-view capture can show numbered alternatives, numerical/qualitative distinction retained.
- Desktop/mobile real pointer flow and actual prepared-data smoke; truthful limits and how-to-test.

## Implementation
- `apps/server/src/placement-search.ts`: reusable prepared index/ground surface per search; AOI-local XY lattice, cardinal 0/90/180/270 fronts, exact cardinal body/access volumes. Ground center/four corners yield LS plane slope and height range; unsupported samples reject. Exhaustive point counts/support bands and capped witnesses; complete original Pole-point horizontal distance reduction. Lexicographic declared metrics/ties + greedy center diversity. Fail-closed resource/data/abort outcomes expose no usable partial candidates.
- `placement-search-session.ts` / `placement-search-routes.ts`: strict loopback bounded HTTP, one retained latest search (5 min), current source/terrain/point/CAD bindings; native-compatible dimensions/coordinates. Chosen retained ID is re-evaluated and exact deterministic evidence compared excluding wall-clock stats. Independent approval preconditions outlive request/turn/session.
- Additive synchronous composition-only `assertOriginalBinding` on point/CAD authorities closes cross-authority snapshot races immediately before retention/return; approval ends with a synchronous point guard under CAD admission. Existing asynchronous source/native validation is not replaced.
- `PlacementSearch.svelte`, client/renderer, Toronto/viewer wiring: contextual collapsed disclosure, editable illustrative settings, numbered cyan previews and access outlines, selection/focus/evidence, one proposal to existing review. AOI/authority/pending changes invalidate; model streaming blocks human actions without erasing tool previews. Mobile bounded panel and automatically visible errors.
- Provider `scene.search_placement_sites({settings})` binds active AOI; `scene.propose_placement_site({searchId,candidateId})` uses same retained session as HTTP/UI and existing approval pause. Strict protocol/client allowlists and async callback await ensure previews settle before subsequent capture. No model approval tool. Product instructions distinguish disclosed assumptions, measurements and qualitative observations.
- Current scene captures include numbered rendered previews; RGB/type paths remain existing capabilities. **No dedicated top-down capture, retained-ID image annotation protocol or visual-semantic suitability certification.**

## Reviews / corrections
Independent contract review found tiny-negative yaw normalizing to 360; corrected endpoint to zero with idempotence regression. Independent server review reproduced accepted point edit during final CAD snapshot and unproposable sub-kernel dimensions; corrected and regression-tested. Follow-up reproduced symmetric CAD edit during point snapshot; additive synchronous guards cover both directions plus native final approval stale snapshots. Browser review caught mobile Scene heading intercepting Find sites and offscreen stale errors; corrected and reran pointer-only checks.

One existing source test broke because `<aside>` gained a class. `tests/approval-review-ui.test.ts` now locates an aside with optional attributes, explicitly asserts its existence and still asserts ApprovalReview precedes it. This preserves the acceptance boundary rather than deleting/weaking the assertion. The two unrelated baseline UI source-string failures remain unchanged.

## Verification
| Command/check | Result / artifact |
| --- | --- |
| `pnpm typecheck` | Pass, Svelte 0 errors/warnings; `/tmp/task064-release-typecheck.log`. |
| `pnpm build` | Pass, existing large bundle advisory; `/tmp/task064-release-build.log`. |
| `node --import tsx --test tests/approval-review-ui.test.ts tests/placement*.test.ts` | **48/48 pass**; `/tmp/task064-final-focused-rerun.log`. |
| `node --import tsx --test --test-concurrency=1 tests/*.test.ts` | **1060/1062 pass**, 2 failures; `/tmp/task064-release-tests.log`. Existing `model-request-inspection-client.test.ts` expects `inspection.source === 'client'`; `safe-markdown.test.ts` expects old credentials sentence. Both recorded before task063/064 and left untouched. Not a clean full-suite pass. |
| Agent/provider integration focused tests | **116 pass** including shared session/native ghost/accept/decline with fake provider; `/tmp/placement-agent-final-tests.log`. |
| Authority corrective regression checks | **34/34 pass** including both snapshot race directions, proposal races, independent final approval, guard states; `/tmp/task064-authority-barrier-tests.log`. |
| Callback ordering/cancel/rejection tests | Focused **26/26 pass** reported in `/tmp/placement-callback-order-child-handoff.md`; all three callback tests also pass in final full-suite log above. |
| LSP changed TypeScript files, CLI tests compiler | Scoped diagnostics clean except stale model-chat-client union cache disagrees with passing fresh CLI typecheck. No Svelte LSP; svelte-check above is current. |
| `git diff --check`, tracked diff and new-file inspection | Pass. No commit; preserve unrelated `docs/TODO.md` and concurrent model-catalog default-selection (`gpt-6-luna`) changes; the latter was observed during final diff inspection and not reverted. |
| Graph pre-edit impact | Provider/protocol high-risk gates warned by implementing agents; point/CAD authority classes MEDIUM, many new/Svelte symbols UNKNOWN and source-confirmed. Index 2 commits stale; refresh EPERM registry guard remains unresolved. |
| MCP `detect_changes(scope:all)` and CLI `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 10000` | Aggregate **CRITICAL**, tracked existing symbols across whole dirty tree; `/tmp/task064-graph-changes.txt`, `.err`. MCP/CLI formatted summaries truncate symbol/process descriptions even at limit10000; repeat did not resolve that tool limit. Stale/untracked coverage is incomplete, not graph certification. No commit. |

## Browser acceptance
Managed persistent headless browser, isolated generated fixture and backend, no production accepted edits or provider inference. Latest command:

`node --import /tmp/placement-browser-loader.mjs /tmp/placement-browser-qa-ui-fix.mjs > /tmp/placement-browser-qa-ui-fix.log 2>&1`

Passed 1280×720 and 390×844 pointer-only search, selection/focus, chosen single ghost with zero accepted bodies, Decline, desktop Accept→one body→Undo→zero, stale-terrain rejection and visible recovery; mobile review controls and no document overflow. Actual capture contains cyan boxes/numbers1–5 (`/tmp/placement-browser-qa-capture/actual-captured-scene.png`). Report/screenshots `/tmp/placement-browser-qa-ui-fix/report.json`, `03-desktop-shortlist.png`, `05-desktop-pending.png`, `08-desktop-error.png`, `10b-mobile-aoi-closed.png`, `13b-mobile-actions.png`, `14-mobile-pending.png`, `15-mobile-error.png`. Inspecting the screenshot was part of QA, not just DOM assertions.

Initial mobile run failed pointer interception; keyboard workaround was not counted as passing and latest pointer run supersedes it. Expected fixture `/auth/status` and `/chat/models`403 responses come from alternate-port5174 origin restrictions; deliberate stale propose409 also logged. No unexpected rendering exceptions reported. Existing mobile Chat overlay behavior remains; scene QA uses Chat closed. No live-model browser workflow certified.

## Actual prepared-data smoke
Read-only isolated sessions, source78,320,210 points /19,122 index pages, matching complete preprocessing13,394 ground cells/1377 instances. Three 6×6m AOIs at spacing2/four yaws, 1×1×1.2m/access1/pole2/slope5°/relief.1m:
- Local center(289,433):15.00s budget exhausted.
- Center(127,953), bounds X124–130/Y950–956: **complete10.10s**,64 generated/16 evaluated, **3 sites**; zero observed conflicts, slopes1.49–1.96°, relief.0355–.0485m, pole distances9.03–11.03m.
- Center(287,445):15.00s budget exhausted.

No accepted edits/proposals; all isolated authorities revision0. `/tmp/placement-smoke-20261019-results.json`, `.log`, reproducible temporary runner `.mts`. **Performance remains location-dependent**; no broad latency certification. Incomplete searches publish no shortlist. Repeated per-volume checks/pole-page reduction need profiling before large AOIs are dependable.

## User testing / remaining work
[Testing instructions](../placement-search.md) give startup/assets, no-model steps, optional exact agent prompt and limitations. The connected feature is testable now; roadmap checkboxes remain open for their full scope and review gates. Pending: final fresh-session integrated review, arbitrary yaw, dedicated top-down bound annotations, stronger terrain/continuous support, effective edits, broader benchmarks and authorized live-model evaluation. No completion claim for those items or whole-checkout review.

Suggested next review: actual diff/new files against this task, task044 and the plan; rerun race and browser checks without weakening acceptance. Isolated fixture PID66333 (:5174/:60303) ends with zero bodies/proposals; cleanup SIGTERM was denied EPERM, so it may remain running. No permission bypass attempted; production :5173/:3001 was not stopped. Redacted handoff: `/tmp/task064-connected-placement-handoff.md`.
