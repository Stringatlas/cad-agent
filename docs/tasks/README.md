# Tasks

Use [TEMPLATE.md](TEMPLATE.md) for bounded work with testable acceptance criteria. Read the task and relevant source before editing. Consult [architecture](../architecture.md) before changing boundaries and [coordinate conventions](../decisions/001-coordinate-conventions.md) for spatial work.

## Index

Latest: [035 — Chat-first conversation and scene-native point review](035-chat-point-move-review.md) — implemented;695/695 tests and browser checks pass; fresh-session review pending.

| Task | Status |
| --- | --- |
| [035 — Chat-first conversation and scene-native point review](035-chat-point-move-review.md) | Implemented;695/695 tests, typechecks/build, five two-point browser and six native-CAD regression groups pass. Safe Markdown, per-point verified destinations and individual scene Confirm/Reject. Fresh-session review pending. |
| [034 — Toronto point edits and real CAD solids](034-toronto-cad-workspace.md) | Implemented;677/677 tests, typecheck/build and six actual-kernel fixture browser groups pass. Volatile Toronto solids/point proposals; live-provider/production-scale and fresh-session review pending. |
| [001 — Project foundation](001-project-foundation.md) | Ready for fresh review; baseline and browser smoke passed. |
| [002 — Toronto3D preprocessing](002-toronto3d-preprocessing.md) | Ready for fresh review; all 78,320,210 points validated, no runtime changes. |
| [003 — Web preview with independent LOD](003-web-preview-lod.md) | Implemented; browser verification blocked; fresh review pending. |
| [004 — Full-resolution display box](004-full-resolution-box.md) | Historical bounded implementation; total crop caps superseded by task005; browser/fresh review pending. |
| [005 — Uncapped projected-window display](005-projected-full-resolution.md) | Resolved / complete; independent bounded feedback/stream-interaction review completed, resource-failure gesture bypass fixed; 33/33 tests pass. User browser correctness/performance confirmation accepted; automated Chrome unavailable. Review-owned guard spot-check pending. |
| [006 — Headless closest Pole-labelled point](006-closest-pole-headless.md) | Implemented/verified; 43/43 baseline tests and actual-data region query/oracle pass. Fresh-session review pending; graph analysis unavailable. |
| [007 — Closest pole tab](007-closest-pole-ui.md) | Implemented; historical exhaustive HTTP evidence retained; interactive backend superseded by task008. Browser/fresh-session UI review pending. |
| [008 — Interactive closest-Pole performance](008-closest-pole-performance.md) | Implemented; exact indexed HTTP/client47–54ms warm,291ms persisted startup;61/61 baseline and rendered Chrome checks pass (117–149ms instrumented UI completion). Fresh-session review pending. |
| [009 — Closest semantic label and Shift window](009-closest-label-window.md) | Implemented;78/78 historical baseline and nine actual-data Chrome checks pass. Performance fallback superseded by task010. Fresh-session review pending; graph unavailable. |
| [010 — Bounded all-label closest-point index](010-all-label-disk-index.md) | Implemented;92/92 baseline, ten actual-data Chrome checks and all-nine-label production HTTP completion pass. Warm p95 Ground909ms/Building159ms/Pole42ms; cold preparation/startup separate. Fresh-session review pending; graph unavailable. |
| [011 — Versioned read-only tools and replayable evidence](011-tool-protocol-evidence.md) | Implemented; 115/115 baseline + 23/23 targeted pass. Independent corrective rereview has no remaining findings; conditionally ready. Final isolated runtime/dependency review passes; full graph completion unresolved; items2–7 queued. |
| [012 — Shared-project read-only chat](012-shared-project-chat.md) | Implemented and independently reviewed;123/123 baseline, ten chat and ten all-label/window browser checks pass; demo regression passes. Full graph certification and parent cached-LSP discrepancy remain unresolved. |
| [013 — Real CAD engine and basic sandbox tools](013-cad-engine.md) | Implemented and fresh-source reviewed;138/138 baseline and independent HTTP/kernel/failure probes pass. Ephemeral sandbox only, no project edits/UI integration; graph coverage and parent stale-LSP cache remain incomplete. |
| [014 — Local project sessions and scene context](014-project-sessions.md) | Implemented;163/163 final baseline,15 interactive browser checks and preserved regressions pass. Fresh independent backend/UI corrective rereviews complete; graph/cached-LSP certification unresolved. |
| [015 — Exact approved box parameters and undo](015-approved-box-edits.md) | Implemented and independently corrective-reviewed; exact approval/atomic edit/monotonic undo/render-loss browser evidence passes. Non-CAD, no model/channel; tooling limits remain. |
| [016 — Local ChatGPT/API-key authentication](016-provider-auth.md) | Implemented and independently corrective-reviewed;225/225 baseline,62/62 auth tests and safely intercepted fake-provider browser checks pass. Live auth/inference and whole-checkout graph/fresh review remain pending. |
| [017 — Demo-oriented scene/chat UI](017-demo-workspace-ui.md) | Implemented and independently source/corrective-reviewed;230/230 baseline,14 workspace/8 demo/10 chat/15 interactive browser groups pass. Legacy Toronto post-release exact-camera smoke still fails at binary64 normalization; graph/whole-checkout certification pending. Local draft only, no model. |

