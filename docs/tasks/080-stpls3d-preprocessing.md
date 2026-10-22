# Task080 — STPLS3D prepared point clouds

Process all 25 `data/raw/STPLS3D/*_points_GTv3.txt` sources into independent
Potree 2 clouds under `data/processed/stpls3d/`, usable by the existing prepared
cloud reader. Input columns: x, y, z, red, green, blue, semantic_id, instance_id.

## Acceptance criteria
- [x] All sources converted without modifying originals; no scene frames merged.
- [x] Preserve RGB, native semantic and signed instance IDs, stable source/row IDs.
- [x] Track reproducible recipe, source hashes, converter identity and commands.
- [x] Validate every output point and full hierarchy, with coordinate tolerance stated.
- [x] Load every cloud through the existing project reader and construct Three.js geometry.
- [x] Record checks, limitations and handoff.
- [ ] Fresh-session review remains pending.

Scope: offline preparation and load compatibility, not a new scene selector,
agent authority or instance editing UI. Data stays Git-ignored.

## Implementation and checks

See [preparation and loading guide](../stpls3d-preprocessing.md), tracked recipe
`config/dataset-recipes/stpls3d.json`, producer/auditor scripts and
`scripts/check-stpls3d.ts`. Source enrollment found 79,327,203 rows in 25 scenes,
6,737,858,041 raw bytes. Published scenes retain all rows with at most 1.501 mm
error per coordinate; RGB and both native IDs are exact. Instance -100 remains
signed. No inter-scene transforms are inferred.

The real converter fixture initially exposed corrupt extra-attribute offsets
with selective `--attributes`; default full attribute export fixed it. The
independent audit rejected the corruption before publication. The converter's
unused standard LAS attributes are zero placeholders, not source measurements.

Checks actually run (Node v22.23.3, pinned local numpy/laspy environment):

- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-preprocess.py --inspect`
  — all source rows validated and hashed; `/tmp/task080-inspect.log`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-preprocessing.test.py`
  — 3 tests pass, including malformed input subcases, signed boundary IDs, real
  converter round trip and intentional payload corruption; `/tmp/task080-tests.log`.
- `node --import tsx --test tests/datasets/prepared-cloud.test.ts tests/datasets/dales-runtime.test.ts`
  — 15/15 pass after allowing local loopback test servers. Initial sandbox run
  had 3 `listen EPERM` failures; `/tmp/task080-reader-tests.log` holds the passing rerun.
- `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node scripts/check-stpls3d.ts`
  — pass; `/tmp/task080-check-typecheck.log`.
- `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-preprocess.py`
  — all 25 scenes completed, invoking the independent `stpls3d-validate.py` for
  each before publication; `/tmp/task080-conversion.log`. All 79,327,203 rows
  verified exactly once. Maximum measured error 0.0015000000000213731 m
  (floating-point representation of 1.5 mm). No remaining conversion scratch.
- `node --import tsx scripts/check-stpls3d.ts`
  — all 25 existing-reader samples and Three.js buffers pass;
  `/tmp/task080-viewer-compatibility.log` and
  `data/processed/stpls3d/viewer-compatibility.json`.
- Final index/report totals and all-scene pass statuses checked using Python;
  output approximately 2.66 GiB. `git diff --check` and whitespace checks on all
  eight additions pass; additions inspected, no existing tracked files modified.

Outputs: `data/processed/stpls3d/{1..25}/`, `index.json`, per-scene
`manifest.json` and `validation.json`. Raw source hashes are unchanged. Handoff:
`/tmp/task080-stpls3d-handoff.md`.

## Graph and review status

GitNexus is bound to `cad-agent` in this checkout. Initial index was one commit
behind. Refresh first failed on the registry lock outside the workspace, then
`node .gitnexus/run.cjs analyze --index-only` succeeded with escalation;
`/tmp/task080-graph-index.log`. Current base: `1f3b550d00e1145568fd67fc79d34f427e262987`.
Pre-edit DALES reference converter impact LOW; no existing application/converter
symbols were modified. New `prepare_scene` initially UNKNOWN/unindexed (source
search confirmed only new script/test callers); refreshed impact LOW, direct
caller `main`, two upstream symbols, script-local conversion processes.
`detect_changes(scope: all)` returns zero because additions are untracked; this
is not a clean whole-diff certificate. No commit or staging performed.

Fresh-session review remains pending. No UI/rendering changes, full app baseline,
browser/WebGL verification, instance-aware sampled API or new product scene
registration are claimed.
