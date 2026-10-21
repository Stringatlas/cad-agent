# Toronto3D prepared dataset

This is offline preprocessing, not viewer integration or CAD geometry. Raw inputs remain in `data/raw/toronto3d/`; generated data and local tooling are ignored by git. The portable source recipe, checksums and converter patches are tracked; see [dataset acquisition and Git policy](datasets.md). Dataset license: **CC BY-NC 4.0**, see https://github.com/WeikaiTan/Toronto-3D.

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

1. Acquire originals using the official download instructions in [datasets.md](datasets.md).
2. Verify them against `config/dataset-recipes/toronto3d.json` (standard-library Python only):
   `python3 scripts/dataset_recipe.py`. It checks every PLY and both sidecars;
   it does not need or modify any generated data.
3. Build the pinned converter using the **tracked**
   [patch sequence and build instructions](../scripts/toronto3d/README.md).
   No old ignored patch exports are required. Both the Darwin and cumulative
   hierarchy patches are necessary for the reference build.
4. Create a project-local Python environment. The reference environment used
   Python 3.14; dependencies are pinned, but availability on every Python/platform
   combination is not claimed. No global Python package installs:

```sh
python3 -m venv data/processed/toronto3d/tooling/venv
data/processed/toronto3d/tooling/venv/bin/pip install -r scripts/toronto3d-requirements.txt
```

From repository root, run fixture checks, prepare into a **new** directory, and
validate against the originals. To preserve an existing `prepared/`, choose a
new output such as `prepared-reproduction/` and pass it to `--prepared` below.

```sh
PY=data/processed/toronto3d/tooling/venv/bin/python
"$PY" tests/dataset-recipe.test.py
"$PY" tests/toronto3d-preprocessing.test.py
"$PY" scripts/preprocess-toronto3d.py \
  --out data/processed/toronto3d/prepared \
  --converter data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter
"$PY" scripts/validate-toronto3d.py \
  --prepared data/processed/toronto3d/prepared \
  --report data/processed/toronto3d/validation-report.json
```

The producer now reads its source filenames, stable IDs and sidecars from the
tracked recipe, verifies their hashes **before creating output**, and records
recipe identity in its completion manifest. Origin, schema, class mapping,
output format and default full L001–L004 cloud are unchanged. The converter
executable hash is recorded, not required to match a host-specific reference
binary. The selected executable is trusted input: listing required patches in
manifest provenance does not prove an arbitrary supplied binary contains them.
The strict validator is still specific to the full four-source Toronto release;
editing this recipe is **not** a supported section/subset or new-dataset importer.
The dependency-free verifier's `--recipe` option only selects an integrity recipe,
not a product dataset or converter.

### Verify a dataset already on disk

No conversion or rebuild is needed to recheck existing output:

```sh
python3 scripts/dataset_recipe.py --raw data/raw/toronto3d
PY=data/processed/toronto3d/tooling/venv/bin/python
"$PY" scripts/validate-toronto3d.py \
  --raw data/raw/toronto3d --prepared data/processed/toronto3d/prepared \
  --report data/processed/toronto3d/revalidation-report.json
```

The existing validator accepts older manifests without a recipe field. Its
report is emitted only after all checks pass; choose a fresh report path to avoid
mistaking a stale report for a new success. Raw sources, LAS intermediates, the
preview and octree are read-only during validation. Provide `--scratch` on a
volume with at least ~79 MB free for source coverage bitmaps, plus overhead.
Full conversion needs substantially more space (raw ~3.4 GB, full LAS and octree
multi-GB, plus converter temporary files); plan generous free disk/RAM rather
than assuming the Python buffer cap bounds converter resources. Outputs are
semantically reproducible, not guaranteed byte-identical across concurrent runs.
No new converter build or full-cloud conversion/validation is implied by these
instructions.
Producer refuses an existing output directory. Preserve or remove failed output explicitly before rerunning; failures have no completion manifest. Omit Potree `--attributes` to retain every Extra Bytes dimension. Preprocessing reads/writes bounded 500k-point buffers (converter has separate memory behavior). Validator uses capped 250k-point buffers and temporary disk-backed coverage bitmaps, with small hierarchy queues.

Validation checks originals against recorded hashes, every intermediate LAS/preview/octree point against its PLY row, exact RGB/scalar bits, coordinate tolerances, one-to-one provenance coverage, semantic class mapping, recursive hierarchy/payload addressability and decoded point containment within each node's spatial bounds. It does not certify visual quality, CRS, CAD validity or future viewer support. See task `docs/tasks/002-toronto3d-preprocessing.md` for actual execution evidence and review status.
