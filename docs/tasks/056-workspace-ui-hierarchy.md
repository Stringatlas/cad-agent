# Task056 — Workspace UI hierarchy

## Assignment / scope
Implement the UI overhaul requested in `/tmp/spatial-cad-ui-ux-overhaul-handoff.md`: restrained CAD-first hierarchy, contextual controls and fewer redundant interactions. Presentation only; preserve existing authority/controller lifetimes, exact references, per-change approval, recovery, Undo, accessibility and task055 rollback. No commit.

## Audit and bounded design
- Keep scene + optional chat, pending-change review and semantic selection identity primary.
- Consolidate the three equal-weight source tabs into one labeled workspace selector; Toronto remains default, synthetic/nearest fixtures stay available. Synthetic persistence appears only in its workspace.
- Remove repeated Toronto scene title; retain street focus, color choice and labeled key.
- Put model selection directly in the chat header (one action, not settings then select). Session/context/effective request evidence stay disclosed. Surface unavailable catalog recovery outside collapsed settings.
- Remove the empty derived-hierarchy placeholder (no implemented capability). Show selected datum actions without opening the hierarchy; keep coordinate/provenance details disclosed. Retain authored/source lists, visibility and manual creation/Undo.
- Keep reference types discoverable; suppress idle zero-reference counter and technical capacity from the summary. Keep diagnostic tools accessible with quiet hierarchy.
- Do not build a new inspector framework, implement renderer/backend changes, or remove approval/help/evidence capabilities.

## Acceptance
- [x] Direct model selection and visible unavailable-catalog recovery; no duplicate model selector.
- [x] Workspace selection preserves all three modes; fixture persistence is contextual.
- [x] Datum Focus/Clear/Details available directly on selection; no duplicate selected-datum section or unimplemented derived placeholder.
- [x] Scene, selection types, per-change approval, reference removal, visibility, Undo and diagnostic/request inspection remain available (source/structural checks; interaction acceptance still pending).
- [x] Svelte accessibility compilation, focused regressions, typecheck/build and actual diff checked; baseline failure explicitly retained below.
- [ ] Desktop/mobile idle/selected/pending/error visual inspection recorded honestly; fresh-session review pending.

## Verification / status
Implemented; **fresh-session review and visual acceptance pending**, not certified complete. Browser is disconnected in this child; user requested no browser testing, but standing repository instructions still require visual inspection. Browser skill read; no browser tools are exposed and `/tmp/pi-browser-daemon.sock` is absent (`test -S` exit1). No browser invocation or screenshots claimed. No delegated work: this is a focused child and cannot spawn.

### Exact checks (Node22.23.3 / pnpm10.34.6)
- `pnpm typecheck` — exit0, Svelte0 errors/0 warnings; `/tmp/task056-typecheck.log`.
- `pnpm build` — exit0; `/tmp/task056-build.log`. Existing Vite bundle-size advisory remains.
- `pnpm exec tsx --test tests/workspace-ui-hierarchy.test.ts tests/scene-object-ui.test.ts tests/approval-review-ui.test.ts tests/model-chat-ui-context.test.ts tests/agent-ui-integration.test.ts tests/provider-account.test.ts tests/historical-screenshot-wiring.test.ts` — **57/58 pass**, one baseline failure; `/tmp/task056-focused-tests.log`. Includes six actual component compiler/accessibility checks and parsed-template structure checks, not screenshots.
- Baseline confirmation: copied the pre-task model-chat UI test into `tests/.task056-baseline-model-chat-ui-context.test.ts`, ran `pnpm exec tsx --test --test-name-pattern='scene/selection/session/revision' tests/.task056-baseline-model-chat-ui-context.test.ts`, removed that temporary copy — same failure, exit1; `/tmp/task056-baseline-history.log`. The test expects `historyNotice` after reference changes; task051's current runtime returns undefined. No runtime/history assertion change made. This task only adjusts its separate reference-disclosure height assertion from20% to30% to match the deliberate layout change.
- Initial account-copy test regression corrected by preserving the truthful provider-readiness caveat in disclosed Account content. No account test was relaxed.
- LSP invoked after every edit: no Svelte/Markdown server configured; edited/new TS tests report no diagnostics. `svelte-check` is the actual component diagnostic evidence.
- `git diff --check` — exit0. Actual task delta inspected against pre-edit snapshots, `/tmp/task056-ui.diff`; no backend/controller/renderer algorithm or sandbox edits. Full suite not run.
- `gitnexus_detect_changes({scope:'all',repo:'cad-agent'})` plus `node .gitnexus/run.cjs detect-changes --scope all --repo .` — global pre-existing dirty checkout reports **critical**,76 files/786 symbols/179 flows. CLI exit0 output `/tmp/task056-graph-all.log` elides long symbol/flow lists; not a clean global certification or task-only attribution. No commit requested or created.

### Files / next action
Presentation: `apps/web/src/{App,Chat,ModelChat,Toronto,SceneObjects,ProviderAccount}.svelte`. Tests: new `tests/workspace-ui-hierarchy.test.ts`; updated `tests/scene-object-ui.test.ts` removes the assertion advertising the unimplemented Derived placeholder and now requires directly available selected actions; `tests/model-chat-ui-context.test.ts` changes only layout height. This task and index document status. Unrelated dirty task047–055 work retained.

Next: fresh-session regression review of the task-only delta, then desktop/mobile idle/selected/pending/error visual acceptance when browser access is available. Specifically check compact header fit, selected datum vs hierarchy/review overlap, touch targets and chat/approval layering. Task055 rendering rollback remains untouched.

## Pre-edit graph evidence
Bound `cad-agent` (indexed 2026-10-19 05:11Z, source is dirty). Concept query returned model/runtime and UI tests; file impacts: Toronto LOW (documentation imports, no resolved processes), App/Chat/ModelChat/SceneObjects UNKNOWN. UNKNOWN resolved only for edit scoping by checking actual Svelte imports: main→App→Toronto/Chat→SceneObjects/ModelChat. Graph cannot certify Svelte event/template flow; presentation changes are verified against source and regression checks. No authority function edits planned.
