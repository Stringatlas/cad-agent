# Task074 — Point-cloud portability and tracked dataset recipes

## Task / scope
User requested abstraction for other point clouds and clearer Git-managed dataset
acquisition/processing provenance after the assessment of Toronto coupling.
Implement a bounded reusable read-only seam and reproducible source/build recipes;
preserve Toronto behavior and approval authority. No arbitrary-format importer,
scene tabs or broad chat/edit contract migration in this slice. Large source and
processed files remain ignored. No commits made.

## Acceptance criteria
- [x] Reusable prepared-cloud adapter loads an actual second on-disk fixture with
  different identity/frame/origin/source IDs and absent or non-Toronto semantics.
- [x] Metadata/hierarchy/I/O shared with Toronto without relaxing its strict
  required attributes, taxonomy, coordinates or provenance checks.
- [x] Generic capabilities explicitly exclude editing and full-resolution support;
  stale/cancelled/malformed observations fail closed within bounded reads/samples.
- [x] Git-track official acquisition/license, exact source checksums and stable
  IDs, dependency/build instructions and complete required converter patches.
- [x] Preprocessing consumes the tracked recipe, verifies inputs before creating
  output and records recipe provenance; independent full-data validator preserved.
- [x] Focused regression tests, source integrity checks and Git-filtered patch
  application checked; current full-suite failures compared against HEAD baseline.
- [x] Independent scoped review and corrective follow-up completed.
- [ ] Fresh-session whole-diff approval; implementation is not approval.

## Implementation
See [dataset guide](../datasets.md) for APIs/schema, acquisition and limitations;
[Toronto preparation](../toronto3d-preprocessing.md) and
[converter build instructions](../../scripts/toronto3d/README.md) for reproduction.

- `apps/server/src/potree-core.ts`: shared format parser, bounded first-chunk
  hierarchy parser and fixed-asset I/O extracted from strict Toronto adapter.
- `apps/server/src/prepared-cloud.ts`: operator-owned ID registry, explicit
  `cloud.json`, revision-bound bounded sample reader, optional semantic taxonomy.
- `tests/prepared-cloud.test.ts`: actual disk fixtures, stale/malformed/symlink/
  cancellation checks and in-flight LOD mutation regression.
- `config/dataset-recipes/toronto3d.json`, `scripts/dataset_recipe.py`: expected
  raw identities, local-reference SHA256 and dependency-free integrity checking.
- Numbered converter patches and license in `scripts/toronto3d/`; `.gitattributes`
  preserves their necessary CRLF context across Git staging/cloning.
- Producer now verifies recipe source/sidecar hashes before output creation.
  Default full-four-source cloud and output format remain Toronto-specific.

## Verification — actually run
Node v22.23.3, pnpm10.34.6. Diagnostic artifacts below are OS-temp files, not
portable source dependencies. No raw/generated dataset files changed.

