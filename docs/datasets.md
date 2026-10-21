# Dataset acquisition and reproducibility

Git tracks **instructions and small recipes**, not licensed point-cloud data or
compiled tools. A fresh clone can inspect expected source identity and rebuild
instructions without copying an ignored developer tooling folder.

## What belongs in Git

- `config/dataset-recipes/toronto3d.json`: official upstream/license links, exact input
  filenames, byte sizes, point counts, source SHA256, stable source-file IDs,
  coordinate origin, converter commit and ordered patch references.
- `scripts/dataset_recipe.py`: dependency-free source/sidecar integrity checking.
- `scripts/preprocess-toronto3d.py`, `scripts/validate-toronto3d.py` and pinned
  `scripts/toronto3d-requirements.txt`: producer and independent full-data audit.
- `scripts/toronto3d/`: minimal effective converter source patches, retained
  upstream license and build instructions. Not a vendored converter checkout.
- Fixture tests and this documentation.

Keep `data/raw/`, `data/processed/`, virtual environments, converter checkouts,
logs, LAS/PLY/LAZ, previews, octrees and binaries ignored. Do not force-add them.
No credentials, expiring download tokens, personal host paths or private mirror
URLs belong in recipes. A generated manifest may contain the actual local
converter command; it stays local rather than becoming a portable build recipe.

## Acquire Toronto-3D

