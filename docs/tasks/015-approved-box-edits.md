# Task 015 — Exact approved box parameter edits and undo

## Assignment
Second task in user-authorized next couple tasks. Implements roadmap item6 after task014 authority gate. Deterministic human-approved parameter entities, explicitly NOT verified CAD solids.

## Acceptance
- Create/update box proposal binds entity ID, operation, exact center/dimensions, expected revision, session, meters/frame and authoritative coordinates. Preview/diff does not mutate authority.
- Server-issued proposal ID/digest binds exact immutable proposal; deliberate human approval required. Stale revision/session, altered digest, unknown IDs, invalid dimensions/expired proposals cannot commit.
- Candidate checks parameters and preserves unrelated entities before single atomic publication; revision increments once. Failure leaves state unchanged; stale approvals cannot replay.
- Undo is an explicitly confirmed latest-retained revision-checked transaction advancing revision, never revision rollback. Invalidate pending previews after edit/load/undo.
- Chat-side controls/results and left scene reflect the same committed snapshot; preview, approval, parameter verification, unsaved publication and render failure remain distinct. Geometry changes never originate in render cache.
- Deterministic tests, baseline/build, browser approval/undo/render evidence, actual-diff inspection and independent fresh-source review.

## Scope/exclusions
Axis-aligned create/update boxes with explicit parameters and max32 retained proposal/history entries, 5min proposal lifetime. No CAD-solid/body claim, kernel publication, model-generated operations, free-form reconstruction/channel, general booleans, redo or arbitrary scripts. Explicit Save from task014 required for persistence.

## Completion
Implemented all bounded acceptance criteria above. Server-issued exact proposals are SHA256-bound, expire and cannot replay after publication. Box/inverse candidates check exact parameters and preserved unrelated entities before one revision increment; browser independently checks digest and entire expected commit/inverse snapshot. Native chat-side controls provide separate preview/approval/undo; disposable wireframe and named-point overlays never own geometry. Commit/unsaved/render outcomes stay distinct. [User/API guide](../project-editing.md).

Backend/front-end implementation and separate fresh-context corrective reviews are complete. No commits. User's final interactive scene-plus-agent requirement is preserved; this bounded deterministic parameter path does not implement channel/model/project CAD.

## Verification and review
Shared final commands, artifact paths and tooling caveats: [task014 verification](014-project-sessions.md#verification-and-review), run after the final frontend corrections.

- `pnpm verify`: **163/163 tests**, workspace/tests typecheck and build pass; `/tmp/spatial-interactive-final/verify.log`.
- Existing Chrome9222 interactive script: **15 checks pass**, `/tmp/spatial-interactive-final/interactive/report.json`. Exact preview/digest/no mutation; changed parameters invalidate approval; native exact approval advances once; create/update and checked inverse removal/restoration; invalid dimensions/stale/unknown approvals preserve authority; confirmed undo advances rather than rolls revision back; late/cancel/ambiguous commits block unsafe writes until Refresh; explicit Save/restart/Load; constructor failure and actual runtime WebGL loss/restoration keep authoritative commit status separate.
- Final preserved regressions: **10 shared-chat**, **10 all-label/window**, **8 demo** browser checks pass; evidence in task014. No legacy Toronto script owning user3001 run.
- Independent backend rereview `/tmp/spatial-interactive-backend-rereview/review.md`: **READY**, six adversarial checks include exact approval immutability, monotonic create/update/undo, revision-exhaustion atomicity and Load ABA late-chat/stale-CAD rejection. No remaining actionable backend finding.
- Independent frontend rereview `/tmp/spatial-interactive-ui-rereview/review.md`: **READY**,21/21 focused tests and4/4 controller probes. Exact inverse Undo rejects forged unrelated mutations; overlapping/failed same-session Refresh preserves held inverse; rotation clears it. Runtime WebGL listener cleanup/restoration independently source/evidence-reviewed and parent-browser-rerun.
- Final `git diff --check` passes. Full tracked/untracked diff inspected; fixture isolation is intentional. Graph aggregate **CRITICAL**88 mapped symbols/20 flows and incomplete coverage; cached parent LSP219 errors conflict with passing CLI checks. Not clean tooling certification. Chunk-size warning and forced-restoration Chrome/Three deletion warnings retained, not suppressed.

## Remaining limits and next action
Non-CAD axis-aligned parameter boxes only; no kernel body publication, model/provider/channel, free-form operations, redo or automatic persistence. Undo requires a held exact inverse: full page reload/unreceived commit can recover only a server pointer and safely disables Undo. Runtime render recovery is verified, not a guarantee against future GPU resource exhaustion. Sandbox CAD becomes stale after edit/Load until restart.

Focused independent reviews are complete; **final whole-checkout fresh-session review remains pending** against this task/actual diff and final docs/tooling evidence. Review before graph-certified commit or separate scope expansion; no earlier task review is implicitly approved.
