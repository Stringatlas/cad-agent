# Task082 — STPLS3D real-world preparation

Process `data/raw/stpls3d_realworld/{OCCC,RA,USC,WMSC}_points.ply` into independent full-resolution prepared clouds in `data/processed/stpls3d_realworld/`, compatible with the existing Three.js workspace.

Acceptance:
- [x] Preserve every point, RGB, semantic class, and original vertex identity; leave raw sources unchanged.
- [x] Record source hashes, converter identity, coordinate grid and independent every-point audit.
- [x] Register four scenes and verify actual reader/Three.js compatibility; absent instance labels stay absent.
- [x] Verify preprocessing fixtures and application checks, record commands/results and handoff.
- [ ] Fresh-session review pending.

These PLY sources contain float32 XYZ, RGB8 and class uint8; no instance labels. Source coordinates remain local meters, Z up, origin [0,0,0]. No inter-scene transforms inferred. Native semantic names follow the official STPLS3D taxonomy at https://github.com/meidachen/STPLS3D#25-semantic-annotations.

## Results and verification

All four scenes published with 150,412,312 points total, approximately 4.5 GiB.
Every point audited exactly once against the original PLY: XYZ within 1.501 mm,
RGB and semantic IDs exact; raw/asset hashes and full hierarchy/payload coverage
pass. Four actual reader samples build finite Three.js bounds and RGB/semantic
buffers. Instance capability is absent, as required by the source schema.

Commands actually run (Node v22.23.3, pnpm 10.34.6, pinned local Python environment):
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-realworld-preprocess.py --inspect` — enrolled four source hashes/counts, `/tmp/realworld-inspect.log`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-realworld.test.py` — 2 tests pass, including actual converter round trip, malformed input, native class corruption rejection and overwrite refusal; `/tmp/realworld-tests.log`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-preprocessing.test.py` — existing 3 synthetic regression tests pass; `/tmp/realworld-synthetic-regression.log`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-realworld-preprocess.py` — all four scenes complete, independent all-point audit before each publication; `/tmp/realworld-conversion.log`.
- `node --import tsx scripts/check-stpls3d-realworld.ts` — all four reader/Three.js checks pass; `/tmp/realworld-compatibility.log`, processed root `viewer-compatibility.json`.
- `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node scripts/check-stpls3d-realworld.ts` — pass; `/tmp/realworld-check-typecheck.log`.
- `node --import tsx --test tests/datasets/cloud-runtime.test.ts tests/datasets/prepared-cloud.test.ts` — 19/19 pass with local HTTP permission; `/tmp/realworld-reader-tests.log`. Initial sandbox run could not listen on loopback; passing rerun used escalation.
- `pnpm typecheck` — pass, Svelte 0 errors/warnings; `/tmp/realworld-typecheck.log`.
- `pnpm build` — pass, existing bundle-size warning; `/tmp/realworld-build.log`.
- `pnpm test` — 1001/1001 pass; `/tmp/realworld-app-tests.log`.

The initial real-world fixture correctly failed publication when a newly added
audit variable shadowed the Potree coordinate offset. Fixed the auditor variable;
tolerance and corruption checks remain unchanged.
- `node --import tsx scripts/browser-cloud-workspace-smoke.mjs http://127.0.0.1:9222 /tmp/realworld-browser` — passed with isolated headless Chrome and built web preview. All four real-world RGB/semantic scenes loaded, Instance disabled; desktop/mobile layout, existing fake-provider captures/source queries, error/retry and Toronto switching passed. Report `/tmp/realworld-browser/report.json`; screenshots in that directory. Visually inspected USC RGB, WMSC semantic and mobile WMSC semantic with chat closed. No live inference claim.
- `git diff --check` — pass. New Python files also parsed with `ast.parse`. Actual output index and all four audit reports rechecked.

GitNexus: bound `cad-agent`, repository/worktree `/Users/kevin/Coding/spatial-cad-harness`, base `1f3b550d00e1145568fd67fc79d34f427e262987`. Pre-edit `validate` LOW, `preparedCloudName` LOW; `preparedCloudRegistrations` CRITICAL (13 upstream symbols; direct callers scene binder and prepared routes) warning reported before edit. Changes limited to additive registrations, tested via actual reader/browser and existing agent regressions.
`node .gitnexus/run.cjs analyze --index-only` refreshed to 12,434 nodes, 36,823 edges, 682 flows; `/tmp/realworld-graph-index.log`. `python3 /tmp/realworld-graph-check.py` used a disposable Git index/object directory to include untracked files without staging user changes. All-worktree analysis: 55 files, 415 symbols, 203 processes, critical risk; `/tmp/realworld-graph-changes.log`. This includes previous Tasks080/081, and CLI displayed lists are capped; it is not a clean whole-diff review certificate. No commit or staging performed. Existing unrelated changes preserved.

Fresh-session review remains pending. Handoff: `/tmp/task082-realworld-handoff.md`.
