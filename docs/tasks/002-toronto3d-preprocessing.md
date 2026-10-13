# 002 — Toronto3D preprocessing

Status: Ready for fresh-session review

## Ownership
- Implementation owner: coding agent
- Review owner: Unassigned (fresh session)

## Goal / scope
Prepare four local Toronto3D PLY clouds for later streaming and inspection, without modifying originals or product runtime. Outputs and local tools are ignored under `data/processed/toronto3d/`. No viewer integration, deployment, CAD conversion or CRS reprojection.

## Acceptance criteria
- [x] All four inputs in established Potree 2 poisson octree LOD output (not crop-only): 78,320,210 points, 30,168 real nodes, depth 14.
- [x] Shared translation-only origin, meters / right-handed Z-up, coordinate quantization documented.
- [x] RGB, four scalar attributes, semantic class mapping and stable source-file/row provenance preserved; every point validated.
- [x] Deterministic 100,000-point preview, source hashes/bounds/label counts and tool provenance available.
- [x] Four automated fixture checks and full-data validation pass; originals unchanged by hash.
- [x] New-file contents inspected; independent child-agent review and follow-up completed.
- [ ] Fresh-session review completed (implementation is not approval).

## Implementation progress
Outputs: `data/processed/toronto3d/prepared/` (~8.0 GiB including retained LAS intermediates). Documentation: `docs/toronto3d-preprocessing.md`; producer, independent validator and pinned local Python dependencies in `scripts/`; fixture tests in `tests/toronto3d-preprocessing.test.py`.

Official PotreeConverter upstream `c2cb61843bf2b901e8e257874b1a6dcf67792fb2` built locally with Darwin patches and bounded hierarchy serialization fixes; final local commit `975f3b468845b1673d83dc2c8ff896125fab5034`, executable hash in manifest and `tooling/hierarchy-v2-notes.md`. Full-data validation exposed genuine upstream leaf/type, proxy-mask and unreachable-singleton-record defects. Fixed serializer and rebuilt instead of weakening checks; final octree relocated from `rebuilt-octree-v2` to `prepared/octree`, actual invocation/relocation recorded in manifest. Old large failed outputs removed; small diagnostic hierarchy/metadata and logs retained.

Coordinates use common origin `[627285, 4841948, 0]`. LAS grid 0.001m; Potree grid 0.001m, audited tolerance 0.0015m/axis. Observed maximum Potree error 0.00104444m/axis; preview retains double positions. All scalar float32 bits, including 75,340 nonfinite L003 intensity values, survive exactly. These are documented source anomalies, not dropped or cleaned points. Semantic labels use `scalar_Label`, not LAS standard classification. Stable identity: point source id 1–4 + source_row zero-based PLY row.

## Verification evidence
Commands run from repository root; Python means `data/processed/toronto3d/tooling/venv/bin/python` below.

| Exact command/check | Result | Diagnostics/artifacts |
| --- | --- | --- |
| `python3 -m venv data/processed/toronto3d/tooling/venv`; local venv `pip install numpy==2.4.4 laspy==2.7.0` | Pass, no global installation | `scripts/toronto3d-requirements.txt` |
| `python scripts/preprocess-toronto3d.py --out data/processed/toronto3d/prepared --converter data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter` | LAS/preview completed; initial octree rejected by strict hierarchy checks | `preprocess.log`, `diagnostics/original-octree/` |
| `cmake --build data/processed/toronto3d/tooling/PotreeConverter/build-gcc -j 6` after serialization fixes | Exit 0 | `tooling/build-hierarchy-v2.log`, build/patch notes |
| `data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter data/processed/toronto3d/prepared/las/L001.las data/processed/toronto3d/prepared/las/L002.las data/processed/toronto3d/prepared/las/L003.las data/processed/toronto3d/prepared/las/L004.las -o data/processed/toronto3d/rebuilt-octree-v2 -m poisson --encoding UNCOMPRESSED` | Exit 0, final output subsequently relocated | `tooling/rebuild-octree-v2.log`, `prepared/converter.log` |
| `python tests/toronto3d-preprocessing.test.py` | 4 tests pass (attributes/origin/chunks, nonfinite bits, truncation, bad labels) | Terminal; rerun by independent reviewer |
| `python -m py_compile scripts/preprocess-toronto3d.py scripts/validate-toronto3d.py` | Pass | Generated cache removed |
| `python scripts/validate-toronto3d.py --report data/processed/toronto3d/validation-report.json` | PASS: 78,320,210 points, every original/LAS/preview/octree record; exact RGB/scalar bits, one-to-one provenance, hashes, bounds/histograms, semantic mapping, hierarchy/payload coverage and node containment | `validation.log`, `validation-report.json` |
| `git check-ignore data/processed/toronto3d/prepared/manifest.json` | Ignored | `.gitignore` existing data rule |
| `git diff --no-index --check /dev/null` on each new Python implementation/test | No whitespace diagnostics (exit 1 denotes added content) | Terminal |
| GitNexus impact for standalone new `convert`/`run` | Unavailable database; UNKNOWN, not claimed low risk. Manual callsite inspection confirmed standalone script scope; no existing runtime symbols changed | LadybugDB read-only recovery error |
| Browser / Node baseline | Not run: no rendering, interactions or runtime changes | Not applicable to offline task |

## Review
Independent child review found missing semantic mapping and node containment checks plus misleading finest-level wording. Addressed all three; follow-up independent review reports no blocking issues, four fixture tests plus five hierarchy cases passed, inspected actual PASS report. This does not substitute for the requested fresh-session approval. Foundation task remains untouched and pending its own review.

## Remaining failures / next action
No known data-validation failures. Existing converter compilation warnings and approximate Darwin memory diagnostics remain; logs' RAM numbers must not be interpreted as physical usage. Tools are environment-dependent, and ignored patch/build artifacts must accompany data if reproduction on another machine is required. No visual-quality/CRS/CAD certification or viewer integration claimed. Next bounded action: fresh-session review of this task, new files and generated manifest/report.