| [018 — Workspace provider account control](018-workspace-provider-account.md) | Implemented and independently bounded-reviewed;253/253 baseline,23/23 focused,15 account browser and14 workspace regression groups pass. Live auth/inference, actual popup click and whole-checkout graph/fresh review remain unverified. |
| [019 — Provider-backed scene chat](019-model-chat-loop.md) | Implemented;391/391 baseline,161 focused tests and16 guarded fake-provider browser checks pass. Independent corrective review has no remaining findings; live inference, complete graph certification and whole-checkout fresh review remain pending. Read-only scene tool only, no model CAD/mutations. |

| [020 — Redacted provider protocol diagnostics](020-model-protocol-diagnostics.md) | Implemented;397/397 baseline and83 focused fake-provider tests pass, independent bounded review READY. Fixed backend tags and refusal-delta fix; live root cause/compatibility, complete graph and whole-checkout fresh-session review remain pending. |

| [032 — Scene-first workspace](032-scene-first-workspace.md) | Implemented;641/641 tests, typechecks/build, ten isolated browser groups and actual-data desktop/mobile visual checks pass. Full-height scene/sidebar, mobile chat drawer, closed tools; fresh-session review pending. |
| [031 — Verified query selection and approved point moves](031-verified-point-overrides.md) | Implemented;641/641 tests, typechecks/build and isolated built-browser query/select/approve/Undo pass. Independent bounded review found no blockers; whole-checkout fresh review, production-scale/live-model checks and graph certification remain pending. |
| [030 — Chat camera and compressed crop](030-chat-screenshot-crop.md) | Implemented;607/607 baseline and36 guarded browser checks pass. Independent corrective sign-off READY; whole-checkout review separate. |
| [029 — Catalog-listed image inputs](029-catalog-model-image-input.md) | Implemented;596/596 baseline and72 guarded fixture browser checks pass; fresh independent review pending. Removes inferred model-name capability gate, preserves catalog admission and explicit provider errors. |
| [028 — Model screenshot and pixel grounding](028-model-visual-grounding.md) | Implemented and independently incremental-reviewed;595/595 baseline and64 isolated fixture browser checks pass. Opt-in image inputs/read-only pixel tool only; no live-provider compatibility or whole-checkout review claim. |
| [027 — Fixed-view visual observations](027-visual-observations.md) | Implemented and independently corrective-reviewed;569/569 baseline and110 isolated fixture browser checks pass. Local capture/grounding only; no provider image transport. Whole-checkout review and complete graph certification remain pending. |

Approved remaining product TODOs: [queue](../TODO.md), [full roadmap](../plans/2026-10-13-harness-must-haves.md). Provider visual integration, item3 evaluation, broader item4 verified-tool orchestration and project-integrated item7 remain unassigned. Tasks014/015 implement the authorized bounded items5–6; task013 independently implements the CAD sandbox foundation.

## Workflow

1. State scope, exclusions and acceptance criteria before implementation.
2. Preserve unrelated changes; make reversible changes inside that scope.
3. Update progress at meaningful checkpoints. Separate implementation availability from verified behavior.
4. Record exact commands, results, warnings, failures and diagnostic artifact paths. Mark unrun checks as pending or blocked, never passing.
5. Inspect the actual diff, then review in a fresh session against the task. Do not equate implementation with review.
6. Record remaining failures and a single bounded next action before handoff.

Foundation and preprocessing fresh reviews remain pending. At the user's request, task 003 proceeds independently with a web preview and separate display/harness LOD; it does not constitute approval of earlier tasks. Revision-checked box edits are now separately implemented/reviewed in tasks014/015; they do not approve earlier tasks.