| Command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | Pass, Svelte zero errors/warnings | `/tmp/task074-final-typecheck.log` |
| `pnpm build` | Pass; existing bundle-size warning | `/tmp/task074-final-build.log` |
| `pnpm exec tsx --test tests/prepared-cloud.test.ts tests/observation.test.ts tests/adaptive-display.test.ts tests/crop.test.ts tests/semantic-query.test.ts tests/source-point.test.ts` | Initial 52/52 pass, before added LOD regression | `/tmp/task074-adapter-tests.log` |
| `node --import tsx --test tests/prepared-cloud.test.ts` | Final 10/10 pass, independently rerun | `/tmp/task074-lod-child-handoff.md` and independent follow-up |
| `pnpm exec tsc -p tests/tsconfig.json` | Final pass including LOD regression | `/tmp/task074-final-tests-typecheck.log` |
| `PYTHONDONTWRITEBYTECODE=1 python3 tests/dataset-recipe.test.py` | 4/4 pass | `/tmp/task074-dataset-recipe-tests.log` |
| `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/toronto3d-preprocessing.test.py` | 6/6 pass; fixture converter subprocess mocked, LAS conversion real | `/tmp/task074-preprocessing-tests.log` |
| `PYTHONDONTWRITEBYTECODE=1 python3 scripts/dataset_recipe.py` | All four actual PLY hashes/sizes and two sidecar hashes pass | `/tmp/task074-source-verification.json` |
| `python3 /tmp/task074-check-filtered-patches.py` | Git-filtered patch blobs retain exact bytes; temporary upstream index recreates final converter source tree `55a9a0d27edb83280299e475315752a6fcb07744` | `/tmp/task074-filtered-patch-check.log` |
| `pnpm test` | Launcher failed before tests: IPC socket EPERM | `/tmp/task074-full-tests.log` |
| `node --import tsx --test tests/*.test.ts` | 1167 tests: 1154 pass / 13 fail | `/tmp/task074-full-node-tests.log` |
| Same Node test command in temporary `git archive HEAD` snapshot (`920e97e`) with installed dependency symlinks | Baseline repeat 1157: 1144 pass / same 13 fail; no new failing names, 10 added passes. First baseline run additionally hit two intermittent existing spatial-page-index failures (15 total) | `/tmp/task074-baseline-head920e97e-tests.log`, `/tmp/task074-baseline-head920e97e-tests-rerun.log` |
| `git diff --check`; changed-file LSP | Diff check pass; TS/Python LSP syntax-only, not type certification | CLI typecheck above is authority |

The 13 current/baseline failure reports are in area-candidate-judgement (2),
area-candidate-tools (2), model-request-inspection-client (1), placement-search-tools
(5 including nested subtest/parent), safe-markdown (1), utility-box-placement (1),
and workspace-ui-hierarchy (1). They remain unresolved; no assertions weakened.
Initial baseline additionally intermittently failed active-cache mutation and
build-cancellation/staging cleanup cases. Baseline repeat was otherwise identical.

## Review / graph limits
Independent review reproduced two bugs: Git `core.autocrlf=input` normalization
broke converter patch application, and mutable caller LOD could bypass sample
limits during async load. Fixed with `.gitattributes -text` and synchronous LOD
snapshot plus regression. Follow-up independent review found no remaining
material issues in those fixes or the bounded API/documentation claims.

Pre-edit graph impacts: shared metadata CRITICAL59, hierarchy HIGH12 and I/O
helpers HIGH18–25; decoder CRITICAL21 inspected but unchanged. The extraction
retains Toronto schemas/checks and affected regressions pass. New reader dynamic
callers yielded UNKNOWN; source/tests verified rather than treating zero as safe.
Normal graph refresh failed EPERM at the user's registry lock. An isolated
`HOME=/tmp/task074-gitnexus-home` with the installed CLI refreshed the repository
index successfully, finally 12,433 nodes / 37,432 edges / 709 flows.

Exact final CLI prefix:
`HOME=/tmp/task074-gitnexus-home node /Users/kevin/.nvm/versions/node/v22.23.3/lib/node_modules/gitnexus/dist/cli/index.js`.
`analyze --index-only` and `detect-changes --scope all --repo .` logs:
`/tmp/task074-final-graph-index.log`, `/tmp/task074-final-graph-changes.log`.
Final change analysis reports CRITICAL impact, 18 symbols / 88 affected processes;
CLI output is capped and omits untracked files from changed-file scope. FTS and
process coverage are incomplete. This is **not** a clean whole-diff graph
certificate or a commit gate pass. No commit attempted.

## Remaining / next action
- Generic adapter is a callable server module, not wired to HTTP/viewer/chat,
  picking, native full-resolution display, semantic indexes or edit authority.
  Toronto remains the only configured product dataset.
- Other raw formats need importers and full integrity validation. Only normalized
  uncompressed Potree2 with declared provenance, meter/right-handed/Z-up frame
  and required RGB is supported by this reader.
- No download, fresh converter compilation, full production reconversion or
  every-point validation rerun, cross-platform certification, browser verification
  or paid/live inference performed. No UI behavior changed.
- Review the whole diff in a fresh session. Next implementation milestone should
  integrate selected-dataset bindings and capability gating end-to-end before
  exposing another scene. Keep each scene's references/authority separate.
