# Offline semantic instances

Task037 adds a **read-only derived artifact**, not a CAD edit or HTTP/model tool. It consumes the complete persisted semantic disk index from task010; it never uses displayed/LOD points. A missing cache is built using the existing bounded full-source preparation first. Source files, point overrides and CAD authority are unchanged.

## Run (Node 22 / pnpm 10.34.6)

```sh
pnpm exec tsx scripts/cluster-semantic-instances.ts \
  data/processed/toronto3d/prepared /tmp/toronto-instances-new

# Explicit class-dependent grid sizes, optional Building:
pnpm exec tsx scripts/cluster-semantic-instances.ts \
  data/processed/toronto3d/prepared /tmp/toronto-instances-custom \
  --classes 4:1,6:0.25,7:0.5,8:0.35 \
  --max-cells 500000 --max-output-bytes 536870912 \
  --max-manifest-bytes 67108864 --max-ms 600000

# Independent complete original-source membership/checksum audit:
pnpm exec tsx scripts/check-semantic-instances.ts \
  data/processed/toronto3d/prepared /tmp/toronto-instances-new
```

The output directory must not already exist. Success emits one JSON summary with `status: complete`. Errors/cancellation exit nonzero with `status: failed`; no partial output directory is published. SIGINT/SIGTERM cancel the clustering CLI. Temporary sibling staging directories are removed on handled failure; a process kill/power failure may leave an unpublished `.instances-building-*` directory, never a complete final artifact. Parent directories may be created. Existing output is never resumed or merged.

## Algorithm and limits

For each selected class independently, assign each original binary64 local-meter point to `floor(x / voxelMeters), floor(y / voxelMeters), floor(z / voxelMeters)` with grid origin `[0,0,0]`. All occupied cells that touch by face, edge **or corner** connect (26 neighbors). All points in one cell share its component; union-find merges adjacent occupied cells. Defaults: Pole label6 `.25m`; Car label7 `.5m`; Fence label8 `.35m`. Building label4 is opt-in. Settings are sorted by label and all are recorded in the artifact.

This is voxel connected components, **not exact-radius DBSCAN**. It retains isolated cells and singleton components; there is no noise/minimum-size dropping or subsampling. Adjacent objects can merge and occluded objects can fragment. Grid boundaries/resolution influence the result. The default sizes are initial heuristics, not tuned or quality-verified physical-object segmentation. No ground model, primitive fit, KD-tree or octree instance-query API is added.

Two sequential bounded checksummed page passes collect cells, then stream memberships; pages with no selected class are skipped using the validated complete index metadata. At most 26 neighbor probes per cell avoid dense point-pair quadratic work. No per-point full-cloud allocation or whole-category position array exists. Memory is O(occupied selected-class voxels + component metadata + the existing small index metadata), with a 64KiB output buffer. Default limits: 500,000 occupied cells, 512MiB binary memberships, 64MiB manifest and 10-minute clustering time. Hard configuration ceilings: 2,000,000 cells and 256MiB manifest. Limits fail explicitly; never publish an incomplete prefix or silently lower resolution. These are structural budgets, **not a hard process RSS cap**. Existing cache preparation has its own task010 budgets and occurs before the clustering timer in the high-level CLI path.

## Artifact contract

- `manifest.json`: `semantic-instances-v1`, `complete: true`; dataset revision, semantic-index hash, full prepared-payload SHA256, Toronto frame `toronto3d-local-v1`, meters, right-handed Z-up and world origin; algorithm/settings; ordered component summaries; binary size/checksum and total counts.
- Each instance summary carries semantic label/name, exact point count and numeric-smallest `(sourceFileId, sourceRow)` anchor. ID = SHA256 of the complete binding/settings and class/anchor. IDs and instance ordering are deterministic for the same bound artifact/settings regardless of class-option ordering. Any source artifact/settings change intentionally creates a different ID namespace. These are **derived instance IDs**, not authoritative editable CAD entity IDs.
- `memberships.bin`: a stream of **16-byte little-endian records**: `uint32 instanceOrdinal`, `uint32 sourceFileId`, `uint32 sourceRow`, `uint32 physicalRecord`. `instanceOrdinal` indexes `manifest.instances`. Records are in ascending original prepared physical order, not grouped by instance. The source pair is the original stable source provenance, never a GPU index; `physicalRecord` is a prepared-record location hint. Every selected source point occurs exactly once, including sparse/isolated points; other classes are absent. Coordinates are recovered from original bound records, not quantized voxel centers.

Source/cache identity and page checksums are checked before/during/after work; source replacement or corruption fails closed. Final directory publication is an atomic sibling rename after complete writes/checks, not a durable CAD-document transaction or power-loss durability guarantee. The independent checker scans all original prepared payload bytes with bounded reads, verifies the source hash, exact physical/source/class membership sequence, every component count and membership checksum. It is intentionally **not** a second connectivity/segmentation-quality oracle and currently caps audit manifest reads at 64MiB.

See [task037](tasks/037-semantic-instance-clustering.md) for actual-data evidence and remaining review scope.
