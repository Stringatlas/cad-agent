# DALES-2: full-resolution, independent prepared tiles

This importer is separate from Toronto. It does **not** remap DALES classes to
Toronto labels, infer global transforms from tile filenames, or grant editing
capabilities. Runtime integration is a separate change.

## Acquired release and inspected originals

`config/dataset-recipes/dales2.json` pins Hugging Face
[`mbendjilali/DALES-2`](https://huggingface.co/datasets/mbendjilali/DALES-2) commit
`5a5e39237a28e2315ae0cc5dad1230cc5dd8ba4f`. The pinned release README declares MIT
and requests citations for DALES 2 (Bendjilali et al., CVPR Workshops 2026), DALES,
and DALES Objects. Read that upstream README and applicable terms; the publisher's
license declaration is not an independent legal audit. No raw data is committed.

The 29 locally available `train/*.laz` originals total **357,621,323 points** and
**2,013,879,012 bytes**. Every locally computed SHA256 matches the existing
Hugging Face download metadata at that revision. The recipe records all source
hashes/counts/sizes, sorted-filename stable IDs 1–29, header dimensions and dtypes,
scales/offsets/bounds, generating software/date, non-compression VLRs, full native
class histograms and nonblack RGB counts. These are local checksums corroborated
by acquisition metadata, not upstream signatures. Raw files remain unchanged.

All inspected headers use LAS 1.4, point formats 6 or 7, centimeter scales and
zero offsets; the additional `legacy_semantic`, `legacy_instance`, and `instance`
attributes are int16. All tiles are **already independently normalized** to
approximately X/Y 0–500 m and Z 0–137 m. Only Extra Bytes and LASzip compression
VLRs exist; there is **no CRS/projection VLR**. Meter/right-handed/Z-up is the DALES
local-coordinate convention; this does not recover a certified geographic CRS or
absolute elevation datum. Do not superimpose the 29 tiles as one scene. An
inter-tile or geographic placement requires separately verified transforms.

`classification` is native DALES-2, **not** `legacy_semantic`:

| ID | Class | ID | Class | ID | Class |
|---:|---|---:|---|---:|---|
| 0 | Ground | 5 | Tree | 10 | Light pole |
| 1 | Vegetation | 6 | Pick-up | 11 | Traffic pole |
| 2 | Car | 7 | Van & Truck | 12 | Habitat |
| 3 | Powerline | 8 | Heavy-duty | 13 | Complex |
| 4 | Fence | 9 | Utility pole | 14 | Annex |

This mapping comes from the pinned upstream README (its SHA256 is in the recipe),
not an interpretation of Toronto or legacy IDs. `instance` IDs are tile-local;
qualify any object identity with its source-file ID. No derived clustering is
required to preserve these released labels; no instance-quality certification is
implied.

## Reproduce

Acquire the same revision (the client package is only needed for downloading):

```python
from huggingface_hub import snapshot_download
snapshot_download(repo_id="mbendjilali/DALES-2", repo_type="dataset",
                  revision="5a5e39237a28e2315ae0cc5dad1230cc5dd8ba4f",
                  allow_patterns="train/*.laz", local_dir="data/raw/DALES-2")
```

Create a Python environment and build the converter using the **same pinned
commit and two patches** in [the existing converter build guide](../scripts/toronto3d/README.md).
That guide's Toronto PLY commands do not apply here; only its converter build does.
The DALES script requires the locally qualified converter executable SHA256
`b4fc33f94acc807225510c986da27f99e778ffddd32a7a7519b7d9a2ccdf8465`.
Another compiler/platform build requires independent qualification and an explicit
recipe update, not bypassing the check. Binary-identical builds and Poisson
sampling byte-order reproducibility are not claimed.

```sh
python3 -m venv data/processed/dales2/tooling/venv
PY=data/processed/dales2/tooling/venv/bin/python
"$PY" -m pip install -r scripts/dales2-requirements.txt
python3 scripts/dataset_recipe.py --recipe config/dataset-recipes/dales2.json \
  --raw data/raw/DALES-2/train
"$PY" scripts/dales2-inspect.py > /tmp/dales2-inspection-validation.json
CONVERTER=data/processed/toronto3d/tooling/PotreeConverter/build-gcc/PotreeConverter
"$PY" scripts/dales2-preprocess.py --tile 5080_54435 \
  --out data/processed/dales2/5080_54435 --converter "$CONVERTER"
"$PY" scripts/dales2-validate.py --out data/processed/dales2/5080_54435
"$PY" tests/preprocessing/dales2-preprocessing.test.py
```

For all 29 tiles, use a **new/nonexistent destination per tile**:

```sh
for source in data/raw/DALES-2/train/*.laz; do
  tile=$(basename "$source" .laz)
  "$PY" scripts/dales2-preprocess.py --tile "$tile" \
    --out "data/processed/dales2/$tile" --converter "$CONVERTER" || exit 1
done
```

Existing output directories fail rather than being overwritten. A failed run can
leave diagnostic/partial output; inspect it and choose a new output path. Source
hashes and converter identity are checked before creating output. Conversion and
validation each cap point buffers at 250,000 by default (`--chunk`, hard maximum
1,000,000); validation uses read-only LAS mmap plus a temporary disk-backed
one-byte-per-original-row coverage map. Source count does not become an in-memory
point array. Initial available disk was approximately 52 GiB, RAM 24 GiB; all tiles
are converted **sequentially**, not simultaneously. Keep enough disk for both the
normalized LAS and Potree payload; raw data is not removed.

## Output contract and preservation

Each `data/processed/dales2/<tile>/` contains:

- `cloud.json`: task074 prepared-cloud schema v1, format `potree2-uncompressed`;
  ID `dales2-5080-54435`, frame `dales2-5080-54435-local` for the default tile;
  meters, right-handed Z-up, local origin `[0,0,0]`. Published **only after** full
  validation passes. Other tiles have distinct IDs/frames.
- `<tile>.las`: uncompressed LAS 1.2 point-format 3 at the source centimeter grid.
  Integer XYZ, native classification, intensity, GPS time and return counters are
  retained; `point source id` becomes the stable recipe source ID; `source_row`
  uint32 is the original zero-based LAZ record index. Instance/legacy int16 fields
  are retained unchanged. Scan/flight flags, scan angle, user_data and the original
  LAS point_source_id are intentionally not retained in this normalized artifact;
  originals preserve them. This is not an archival replacement for raw LAZ.
- `octree/{metadata.json,hierarchy.bin,octree.bin}`: uncompressed Potree2 Poisson
  LOD. Every original point occurs exactly once across addressable node payloads.
  Potree quantization adds at most **0.01 m** per axis in the validated release.
- `manifest.json`: source inventory, recipe/executable hashes, exact command,
  declared RGB policy/palette, retained/dropped attributes and payload hashes.
- `validation.json`: every-point audit report; `converter.log`: diagnostics.

Only `5185_54485.laz` has nonblack native RGB (all 14,253,406 points); that tile's
uint16 RGB is preserved. All other sources have absent or entirely black RGB;
their display RGB is a **synthetic class palette**, never represented as a sensor
image. Native classification is always independently retained and declared in
`cloud.json`; color alone does not define a class or replace a semantic key.

Independent validation imports **no producer implementation**. It verifies raw
and asset hashes; streams original LAZ against normalized LAS; checks every
Potree coordinate/RGB/native classification/instance/legacy attribute plus
intensity/GPS/return counters; rejects duplicate/missing original-row provenance;
walks every hierarchy/proxy chunk and requires exact, non-overlapping complete
hierarchy and payload byte coverage. Coordinate error is bounded independently
at **0.01 m per axis plus 1e-9 m floating-point epsilon**, never by metadata scale.
Source and converter scales must be finite, positive and at most 0.01 m; converter
scale must also be no coarser than the original source grid, and its offset must
be finite. Finer converter grids are allowed but do not change the accuracy bound.
A source hash alone is not this audit.

Fixture tests include real LAZ streaming, centimeter grid/native classes, source
immutability/rows, palette versus real RGB, invalid class/hash/chunk rejection,
no runtime descriptor on converter failure, and full independent validation with
duplicate-identity/unaddressed-byte regressions. Corruption regressions recompute
asset hashes after zeroing coordinates/inflating scale, introducing per-axis
2 cm errors, or supplying invalid scales/offsets; validation still rejects them.
A finer-grid fixture with exactly 1 cm error passes the independent accuracy bound.
No converter is mocked as proof
of actual output correctness: real production conversion/audits are separate.

## Evidence / limits

Commands were run with the installed Python 3.14 environment
`data/processed/toronto3d/tooling/venv/bin/python`, numpy 2.4.4, laspy 2.7.0,
lazrs 0.8.2, and the qualified installed converter. A pinned lazrs 0.7.0 install
was attempted but did not support this Python/toolchain; 0.8.2 has a compatible
wheel and is the committed requirement.

- `/tmp/dales2-source-verification.json`: dependency-free source hash checks.
- `/tmp/dales2-inspection-validation.json`: all-header/full-label/RGB recheck.
- `/tmp/dales2-tests.log`: bounded fixture results.
- `/tmp/dales2-conversion.log`: first full tile conversion and validation.
- `/tmp/dales2-batch.log`: subsequent 28 sequential full conversions.
- `/tmp/dales2-revalidation.log`: original validator rerun for all 29 tiles.
- `/tmp/dales2-centimeter-tests.log`: strengthened validator fixtures, 14/14 pass.
- `/tmp/dales2-centimeter-revalidation.log`: strengthened validator rerun on all
  29 existing production tiles, all pass, covering all 357,621,323 source points;
  maximum observed error on each axis is `0.010000000000000009` m (floating-point
  representation of 1 cm), within the fixed bound plus epsilon. Exact commands:
  `data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/dales2-preprocessing.test.py`
  and `data/processed/toronto3d/tooling/venv/bin/python /tmp/dales2-revalidate.py`.
  The latter sequentially invokes `scripts/dales2-validate.py --out
  data/processed/dales2/<tile>` for every recipe source; it does not reconvert or
  modify production coordinates, metadata or manifests.
- `data/processed/dales2/preprocessing-summary.json` (also copied to
  `/tmp/dales2-preprocessing-summary.json`): 29 validated tiles, 357,621,323 points,
  148,838 nodes; per-tile frame/descriptor, raw and output hashes.
- `/tmp/dales2-all-readers-smoke.json`: all 29 existing prepared-cloud readers
  loaded info and a depth-0, 4096-point sample successfully (357,621,323 declared
  source points). A separate attempted depth-3 sample on the default tile failed
  closed at the existing total-read limit; no safety limit was changed. Native
  full-resolution streamed rendering is separate from this bounded sample API.

All 29 tiles were actually processed, without downsampling or merging frames;
the 28-tile batch after the initial tile took 370 seconds. Generated assets total
approximately 31.8 GB (29.6 GiB), leaving approximately 22 GiB free. The initial
tile has 11,153,689 points and 5,539 addressable nodes; its raw source SHA256 is
`b64aad816f123016dfefc547e089a0b026938709b821a0faa502102991a6ec23`.
The 14 fixture tests pass, including seven independent-validator fixtures.
Each prepared tile's manifest/validation report is the durable local generated
evidence, including exact source/output SHA256s. Large/generated data is ignored.

No runtime files are modified by this preprocessing work. No paid inference,
browser/rendering, full application test suite, cross-platform qualification or
review approval is claimed. The first prepared tile is a suitable runtime
integration target, not proof that generic scene picking/chat/editing is wired.
Existing uncommitted work is preserved. GitNexus context was stale; new standalone
symbols are absent from the index (UNKNOWN), confirmed by source/text references;
no pre-existing function was changed and no commit was made. Fresh-session review
of preprocessing and the parent's actual integrated diff remains pending.
