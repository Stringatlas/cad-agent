# 079 — Prune and organize the test suite

Status: Ready for fresh-session review

## Scope and acceptance criteria

Aggressively delete obsolete, redundant and implementation-coupled tests; organize
remaining tests by responsibility. Preserve the existing source reorganization
and DALES changes. No product behavior changes.

- [x] Delete retired model-workflow scenarios, source-text/markup assertions,
  duplicated prompt checks and excessive test matrices.
- [x] Keep meaningful active-interface, security, geometry, approval/undo,
  spatial correctness, cancellation and dataset coverage.
- [x] Group retained tests; update imports, discovery, typechecking and current commands.
- [x] Run the retained suite and typecheck; compare failures with the baseline.
- [x] Inspect the task-relative diff and save a redacted handoff.
- [ ] Fresh-session review (remains pending independently of implementation).

## Baseline and dependency analysis

Node v22.23.3, pnpm 10.34.6. `pnpm test`: 1,177 tests, 1,163 passed,
14 failed; `/tmp/test-cleanup-baseline.log`. The failures concern retired model
workflows and source/markup expectations; they are not a reason by themselves to
delete tests. Initial sandbox run failed on tsx IPC; baseline rerun with local
IPC/loopback access.

GitNexus upstream impact checked all test files, helpers, runner configuration and
the verification script with a literal test path. The shared skill-transport
helper has 11 test importers (MEDIUM); other targets are UNKNOWN, not an all-clear.
Text reference checks confirm test entrypoints are discovered by the runner,
with current documentation and one verification-script path to update. Test
files have no imported application callers. File-level graph results do not
establish process coverage. Reports: `/tmp/test-cleanup-impact.json`.

Initial working-tree snapshot: `/tmp/test-cleanup-before.json`; existing status:
`/tmp/test-cleanup-status-before.txt`. These are local diagnostic artifacts, not
content to copy into a handoff.

## Result and deletion rationale

Deleted 19 test files; moved 92 retained files (89 TypeScript, 3 Python) into ten
responsibility folders. Reduced the TypeScript suite from 1,177 to 996 cases:
181 removed, including nested cases. Of the retained files, 82 changed only in
paths; ten also had cases/imports pruned or excessive capture matrices reduced.
No application implementation was changed.

| Removed files (former root basenames, `.test.ts`) | Reason |
| --- | --- |
| `area-candidate-tools`, `area-candidate-judgement`, `placement-search-tools`, `utility-box-tools` | Success scenarios for deliberately removed model tools; current interface exclusion checks and manual engine/authority tests remain. |
| `area-candidate-callback-order`, `placement-callback-order`, `utility-box-evidence` | Synthetic callbacks/forwarding for the retired model workflows. |
| `area-candidate-count`, `area-candidate-render`, `area-overlay` | Redundant legacy count/layout permutations and implementation-specific render internals; search, current scene marks and viewer behavior remain covered. |
| `approval-review-ui`, `scene-object-ui`, `screenshot-availability`, `historical-screenshot-wiring`, `workspace-ui-hierarchy`, `model-chat-ui-context` | Source regexes, extracted Svelte handlers, compiler duplication and markup/copy coupling; actual clients, authorities, capture and existing browser checks remain. |
| `candidate-assessment-prompt` | Exact documentation/prompt duplication; runtime skills, effective request inspection and tool gating remain covered. |
| `agent-tools-client`, `model-capture-bridge-colors` | Thin search/schema/forwarding assertions overlapping effective inspector and browser/capture coverage. |

Also removed source/markup checks from mixed behavioral suites, fixed-copy
presenter tests, one obsolete utility-box provider success case, and redundant
capture view/color Cartesian products. Remaining capture cases retain both mode
switch directions, omitted/unchanged mode, camera types, failures and restoration.
No skips, exclusions or assertion weakening were added to the retained cases.

The old baseline failures all fall within the removed obsolete workflow and
source/markup tests; product code was not altered to turn them green. This is an
intentional reduction in low-value coverage, not a claim that UI behavior was
newly browser-verified.

`package.json` now uses a quoted recursive test glob; `tests/tsconfig.json`
includes nested tests. Updated Python root resolution, current documentation and
the semantic-query path hashed by `scripts/check-closest-pole.ts`. Added a narrow
`.gitignore` exception for `tests/datasets/` so the existing dataset-asset ignore
rule cannot hide source tests. Shared helpers/fixtures remain in place.

## Verification

| Command/check | Result | Artifact |
| --- | --- | --- |
| `pnpm test` | 996/996 pass, no skips/cancellations | `/tmp/test-cleanup-tests.log` |
| `pnpm typecheck` | Pass, including nested tests; Svelte zero errors/warnings | `/tmp/test-cleanup-typecheck.log` |
| `python3 tests/preprocessing/dataset-recipe.test.py` | 4/4 pass | `/tmp/test-cleanup-python-recipe.log` |
| `data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/toronto3d-preprocessing.test.py` | 6/6 pass | `/tmp/test-cleanup-python-toronto.log` |
| `data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/dales2-preprocessing.test.py` | 14/14 pass | `/tmp/test-cleanup-python-dales.log` |
| `node /tmp/test-cleanup-audit.cjs` | All 89 TS tests discovered/typechecked; imports resolve; all 92 destinations visible to Git; 82 path-only moves | `/tmp/test-cleanup-audit.log` |
| `git diff --check` | Pass | No whitespace diagnostics |

Task-relative semantic diff inspected: `/tmp/test-cleanup-review.diff` (moves
normalized so pruning is readable). Move manifest:
`/tmp/test-cleanup-moves.json`; per-file deletion rationale:
`/tmp/test-cleanup-pruned.json`. Initial regex import audit falsely interpreted
embedded child-process scripts as file-relative imports; AST-based final audit
correctly leaves their repository-relative imports intact. Python bytecode
generated by these checks was removed.

GitNexus change detection was retried via
`node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 10000`
and MCP `detect_changes({scope: "all", repo: "cad-agent"})`. The final report
still lists only 1,000 of 2,303 symbols (`truncated: true`), with 144 processes
and CRITICAL risk for the entire dirty checkout. It combines the earlier source
reorganization, test moves/deletions and unrelated concurrent edits; untracked
destinations are not fully represented. This is **not** a clean graph check.
Reports: `/tmp/test-cleanup-detect.txt`, `/tmp/test-cleanup-detect.json`.
The task-relative audit and actual test/typecheck results are the bounded evidence.

Build/browser checks were not rerun: this task changes tests, discovery and paths,
not rendering or product behavior. No build/browser pass is claimed.
No staging or commit was performed. Concurrent unrelated `.claude/` and
`CLAUDE.md` deletions were left untouched.

## Next action

Fresh-session review of the pruning decisions and actual task-relative diff,
including the unresolved whole-checkout graph report. Handoff:
`/tmp/spatial-cad-test-cleanup-handoff.md`.
