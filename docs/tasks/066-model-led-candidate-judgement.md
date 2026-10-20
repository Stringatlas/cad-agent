# Task066 — model-led candidate judgement

## Request and acceptance

User: fix the incomplete semantic cache and **have the model do the judgement**, using useful actual visual + spatial evidence, not a paraphrase of a numeric shortlist. C1–Cn count/order must come from the model/evidence, not a fixed five. Never bypass per-change human approval.

- [x] Numerical scan is labeled provisional and retained as a turn-local evidence pool.
- [x] Explicit model finalization chooses an ordered subset of retained IDs and supplies rationale + uncertainty per point; final scene count/order follows that selection.
- [x] Receipt requires same scan/turn, delivered image in an earlier provider request round, matching source/frame, targeted camera, visible candidate projection and nearby displayed source samples. Missing/unrelated/pins-only/cropped-away context cannot grant an assessed receipt.
- [x] Invented/duplicate IDs, missing reasons, wrong scan/receipt, premature same-response finalization and stale original-source authority fail closed.
- [x] No image leaves provisional results visible with honest unavailable/pending copy, not claimed visual assessment.
- [x] Existing source-only, AOI/revision/client cancellation and human-approval boundaries preserved; no geometry mutation.
- [x] Independent focused code review and desktop/mobile mocked-provider browser checks complete; cache lookup finding corrected and independently rechecked. Whole-checkout fresh-session review remains pending.
- [ ] No paid/live-provider inference authorized or performed; live model adherence unverified.

Cache work is separate: see `docs/task066-cache-evidence.md`. This implementation does not edit the semantic disk index or its cache tests.

## Bounded design / APIs

`AreaCandidateJudgement` (`apps/server/src/area-candidate-judgement.ts`) holds only the latest scan and capture receipt in one `ProviderModel.turn`. Scans return `result.assessment: {kind:'provisional',scanId}` and a `candidateAssessmentCapture` explicit RGB camera. Numerical engine unchanged; its capped pool is evidence generation, not final judgement. The model can request up to20 alternatives, then select fewer/reorder them according to intent and evidence.

After the provisional tool event reaches the viewer, the model calls existing `scene.capture_scene` with that exact camera. A temporary plan camera targets the evidence pool rather than the user's potentially unrelated orbit focus. All source geometry/overlays actually rendered are captured; live camera and color mode are restored. Toronto capture metadata reports per-ID nearby (8m XY/15m Z) source samples projected inside the captured viewport, bounded to approximately100k displayed source samples, plus stride/scope. Pins do not count as source context. A receipt requires at least3 such samples for each selected candidate and projected candidate positions inside the image. This is a minimal context-availability check, not visual completeness, clearance or image-quality certification. Additional views may inform the model, but the final receipt comes from the targeted plan view.

The capture is appended as an actual `input_image` before the next provider request. Its tool output supplies `candidateCaptureId`; only a later response can use it. `scene.finalize_area_candidates({scanId,captureId,selections:[{candidateId,rationale,uncertainty}]})` accepts retained, unique, visually supported IDs in explicit preference order. Text is nonempty/control-free and ≤400 characters per field; total count remains ≤20/pool cap. It copies retained numerical evidence/coordinates, changes rank/order/subset and adds `assessment:{kind:'model-assessed',scanId,captureId,imageSha256}`. Finalization never creates scene authority or CAD.

`BoundModelScene.checkAreaCandidates` independently rechecks source freshness, point/CAD sessions/revisions and accepted **and pending** original-source restrictions before capture receipt and final publication. Existing browser generation/exact AOI/live authority checks suppress stale display; finalization events use the same awaited callback as provisional scans. An initial user image or historical conversation image cannot grant a finalization receipt.

UI: compact contextual heading **Provisional locations** / **Model-assessed locations**, short model rationale, uncertainty under Scan evidence; existing scene markers relabel C1–Cn using final ranks. Legacy engine consumers without assessment metadata remain provisional.

## Verification

