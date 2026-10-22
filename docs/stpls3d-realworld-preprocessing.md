# STPLS3D real-world preparation

All four local `data/raw/stpls3d_realworld/*_points.ply` sources are prepared in
`data/processed/stpls3d_realworld/`. The workspace scene selector includes
**STPLS3D Real-world · OCCC / RA / USC / WMSC** alongside the synthetic scenes.

| Scene | Points |
| --- | ---: |
| OCCC | 38,914,634 |
| RA | 6,825,065 |
| USC | 94,694,849 |
| WMSC | 9,977,764 |
| Total | **150,412,312** |

Each scene contains `cloud.json`, uncompressed Potree 2 octree assets,
`manifest.json`, `validation.json` and the converter log. The root contains
`index.json` and `viewer-compatibility.json`. Generated data totals approximately
4.5 GiB and remains Git-ignored. Originals are unchanged.

The strict input schema is binary little-endian PLY: float32 XYZ followed by
uint8 red, green, blue, class. Native semantic IDs and RGB are preserved exactly.
There are **no instance labels** in these sources; no IDs are fabricated, and the
workspace disables Instance coloring. RGB and Semantic coloring are available.
Semantic names use the [official STPLS3D taxonomy](https://github.com/meidachen/STPLS3D#25-semantic-annotations).
Consult the upstream download terms and cite Chen et al., STPLS3D, BMVC 2022.

Source coordinates remain local meters with Z up and origin `[0,0,0]`; no CRS or
inter-scene transform is inferred. Scene IDs are `stpls3d-realworld-{name}` and
frames are `{sceneId}-local`. Source IDs are fixed by the enrolled recipe;
`source_row` is the original zero-based PLY vertex index. Positions use a 1 mm
LAS grid; total converter error is audited against source float32 coordinates
with the existing 1.501 mm per-axis ceiling. Every source vertex occurs exactly
once across the octree, and all hierarchy and payload byte ranges are checked.
Standard LAS fields not present in the source are zero placeholders. Native
semantics come exclusively from `semantic_id`, copied from the original `class`.

## Reproduce

Use the existing pinned numpy/laspy environment and qualified converter from
[STPLS3D preparation](stpls3d-preprocessing.md). Source hashes, counts, bounds,
class histograms and converter identity are recorded in
`config/dataset-recipes/stpls3d-realworld.json`.

```sh
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-realworld-preprocess.py
node --import tsx scripts/check-stpls3d-realworld.ts
```

Existing output scene directories are refused. `--scene usc` prepares one scene;
`--out /new/output/root` selects a fresh output root. `--inspect --recipe
/new/recipe.json` explicitly enrolls new source hashes and refuses existing
recipes. Normal conversion verifies enrolled hashes and converter identity,
then invokes the independent auditor before publishing each scene.

```sh
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-realworld.test.py
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-validate.py --raw data/raw/stpls3d_realworld --out data/processed/stpls3d_realworld/usc
```

Full source data is retained. [Task083](tasks/083-prepared-adaptive-lod.md) adds
camera-driven native octree display after the initial bounded overview. Light,
Balanced and Fine detail cap resident points at 500,000, 1,500,000 and 3,000,000.
Zooming/panning refines visible regions and evicts other nodes. This remains a
bounded view, not whole-source coverage or editing authority. Check commands,
browser artifacts and review status are recorded in [Task082](tasks/082-stpls3d-realworld.md).
