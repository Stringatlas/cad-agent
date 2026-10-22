# STPLS3D preparation

`data/processed/stpls3d/1/` through `25/` are independent Potree 2 clouds,
compatible with the project's existing `PreparedCloudReader`. Each contains
`cloud.json`, `octree/{metadata.json,hierarchy.bin,octree.bin}`, a provenance
manifest, converter log and every-point validation report. `index.json` lists all
scenes. Originals and generated data remain Git-ignored.

The local run processed **79,327,203 points across 25 scenes**, approximately
**2.66 GiB** total. Every scene passed full raw-to-Potree validation and the
existing-reader/Three.js buffer check. Maximum measured coordinate error was
1.5 mm per axis. Task and command evidence: [Task080](tasks/080-stpls3d-preprocessing.md).

The input is headerless comma-separated TXT with eight columns:
`x,y,z,red,green,blue,semantic_id,instance_id`. The source RGB is retained;
semantic and signed instance IDs are never remapped. The `-100` instance sentinel
is preserved as int32. Native classes and the sentinel are documented by the
[official dataset](https://github.com/meidachen/STPLS3D#25-semantic-annotations).
Consult its download terms and cite STPLS3D (Chen et al., BMVC 2022); these local
files did not include a standalone dataset license.

## Coordinates and identity

Coordinates retain source local meters with Z up and origin `[0,0,0]`.
The text files provide no CRS or transforms between scenes; never merge or
georeference them by filename. Scene IDs are `stpls3d-1` through `stpls3d-25`,
each with its own `stpls3d-N-local` frame. Original point identity is
`(scene, point source id, source_row)`; source ID is N and row is zero-based TXT
line number. Instance identity is scene-scoped, not globally unique.

| Potree attribute | Type | Meaning |
| --- | --- | --- |
| position | int32 × 3 | Local XYZ, decoded with metadata scale/offset |
| rgb | uint16 × 3 | Original RGB8 multiplied by 257 |
| point source id | uint16 | Stable numeric source filename prefix |
| source_row | uint32 | Original zero-based row, stable through octree reorder |
| semantic_id | uint8 | Original STPLS3D class ID |
| instance_id | int32 | Original instance ID, including `-100` |

Positions use a 1 mm grid. The independent validator enforces at most
**1.501 mm error per coordinate** against raw text (LAS nearest-grid rounding
plus converter quantization). This is full-resolution point preservation with
coordinate quantization, not a downsampled-only export. Potree node samples
partition the full set; every raw row must occur exactly once.

## Reproduce

Use Python with `scripts/stpls3d-requirements.txt` and the existing qualified
PotreeConverter build described in [converter build instructions](../scripts/toronto3d/README.md).
The local Toronto tooling virtual environment already contains those pinned
dependencies. Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-preprocess.py
```

The converter path defaults to that tooling directory. Override with
`--converter`; its hash must match `config/dataset-recipes/stpls3d.json`.
Use `--scene 1` for one scene and `--out /new/output/root` for a new destination.
Existing scene directories are refused, never overwritten or silently skipped.
After an interrupted batch, use `--scene N` for each missing scene; the initial
all-scene invocation creates `index.json` only when all scenes succeed.

The recipe records inspected local source hashes/counts, not signed upstream
checksums. Normal conversion verifies these before writing. `--inspect --recipe
/new/recipe.json` is an explicit enrollment command for a new source inventory;
it refuses an existing recipe and does not bless changed inputs automatically.
Temporary LAS and audit arrays are removed after each scene. A scene directory
is published only after the independent audit succeeds.

```sh
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-preprocessing.test.py
PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python scripts/stpls3d-validate.py --out data/processed/stpls3d/1
node --import tsx scripts/check-stpls3d.ts
```

The auditor compares every XYZ, RGB and both labels to the raw row, detects
missing/duplicate provenance, walks all proxy hierarchy chunks and checks every
payload byte range and file hash. The loader check reads all 25 through the
actual server adapter and builds Three.js buffers; it does not claim browser
rendering verification.

## Loading into the project

On the server, use trusted startup registration (never client-supplied paths):

```ts
import { resolve } from 'node:path';
import { createPreparedCloudRegistry } from './apps/server/src/datasets/prepared-cloud';

const clouds = createPreparedCloudRegistry({
  'stpls3d-1': resolve('data/processed/stpls3d/1'),
});
const reader = clouds.open('stpls3d-1');
const info = await reader.info();
const sample = await reader.sample(info.revision, { budget: 100000, depth: 1 }, undefined, 'display');
```

The same registrations can be passed to `createPreparedCloudRoutes`. A browser
client can use the resulting positions and RGB values in Three.js:

```ts
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(sample.positions, 3));
const colors = new Float32Array(sample.count * 3);
const color = new THREE.Color();
for (let i = 0; i < sample.count; i++) {
  color.setRGB(sample.colors[i * 3] / 255, sample.colors[i * 3 + 1] / 255,
    sample.colors[i * 3 + 2] / 255, THREE.SRGBColorSpace);
  color.toArray(colors, i * 3);
}
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const points = new THREE.Points(geometry, new THREE.PointsMaterial({
  vertexColors: true, size: 2.5, sizeAttenuation: false,
}));
camera.up.set(0, 0, 1);
scene.add(points);
```

[Task081](tasks/081-shared-cloud-workspace.md) registers all 25 scenes and makes
STPLS3D the default workspace. Choose RGB, Instance or Semantic above the viewport.
Native signed `instances` are now returned in sampled JSON using the explicit
`instances` mapping in each `cloud.json`; no payload reconversion was needed.
Select a point to inspect its semantic type and instance ID and attach it to chat.
The agent can inspect the scene, capture it, query original source points and
attach original references in the selected scene. Original-source queries scan
the complete records independently of display LOD.
[Task083](tasks/083-prepared-adaptive-lod.md) adds progressive native octree display
with camera-driven refinement and resident budgets of 500,000 / 1,500,000 /
3,000,000 points (Light / Balanced / Fine). The initial overview remains bounded
to 100,000 points at depth 1. STPLS3D editing is not implemented; Toronto's existing edit adapter retains its human approval gates.

The converter also emits standard LAS fields initialized to zero (classification,
intensity and flight/return flags). These are unused placeholders, not additional
source measurements; semantics come exclusively from `semantic_id`. Selective
`--attributes` export is deliberately avoided: the qualified converter has an
extra-attribute offset bug in that mode, which the full-row audit detected.

The four separately prepared real-world PLY scenes (150,412,312 points, RGB and
semantic labels without instances) are documented in
[real-world preparation](stpls3d-realworld-preprocessing.md).