- Final `pnpm typecheck` passed (Svelte0 errors/0 warnings), `/tmp/task066-typecheck.log`.
- `pnpm build` passed; existing >500kB bundle advisory, `/tmp/task066-build.log`.
- `pnpm exec tsx --test tests/area-candidate-*.test.ts tests/model-capture-*.test.ts tests/provider-model.test.ts tests/*prompt*.test.ts`: **222/222 passed**, `/tmp/task066-focused-final.log`.
- `pnpm test`: **1125/1127 passed**, same2 previously documented unrelated UI-copy failures (`model-request-inspection-client.test.ts` missing `inspection.source === 'client'` source text; `safe-markdown.test.ts` missing credential-exclusion copy), `/tmp/task066-full-tests.log`. No acceptance checks weakened.
- `git diff --check` passed; shared-file diff inspection artifact `/tmp/task066-shared-files-review.diff` includes preserved prior task changes.
- `pnpm exec tsx --test tests/area-candidate-*.test.ts tests/model-capture-*.test.ts tests/provider-model.test.ts`: **216/216 passed**, `/tmp/task066-focused.log` (the shell's subsequent no-match `rg 'not ok'` exited1; the test command itself passed).
- New tests `tests/area-candidate-judgement.test.ts`: subset/reorder/count/rationale validation; invented/duplicate/wrong scan/receipt/no image/premature finalization; unrelated/cropped/missing source context; mocked provider scan→actual image bytes in next request→model finalization; unavailable provisional and stale guard failure.
- `tests/area-candidate-tools.test.ts`: real authority pending point/CAD proposals after scanning invalidate judgement even without revision advance.
- LSP clean for changed TypeScript except pre-existing unused `MODEL_VISUAL_LIMITS` hint in provider; Svelte verified through CLI.

GitNexus impacts: bindModelScene LOW (runtime rebind/model-chat routes); canonicalModelChatEvent/validateModelEvent/createVisualCapture LOW (stream/capture flows). New candidate symbols and Svelte/plain-property viewer callers UNKNOWN: verified actual source imports/callbacks in Toronto, client and tests. Index remains2 commits stale; prior refresh EPERM registry guard is unresolved and was not bypassed. Final `detect_changes(scope:all)` returned whole-dirty-tree critical aggregate risk (117 changed/80 affected symbols across19 tracked files) with tool output truncation; this mixes prior task/cache changes and stale symbol ranges, omits newer untracked sources, and is not a clean check or commit gate. This is not clean graph certification. No commits; preserve prior dirty task063–065/cache/user changes. Production listeners and orphan fixture untouched.

## Parent final verification

- `pnpm build` pass, `/tmp/task066-parent-build.log` (existing bundle-size advisory).
- `pnpm typecheck` pass, `/tmp/task066-parent-typecheck.log`.
- Combined cache/query/candidate/capture/provider tests **270/270 pass**, `/tmp/task066-parent-focused.log`.
- Parent `pnpm test` launcher blocked by `EPERM` binding tsx IPC socket, `/tmp/task066-parent-full-tests.log`. Equivalent `node --import tsx --test tests/*.test.ts`: **1126/1128 pass**, same two prior UI source-copy assertions, `/tmp/task066-parent-full-direct.log`. Neither is claimed as full passing verification.
- Final `git diff --check` pass. Parent read full browser script and inspected cache/client/protocol changes; independent focused review and browser evidence above are separate from whole-checkout review.
- Graph change-analysis rerun still reports whole-dirty-tree critical aggregate117 changed/80 affected symbols/19 tracked files; stale index/truncated coverage remains unresolved, not a clean gate. No commits.

## Limits / next action

Model-assessed means model-authored visual+spatial judgement, **not** independently verified suitability, clearance, safety, standards or regulatory compliance. Receipt validation proves delivery and minimum rendered context, not that model reasoning is correct. Displayed source context can be sparse/occluded; the model must disclose uncertainty or leave results provisional. Numerical pool generation is bounded and can omit potentially better alternatives; no new semantic segmentation/learned site classifier is implied. At least one selected point is required to finalize; if none are suitable, report no recommendation and keep the numerical pool explicitly provisional.

Targeted mocked-provider browser flow passed desktop/mobile for five- and three-point pools, final subset/reorder, viewport preservation, rationale/uncertainty and unavailable-image provisional fallback. Evidence: `docs/task066-browser-evidence.md`, `/tmp/task066-browser-final/report.json`, `/tmp/task066-browser-count3/report.json`. Independent focused source review found one cache-generation discovery defect, now corrected and independently rechecked with14/14 cache tests. Parent combined focused regressions270/270 and typecheck pass (`/tmp/task066-parent-focused.log`, `/tmp/task066-parent-typecheck.log`). Parent actual-source fresh-cache build/1ha scan passed, but write access to the app's affected OS-temp location is EPERM-blocked; see cache evidence before claiming runtime repair. Whole-checkout fresh-session review and live-provider judgement quality remain pending.
