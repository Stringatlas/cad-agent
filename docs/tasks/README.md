# Tasks

Use [TEMPLATE.md](TEMPLATE.md) for bounded work with testable acceptance criteria. Read the task and relevant source before editing. Consult [architecture](../architecture.md) before changing boundaries and [coordinate conventions](../decisions/001-coordinate-conventions.md) for spatial work.

## Index

| Task | Status |
| --- | --- |
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

## Workflow

1. State scope, exclusions and acceptance criteria before implementation.
2. Preserve unrelated changes; make reversible changes inside that scope.
3. Update progress at meaningful checkpoints. Separate implementation availability from verified behavior.
4. Record exact commands, results, warnings, failures and diagnostic artifact paths. Mark unrun checks as pending or blocked, never passing.
5. Inspect the actual diff, then review in a fresh session against the task. Do not equate implementation with review.
6. Record remaining failures and a single bounded next action before handoff.

Foundation and preprocessing fresh reviews remain pending. At the user's request, task 003 proceeds independently with a web preview and separate display/harness LOD; it does not constitute approval of earlier tasks. Revision-checked box edits remain a later candidate outside this scope.
