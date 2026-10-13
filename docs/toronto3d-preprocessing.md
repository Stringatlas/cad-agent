# Toronto3D prepared dataset

This is offline preprocessing, not viewer integration or CAD geometry. Raw inputs remain in `data/raw/toronto3d/`; generated data and local tooling are ignored by git. Dataset license: **CC BY-NC 4.0**, see https://github.com/WeikaiTan/Toronto-3D.

## Outputs

`data/processed/toronto3d/prepared/`:
- `octree/metadata.json`, `hierarchy.bin`, `octree.bin`: established **Potree 2**, poisson-sampled multilevel octree, uncompressed binary records. All four inputs form one shared cloud. All hierarchy levels collectively retain every source point exactly once; parent samples are moved between levels, not separate duplicates.
- `manifest.json`: input SHA256/counts/world bounds/semantic histograms, coordinate conventions, preview policy and converter invocation/hash. Written only after converter success; `validation-report.json` outside this folder is the independent validation authority.
- `preview.npy`: 100,000 points, 25,000 evenly spaced rows per input; structured NumPy array readable with `np.load(..., allow_pickle=False)`. Positions are local float64; RGB uint8; four original float32 scalars; source_file uint16 and source_row uint32. Bounded preview, not a spatially uniform sample or rendered image.
- `las/*.las`: full-fidelity attribute intermediates, coordinates quantized to millimeters. Kept for inspection/reconversion; originals remain the precision authority.
- Original class and color sidecars copied unchanged. Logs retained.

## Coordinates and attributes

Meters, right-handed Z-up; shared `local_origin_world = [627285, 4841948, 0]` (Toronto3D recommendation). `world = local + local_origin_world`, translation only. No CRS reprojection or independent CRS certification. Double source positions are shifted **before** quantization; source PLY retains unquantized world coordinates. LAS grid is 0.001m (maximum rounding error 0.0005m/axis); Potree's scale and offset are in its metadata. Decode `local = int32_position * metadata.scale + metadata.offset`, then add the shared origin for world values. Do not add large UTM offsets to GPU float32 buffers.

RGB is expanded exactly by `uint16 = uint8 * 257`. Original `scalar_Intensity`, `scalar_GPSTime`, `scalar_ScanAngleRank`, `scalar_Label` survive as float32 Extra Bytes. Semantic classes 0–8 are **not** LAS classification conventions: read `scalar_Label`, not the standard `classification` field (zero/default). Original nonfinite scalar values are retained, not cleaned. L003 contains 75,340 nonfinite intensity values; manifest records them. Consumers must handle them explicitly. All positions and semantic labels are finite.

Stable identity is `(point source id, source_row)` in Potree: file ID 1–4 maps L001–L004; row is zero-based PLY vertex index. LOD order is not stable and must not be used for IDs. Read float values without coercing missing intensity to zero. The validation script compares original scalar bits, including NaN payloads, rather than approximate numeric equality.

## Reproduction

Project-local environment (no global install):
```sh
python3 -m venv data/processed/toronto3d/tooling/venv
data/processed/toronto3d/tooling/venv/bin/pip install -r scripts/toronto3d-requirements.txt
```
Official PotreeConverter upstream commit `c2cb61843bf2b901e8e257874b1a6dcf67792fb2` needed local Darwin compatibility patches. Exact local build commands, compiler/dependency versions, patch export, executable hash and smoke evidence: `data/processed/toronto3d/tooling/POTREE_BUILD.md`, `potree-darwin.patch`, initial Darwin patch commit `95b426b9c1ccdc33774c543b6d5238c698cc343f`. Full-data checks also exposed upstream hierarchy serialization defects; local commit `975f3b468845b1673d83dc2c8ff896125fab5034` fixes type resets, proxy child masks and unreachable singleton records. See `tooling/hierarchy-v2-notes.md` and `hierarchy-v2.patch` alongside the Darwin patch. Tools depend on existing Homebrew GCC/TBB; not a portable binary. Those ignored artifacts must accompany a dataset transfer if build reproduction is needed.

```sh
data/processed/toronto3d/tooling/venv/bin/python tests/toronto3d-preprocessing.test.py
data/processed/toronto3d/tooling/venv/bin/python scripts/preprocess-toronto3d.py \
  --out data/processed/toronto3d/prepared \
  --converter data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter
data/processed/toronto3d/tooling/venv/bin/python scripts/validate-toronto3d.py \
  --report data/processed/toronto3d/validation-report.json
```
Producer refuses an existing output directory. Preserve or remove failed output explicitly before rerunning; failures have no completion manifest. Omit Potree `--attributes` to retain every Extra Bytes dimension. Preprocessing reads/writes bounded 500k-point buffers (converter has separate memory behavior). Validator uses capped 250k-point buffers and temporary disk-backed coverage bitmaps, with small hierarchy queues.

Validation checks originals against recorded hashes, every intermediate LAS/preview/octree point against its PLY row, exact RGB/scalar bits, coordinate tolerances, one-to-one provenance coverage, semantic class mapping, recursive hierarchy/payload addressability and decoded point containment within each node's spatial bounds. It does not certify visual quality, CRS, CAD validity or future viewer support. See task `docs/tasks/002-toronto3d-preprocessing.md` for actual execution evidence and review status.
