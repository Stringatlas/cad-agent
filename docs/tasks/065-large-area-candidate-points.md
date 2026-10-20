# Task065 — Model-driven large-area candidate points

## Scope / acceptance
Corrects task064's insufficient manual tiny-AOI/box-first scope. User selects a LARGE area and asks in chat for candidate locations. Model invokes a read-only area scan, receives ranked candidate POINTS with numerical evidence/limitations, and the same numbered points appear in the scene. No equipment box, CAD proposal or manual tiny-patch search prerequisite. CAD is downstream only on explicit request with existing human approval. No paid inference authorized for development.

## Completed implementation criteria
- [x] Full-source, one-pass relevant physical-page reduction, not repeated per-pose queries or capped witnesses. AOI-aligned bounded support/obstacle grid, global quantized pole reduction with conservative lower bounds, deterministic ranking and diverse shortlist up to model-requested count (1–20).
- [x] Chat `scene.scan_area_candidates({settings})` → server-bound AOI/authorities → `area-candidate-result` event → awaited viewer publication before capture. No source-point selection/CAD prerequisite or geometry mutation.
- [x] Numbered C1–Cn annotations, true-coordinate dots/leader endpoints, viewport/panel-aware label decluttering, selectable compact shortlist and disclosed evidence. Manual equipment-fit UI is secondary disclosure.
- [x] Strict schema/frame/authority validation; per-authority admission, abort/budgets/source changes fail closed; accepted and pending point/CAD edits rejected synchronously pre/post scan; stale AOI/state clears markers. No automatic authored geometry or approvals.
- [x] ≥100×100m synthetic and populated actual Toronto measurements. See [engine evidence](../area-candidate-engine-evidence.md): synthetic120k records42ms; real48.0M examined/34.1M AOI observations5.25s, five candidates. Warm cache only; cold real-data preparation unmeasured.
- [x] Mocked provider integration and desktop/mobile real-engine browser flow, capture/selection/invalidation/no-mutation assertions. No live/paid model calls.
- [ ] Whole-checkout fresh-session review (task063/064/unrelated dirty work remain distinct).

## Implementation / delegation
Parent owns shared `area-candidates.ts` contract/export, provider/model binding and protocol admission, source-only synchronous guards, integration evidence and docs. Independent engine agent owns `area-candidate-search.ts`, fixtures/tests and benchmark; UI agent owns bridge/validation/initial markers; isolated visual corrective agent owns label layout/leader tests; integration agent owns real-provider-route fixtures; independent review/corrective review agents inspect actual source. All share explicit typed APIs, no overlapping source ownership during implementation.

Core files: `apps/server/src/area-candidate-search.ts`, `model-scene.ts`, `provider-model.ts`; `packages/contracts/src/area-candidates.ts`, `model-chat.ts`; web `area-candidate-client.ts`, `area-candidate-render.ts`, `AreaCandidates.svelte` and existing chat/viewer bridge files. No new permanent diagnostic panel or automatic geometry tool.

## Review findings / corrections
Independent review reproduced early incomplete results with unavailable index hashes rejected by UI, and pending geometry escaping source-only server barriers. Fixed: unavailable hash pair permitted only for incomplete empty outcomes; additive `assertOriginalBinding(expected, true)` checks pending maps synchronously before/after scans while preserving legacy callers' default behavior. Integration regressions cover existing/mid-scan proposals, accepted edits, disposal, cancellation and admission release.

Browser review found label overlap/clipping and inherited near-white heading text. Fixed dark section text and screen-space decluttering with leaders to unchanged true candidate positions. Layout coordinate-preservation tests plus browser label rectangles/pixels and inspected desktop/mobile/current-capture screenshots verify corrections. Corrective independent review found no remaining actionable task065 issue (33 task tests +146 related regressions passed), not a whole-checkout certification.

