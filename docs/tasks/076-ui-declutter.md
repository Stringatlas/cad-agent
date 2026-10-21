# Task076 — Delete scene UI clutter

## Scope and acceptance
User explicitly requests deletion, not relocation into more Details panels: annotation diagnostic copy/XYZ/observation IDs and every Scene tools section except Display quality. Keep the point-type key readable without overlapping controls. No Tailwind dependency needed. Preserve agent capabilities, selection, individual human approval, and actionable recovery. Dataset/agent-prompt changes occurring concurrently are outside this task.

## Implemented
- Deleted Scene tools wrapper, manual CAD/point tools, navigation narration, manual crop controls, harness observation/export, visual observation test panel, dataset diagnostic copy, and manual equipment-placement UI.
- Kept Display quality directly in the wrapping scene toolbar. Native named disclosures make it mutually exclusive with the point-type key; popovers anchor to the toolbar, fit narrow screens, and render above the Scene navigator.
- Deleted annotation detail disclosure (coordinates, observation UUIDs, boilerplate). Kept contextual hypothesis rationale/uncertainty and scene focus.
- PointEdits retains one authority/controller, review items and recovery; removed manual-query/translation UI and exclusive helpers. Removed unused automatic harness-observation fetch/export.
- Updated focused structural regression tests; did not relax unrelated attachment-safety assertions.

## Verification
- `pnpm build`: pass; `/tmp/task075-build.log`.
- `pnpm typecheck`: pass, web zero errors/warnings; `/tmp/task075-typecheck.log`.
- `node --import tsx --test tests/approval-review-ui.test.ts tests/area-candidate-ui.test.ts`: 8/8 pass; `/tmp/task075-targeted.log`.
- Three focused UI files: 22/23 pass; sole failure is untouched ModelChat source expectation for removeAttachment on model changes. `/tmp/declutter-focused-review-tests.log`.
- `node --import tsx --test tests/*.test.ts`: 1158 pass, 14 fail (1172 total), unresolved; `/tmp/task075-full-tests-final.log`. Failures include legacy placement/model workflows, inspector/chat source assertions and spatial-index cancellation. Not a full regression pass.
- `pnpm exec tsx --test …` launcher blocked by IPC EPERM; node --import tsx alternative runs tests without changing assertions.
- `git diff --check`: pass. Reviewed task-scoped diff.
- Svelte LSP unavailable; CLI Svelte/TS checks above used instead.

## Browser and review
Managed headless browser at localhost:5173 displayed loaded Toronto scene. Inspected desktop 1440x900, mobile 390x844 and narrow 320x740. Account/model connection unavailable (visible recovery retained); no paid inference. Tested key/quality mutual exclusion and panel bounds: narrow quality left35/right307, key left13/right253 with hit-tested unobscured key. No selected/pending approval runtime exercise; source regression coverage only for these states.
Screenshots: `/tmp/task075-desktop-idle.png`, `/tmp/task075-desktop-key.png`, `/tmp/task075-mobile-key.png`, `/tmp/task075-mobile-quality.png`, `/tmp/task075-mobile320-quality.png`.
Independent focused child review found narrow-mobile popover clipping; corrected anchoring and rechecked narrow viewport. No approval/recovery regression found. Fresh-session whole-checkout review remains pending.

GitNexus cad-agent bound to this checkout: index two commits behind HEAD. Toronto File impact LOW but incomplete Svelte caller coverage; SceneMarks/PointEdits and removed helpers UNKNOWN, source callers verified. detect_changes(all) reports CRITICAL across mixed checkout, stale graph and output cap; not clean coverage or approval to commit. No commit. Many historical browser scripts depend on deliberately deleted manual tools; they were not run or rewritten in this bounded task.