1. Open the [official Toronto-3D repository](https://github.com/WeikaiTan/Toronto-3D)
   and follow its **Download** links. Use the original labeled release containing
   `L001.ply` through `L004.ply`, `Colors.xml` and `Mavericks_classes_9.txt`.
   Download/extract manually if the provider requires browser interaction; no
   stable direct archive URL, automated cloud login or public mirror is assumed.
2. Preserve filenames and place those six files directly in
   `data/raw/toronto3d/` (not inside an extra archive subdirectory). Originals
   must remain unchanged. Archives may contain extra files; the recipe checks
   the six required inputs, not an exact directory listing.
3. Read the upstream terms and citation guidance. Dataset license is
   **[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)**, not the
   product's code license. Attribute Toronto-3D / Weikai Tan et al. and cite the
   upstream paper as requested. Noncommercial terms still apply to derived
   copies; downloading does not authorize commercial redistribution.
4. Run from repository root:

   ```sh
   python3 scripts/dataset_recipe.py --raw data/raw/toronto3d
   ```

   A mismatch is a stop condition: inspect the release/version/extraction rather
   than silently changing the reference hash. The recipe's hashes are local
   reference checksums transcribed from the existing validated prepared
   manifest (sidecars independently hashed locally), **not upstream signatures**
   or cryptographic proof of publisher identity. Acquisition trust remains with
   the official source.
5. Follow [Toronto preparation, converter build and validation](toronto3d-preprocessing.md).

The known release is 78,320,210 points combined from four PLYs. L001–L004 are
already sections of the same cloud, not four separately configured product tabs.
The existing prepared manifest and full validator report remain local evidence;
this work does not alter or regenerate them.

## Adding another point cloud

A source recipe is **not** a runtime registration, generic format converter,
semantic classifier or permission grant. Toronto preprocessing deliberately
accepts only its inspected packed binary PLY schema, keeps Toronto scalar names,
uses the shared Toronto origin, and maps class IDs 0–8 to the Toronto taxonomy.
The full independent validator still requires the four reference files.
Do not substitute an arbitrary PLY/LAS and assume these semantics apply.

For a new dataset, track a separate small recipe with:

- Official acquisition and applicable license/citation; no bundled large data.
- Exact source identity (filenames, hashes and provenance of those hashes), units,
  explicit frame/origin/CRS confidence, point/attribute schema and missing values.
- A format-specific ingestion adapter and pinned converter/patch/dependency
  instructions; stable row/entity identity independent of LOD traversal order.
- A full-data validation path for coordinate tolerances, attribute integrity,
  addressed hierarchy/payload ranges and provenance coverage; bounded fixture tests.
- Explicit semantics/capabilities: unknown or absent labels must not be treated as
  Toronto classes, and display support must not imply edit authority.

Then integrate the prepared cloud with the runtime boundary below and test
loading, picking and evidence binding before exposing it as a product scene.
This does not claim arbitrary raw formats, section subsets, cross-platform
one-command provisioning, byte-identical conversion or new dataset editing support.

## Generic read-only adapter

`apps/server/src/datasets/prepared-cloud.ts` exposes an operator-owned registry and
revision-bound reader. The underlying bounded metadata, hierarchy and asset I/O
in `potree-core.ts` are shared with Toronto's existing strict adapter. Toronto
retains its own origin, class and provenance validation; loading another cloud
never grants Toronto edit authority.

```ts
import { createPreparedCloudRegistry } from './prepared-cloud';

// Trusted startup configuration, never a request/model-provided filesystem path.
const clouds = createPreparedCloudRegistry({ 'quarry-west': '/local/prepared/quarry-west' });
const reader = clouds.open('quarry-west');
const info = await reader.info();
const sample = await reader.sample(info.revision, { budget: 1024, depth: 0 });
```

Each registered directory contains `cloud.json`, `octree/metadata.json`,
`octree/hierarchy.bin` and `octree/octree.bin`. Example `cloud.json`:

```json
{
  "version": 1,
  "format": "potree2-uncompressed",
  "id": "quarry-west",
  "frameId": "quarry-local-v3",
  "coordinates": {
    "units": "m", "handedness": "right", "upAxis": "Z",
    "localOrigin": [123400, 432100, 80]
  },
  "sources": [
    { "id": 42, "name": "survey-a.las", "points": 2 },
    { "id": 99, "name": "survey-b.las", "points": 2 }
  ]
}
```

The illustrative source counts must match the actual metadata. Positions are
local meters; `world = local + localOrigin`, with no reprojection. Required
Potree attributes are `position` (int32 XYZ), `rgb` (uint16 RGB),
`point source id` (uint16) and `source_row` (uint32 original zero-based row).
Only uncompressed Potree 2 interleaved records are supported. Conversion must
preserve these attributes and provide independently validated provenance.

Labels are absent unless the descriptor explicitly declares a mapping, e.g.:

```json
"semantics": {
  "attribute": "classification",
  "type": "uint8",
  "classes": { "42": "Rock face", "77": "Equipment" }
}
```

Semantic storage supports uint8, uint16 or float integer class IDs; unmapped
sampled labels fail closed. No labels means no `labels` array and
`semanticLabels: false`, not an invented Toronto taxonomy. All readers currently
report `boundedSample: true`, `fullResolution: false` and `editing: false`.
Samples use the existing harness bounds (at most 4096 points, depth 0–3), not a
full-cloud audit. Large/proxy levels outside those bounds are not certified as
readable merely because metadata loads. The revision binds descriptor/metadata,
first hierarchy chunk and asset identities; it is **not** a whole-file integrity
hash. Source checksums and full offline validation remain separate requirements.

`tests/datasets/prepared-cloud.test.ts` constructs a real on-disk second-cloud fixture
with different source IDs, origin and optional non-Toronto semantics. The adapter
is a callable server module, **not yet wired to HTTP, the viewer, chat, picking,
full-resolution streaming or editing**. Product wiring must bind every reference,
query and authority to the selected cloud/frame/revision and explicitly disable
unsupported tools. A new raw format additionally needs an importer and validation;
adding `cloud.json` alone does not convert it.

## Verification levels

1. `python3 tests/preprocessing/dataset-recipe.test.py`: small fixtures, no data/dependencies.
2. Venv Python `tests/preprocessing/toronto3d-preprocessing.test.py`: small conversion fixtures,
   real LAS encoding, mocked converter subprocess; no production conversion.
3. `python3 scripts/dataset_recipe.py`: all source/sidecar hashes on real inputs;
   no output payload correctness claim.
4. Venv Python `scripts/validate-toronto3d.py`: independent every-point audit of
   existing prepared output, originals, LAS, preview and hierarchy/payload bytes.
5. Product checks (`pnpm verify` and explicit browser verification) remain
   separate: a source hash or full offline audit is not a runtime/UX certificate.