## Verification (exact commands/results)
| Check | Result / evidence |
| --- | --- |
| `pnpm typecheck` | Pass; Svelte 0 errors/warnings; `/tmp/task065-final-typecheck.log`. |
| `pnpm build` | Pass; existing large-bundle advisory; `/tmp/task065-final-build.log`. |
| `node --import tsx --test tests/area-candidate*.test.ts tests/placement*.test.ts tests/model-candidate-prompt.test.ts` | **76/76 pass**; `/tmp/task065-final-focused.log`. |
| `node --import tsx --test --test-concurrency=1 tests/*.test.ts` | **1093/1095 pass**, same 2 prior unrelated failures; `/tmp/task065-all-tests.log`. `model-request-inspection-client.test.ts` old `source === client` expectation; `safe-markdown.test.ts` old credentials sentence. Not a clean full-suite pass. |
| `AREA_BENCH_X=250 AREA_BENCH_Y=400 pnpm exec tsx scripts/check-area-candidates.ts` | Complete synthetic/real 1ha runs, five points each; `/tmp/task065-area-candidates-populated-benchmark.jsonl`; [recorded metrics](../area-candidate-engine-evidence.md). |
| `node --import tsx scripts/browser-area-candidates-smoke.mjs /tmp/task065-browser-decluttered` | Desktop1440×900/mobile390×844 pass: real chat/engine/event/markers/capture/C3 selection/area invalidation/unchanged authorities. `/tmp/task065-browser-decluttered/report.json`, provider bodies, tool results, AX snapshots and PNGs. AOI seeded by fixture-only callback; pointer gesture not covered here. |
| Independent corrective review | 33/33 task065 +146/146 related provider/chat/AOI/runtime tests, typecheck and diff check pass; `/tmp/task065-corrective-review-handoff.md`. Reviewed saved browser evidence, did not rerun real-data benchmark. |
| LSP / diff | Changed TS diagnostics checked; fresh CLI typecheck is clean. Cached LSP has shown stale types; no Svelte LSP, svelte-check above used. `git diff --check` pass. |
| Graph | Bound `cad-agent` at this checkout; index 2 commits behind. `bindModelScene` upstream LOW (routes/rebind), `ProviderModel` MEDIUM (server/provider consumers), protocol validator LOW (stream validation). New symbols/guards UNKNOWN corroborated with source. `analyze --index-only` blocked by EPERM registry guard, `/tmp/task065-graph-analyze.log`; no bypass. Aggregate dirty tracked changes detect CRITICAL/truncated, omits new untracked modules: NOT clean certification, no commit. |

Full suite ran after functional/visual corrections and before final instruction-readback/wording-only edits; focused76/typecheck/build ran after those edits. Prior task064 evidence and unrelated TODO/model defaults remain preserved. No production listeners or operator persistence touched; no commits.

## User count correction — C1–Cn
User clarified that candidate count follows model output, not a fixed five. Added model-facing required `maxCandidates` (integer1–20 resource cap); legacy internal calls may omit it and retain default5. Engine returns up to that count, never inventing unsupported locations. UI validates against returned settings and renders dynamic ranks. Tests cover1/3/7/20, insufficient supported locations, invalid counts and real provider→client7. Browser desktop/mobile7 checked in `/tmp/task065-browser-count7/report.json`; build `/tmp/task065-count7-build.log`; typecheck `/tmp/task065-count-typecheck.log`; updated focused checks `/tmp/task065-count-final-tests.log`. Benchmark table above remains the historical five-result run, not a new fixed cardinality requirement. No full-suite rerun for this count-only follow-up; previous full-suite results remain dated to the earlier checkpoint. Fresh-session review of this follow-up remains pending.

## Remaining limits / next action
Use [testing instructions](../area-candidate-search.md). Actual source flow is benchmarked at1ha, not arbitrary city-scale or certified under all AOIs. Quantized observed-only pole/ground/obstacle screening is not exact equipment fitting or safety/continuous-support certification. No live-model adherence/cold-index timing or newly automated AOI pointer test. Whole-checkout fresh-session review remains pending; graph registry permissions require operator resolution if refreshed certification is desired.
