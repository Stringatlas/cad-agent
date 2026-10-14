# Exact closest semantic-labelled point (Pole default)

The first slice of [the architecture plan](plans/2026-10-13-closest-pole-harness.md) is implemented for local headless callers. It finds the nearest **stored Toronto3D point with `scalar_Label = 6`**, a proxy for a physical pole. It does not segment pole instances or measure distance to a fitted pole axis. [Task006](tasks/006-closest-pole-headless.md) records the exhaustive offline baseline; [task007](tasks/007-closest-pole-ui.md) adds the HTTP/UI boundary and [task008](tasks/008-closest-pole-performance.md) optimizes that interactive path. Each task's fresh-session review remains separate.

## Task009: selectable category and display window

The tab is now **Closest: label**, with all nine Toronto3D `scalar_Label` categories (0–8; Pole default). `GET /datasets/toronto3d/closest-label?request=<canonical JSON>` binds the requested filter through search, independent verifier, witness, cache identity/header and evidence. Existing Pole-named TypeScript interfaces/functions remain for compatibility, but accept the supported category union. The legacy `/closest-pole` route strictly requires label6. `preparePoleIndex(directory, signal?, progress?, label=6)` now prepares the common all-label disk index and reports the requested category count (task010).

Historically in task009 (superseded by task010 below), category/spatial allocation bounds selected the exact exhaustive source-record query plus independent linear-record oracle rather than sampling or increasing index limits. Prepared label histograms are allocation hints only, never answer evidence. Corruption, cancellation and ordinary resource failures never trigger this fallback. Large-category point-reference queries can be much slower (four source passes); actual-data Ground cancellation/supersession was verified, not full Ground completion or latency. Fixture coverage verifies all nine labels and both paths. Existing task008 timing numbers below are historical Pole-only measurements.

Shift-drag loads every point inside a frozen projected camera volume for display/picking, with explicit cancel/clear/reload and incomplete/resource states. Batch source keys and original binary64 local positions bind detail picks to revision; detail is preferred to faded overview. **Search remains whole-dataset**: Shift window, camera and display LOD do not constrain it. Detail is an uncapped disposable render/pick cache, not geometry authority; total CPU/GPU memory can still exhaust resources. See [task009](tasks/009-closest-label-window.md) for final78-test baseline and nine passing existing-Chrome interaction checks, screenshots and diagnostics. Fresh-session review pending.

## Task010: shared disk-backed interactive path (current)

All nine labels use one common index in OS temp `spatial-cad-semantic-disk-v1`, not per-category full-source fallback. Preparation validates complete hierarchy/payload and unique source-row coverage in one payload pass. Physical-order pages preserve Potree spatial locality and store exact binary64 coordinates, provenance, physical row and label (40bytes/point,4096points/page). Binary page metadata stores actual per-label AABBs/counts and SHA256s. Shared lookup construction externally partitions source-row tuples with ≤8MiB spool buffers and ≤1MiB construction tables, rather than allocating a whole313MiB lookup. Metadata is bounded to40MiB estimated retained weight, header≤4MiB and total declared cache working-budget96MiB; process RSS is larger due to Node/V8/transient allocation overhead (actual cold242MiB, benchmark peak288MiB). Reads≤4MiB, record reads≤160KiB. Larger-than-supported metadata/provenance budgets fail incomplete/resource, not sampling or source-scan fallback.

Search independently orders pages by Euclidean AABB lower bound; the verifier has its own L-infinity bound/order, decoder and minimum reduction, with no production winner/radius input. Both account for every physical page as visited, category/domain-excluded or strictly distance-pruned. Equal-distance pages cannot be pruned, preserving numeric source-key ties. Whole-dataset counts use validated page totals; AABB boundary pages are read even when distant to count exact domain matches. Original selected and winning records are independently reread in each path. The exhaustive source oracle remains an offline audit/fixture comparator.

Evidence versions are `semantic-disk-page-index-v1`/`semantic-disk-page-verifier-v1`. `index: {points,hash}` carries requested-category count and common index binding; `disk` carries total/visited/excluded/pruned page counts, complete covered physical points and actual cache bytes/max-read. `scannedPoints` counts all mixed-category records in visited pages, **not** category population. Browser validation checks exact full/tail-page arithmetic, partitions and bytes, prohibits pruning without a winner and retains strict legacy validation. Warm selected-reference source reads are220bytes (two selected plus two winning55byte records); coordinate-found110bytes. Cache reads are separate. Cache metadata integrity is validated on load, record/lookup checksums when read, and active file identities/stats before/after bounded reads and publication. Skipped pages are certified by trusted immutable preparation metadata, not rescanned per query; this is not adversarial writable-filesystem protection. Disk artifacts have no automatic eviction; remove only while not serving queries, then restart/drop disposable memory.

Task010 actual measurements: one-time cold29.692s, persisted first HTTP184.389ms; ten warm production HTTP/client requests per category across two source selections gave p95 Ground909.407ms, Building158.999ms, Pole42.161ms, all nine below2s. Disk cache3.457GB decimal; no larger in-memory category cap. Native existing-Chrome UI completes all nine labels and checks picking/window/cancel/retry/LOD/disposal; its instrumented gesture timings are separate from HTTP percentiles. Baseline92/92 and ten browser checks pass. See [task010](tasks/010-all-label-disk-index.md) and `artifacts/closest-label-performance/summary.md`; fresh review and graph analysis remain pending/unavailable.

```sh
pnpm exec tsx scripts/check-closest-label-disk.ts --prepare /tmp/spatial-task010-actual
pnpm exec tsx scripts/check-closest-label-disk.ts --http /tmp/spatial-task010-actual
pnpm verify
DEBUG=pw:api node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task010-browser-current
```

Preparation command requires a genuinely absent bound cache for cold evidence; do not delete an active cache to manufacture a cold run. HTTP command requires the separate passing preparation receipt and refuses a cold build. Existing Pole-specific scripts are updated for the new current path while retaining the exact historical Pole winner; historical task008 artifacts/timings below are not rewritten by task010 verification.

## Interactive indexed path (task008 Pole historical context, superseded by task010)

The Closest pole tab resolves Cmd/Ctrl overview clicks to original source references, never GPU coordinates/indexes. Its fixed read-only `GET /datasets/toronto3d/closest-pole?request=<encoded canonical request JSON>` route invokes `queryIndexedClosestPole` from `apps/server/src/pole-index.ts`. Headless callers can use the same request below with that function; `preparePoleIndex(directory, signal?, progress?)` optionally prepares it ahead of the first request.

Preparation performs one complete bounded physical-record decode/validation pass plus hierarchy coverage and one-to-one provenance validation. It persists exact binary64 Pole records and checksummed paged source-row lookups outside the source artifacts in OS temp `spatial-cad-pole-index-v1`. The cache binds real root, revision and asset device/inode/size/mtime/ctime, uses integrity checks and atomic publication, and never publishes cancelled partial builds. Corruption fails explicitly instead of silently rebuilding or sampling. Resident caches are bounded to two entries/192MiB estimated weight; category data is capped at96MiB and lookup construction at512MiB. Persistent entries have no automatic disk eviction; OS/manual cleanup may remove derived entries while not serving queries.

Queries search spatial buckets exactly and independently reduce **all indexed Pole points**, including the explicit domain test and numeric-key tie rule. They directly reread selected/winning original prepared records. This verifier is category-linear, **not** a fresh exhaustive original-record scan. Both evidence objects bind `index: {points,hash}`; search uses `pole-category-index-v1`/`indexed`, verification uses `pole-category-linear-v1`. Search `scannedPoints` counts visited category records, verification counts every indexed Pole. Reference `resolutionPoints` is1 in each independent path (coordinate:0); `sourceReads` separately reports actual original-file I/O, including preparation when required. NDJSON progress starts with optional `index` before resolve/search/verify; fast queries may coalesce/skip intermediate progress. Browser validation binds request/revision/evidence, requires terminal framing and EOF, and suppresses stale/cancelled results.

Actual production HTTP plus production browser-client/channel logic measured **46.745–53.655ms warm**, **290.801ms fresh-process persisted first query**, with897,825 indexed Poles over78,320,210 source records and165B original payload reads per selected-reference query. The exact winner/distance matches prior evidence. Warm improvement is at least1,464× against the saved78.590s HTTP baseline (not rerun). Actual backend cold construction was11.147s (~7×, not orders of magnitude), cache350.7MB and peak cold RSS~595MB. These are distinct measurements: no cold HTTP latency is claimed. Current existing-Chrome checks additionally pass native picking, indexed evidence, cancel/retry, markers/camera, resize and teardown/remount; four instrumented, ungated gestures/retries completed verified UI in117–149ms on the prepared backend (not a cold/startup or percentile benchmark). See `artifacts/closest-pole-performance/{actual-data.json,http-summary.md,http-actual.json}` and `artifacts/closest-pole-performance/browser/{summary.md,report.json,timings.json,verify-final-pass.log}`. Task008 baseline passed61/61 tests; fresh-session review pending.

```sh
pnpm exec tsx --test tests/pole-index.test.ts tests/pole-ui.test.ts
pnpm exec tsx scripts/check-closest-pole-performance-http.ts
pnpm verify
```

The HTTP performance script reuses the persisted actual-data cache, checks production client validation/selection and cache/harness independence, and records persisted startup separately from warm repeats. It preserves task007 historical artifacts. `scripts/check-pole-index.ts` is the separate backend cold/warm benchmark; do not mistake a reused cache for cold construction.

## Exhaustive offline invocation

Use Node22/pnpm10.34.6 and the existing prepared data. A local TypeScript caller can invoke:

```ts
import { queryClosestPole } from '../apps/server/src/semantic-query';
import { PotreeDataset } from '../apps/server/src/potree';
import { DEFAULT_DATASET_ROOT } from '../apps/server/src/dataset-routes';

const info = await new PotreeDataset(DEFAULT_DATASET_ROOT).info();
const result = await queryClosestPole(DEFAULT_DATASET_ROOT, {
  requestId: 'inspection-1',
  datasetId: 'toronto3d',
  expectedArtifactRevision: info.revision,
  units: 'm',
  frameId: 'toronto3d-local-v1',
  input: { kind: 'coordinate', position: [164.16, 808.845, 141.097] },
  filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: 6 },
  metric: 'euclidean-3d',
  domain: { kind: 'whole-dataset' },
}, new AbortController().signal);
```

This example uses whole-dataset scope. An explicit region instead uses `domain: { kind: 'aabb', min: [x,y,z], max: [x,y,z] }`, with finite positive extent and inclusive membership. A stored selection uses `input: { kind: 'point-ref', key: { sourceFileId: 1, sourceRow: 846038 } }`; resolution reads the canonical prepared point. File IDs1–4 map L001–L004; source rows are zero-based original PLY rows. A Pole-labelled selection can win at zero distance. Float32 viewer indexes/positions are not source references. The interactive path above uses this same input contract.

All inputs are local meters, right-handed Z-up, translation-only world origin `[627285,4841948,0]`. The dataset revision is independent of project geometry revision. Unsupported units/frame/class/metric/domain fields fail validation; explicit coordinate queries can lie outside data bounds within the supported magnitude guard. Equal binary64 squared distances use numeric source-file/row order. Arithmetic and configuration versions accompany each answer; display rounding never determines the winner.

## Exhaustive offline authority and verification

`SemanticSpatialQuerySource` and `NearestQueryVerifier` live in agent-harness; shared serializable contracts/assertions live in contracts. The server composition opens one snapshot for both paths and cleanup. The query walks the complete hierarchy, all ancestor/descendant payloads and nested proxies, validates complete byte/count coverage and retains a running minimum. The independent verifier parses/decode/reduces all physical payload records without the query's decoder, hierarchy walk or argmin helper. It also counts physical hierarchy records to validate evidence. Only a matching result with an unchanged artifact binding becomes `verified-found` or `verified-none`.

Cancellation, corrupt data, stale revisions and read/resource failures never become certified nearest answers. Abort stops future bounded work; an OS read already in progress is not instantly interrupted. The headless executor checks ignored cancellation before publication. No progressive candidate result is exposed in this first slice; callbacks report phase/actual counts/bytes only.

Metadata/hierarchy reads ≤64KiB, payload reads ≤4MiB, cancellation checkpoints ≤8192 points, supported format depth ≤24. There is no total source-work/point/time cap or sampling fallback. Point working memory is constant; interval/traversal bookkeeping grows with hierarchy size. Coordinate queries scan the full payload twice (search + independent verification), even for a small AABB. Point-reference queries additionally scan once in each path for resolution. This establishes a correctness baseline before spatial pruning; it is not optimized interactive latency.

`search`/`verification` stats describe logical scan work; `resolutionPoints`/`resolutionPayloadBytes` separately account for reference-resolution passes. Search hierarchy bytes/chunks include resolution, payload nodes describe the final nearest scan. `metadataBytes` describes the metadata used by each algorithm, not repeated fingerprint checks. Server `sourceReads` gives total **physical** metadata/hierarchy/payload bytes, including cached-root loading and fingerprint rechecks, plus maximum allocation/read size. Hashes/config/evidence are reproducibility diagnostics; hash equality alone is not global-nearest verification.

Prepared artifacts must remain immutable and trusted while serving. The existing revision is a metadata/root/payload-stat fingerprint, not a full content hash. File identity/size/mtime/ctime/fingerprint checks catch ordinary replacement/mutation, but this is not adversarial concurrent-filesystem protection. Earlier one-to-one provenance/data fidelity audit remains a prerequisite; per-query range/count checks do not recreate a global provenance-uniqueness audit. Original PLY positions may differ from prepared coordinates by the recorded 0.0015m/axis tolerance; ranking is over prepared coordinates.

## Reproduce exhaustive baseline evidence

```sh
pnpm exec tsx --test tests/semantic-query.test.ts tests/observation.test.ts tests/crop.test.ts tests/crop-concurrency.test.ts tests/crop-feedback.test.ts
pnpm exec tsx scripts/check-closest-pole.ts
pnpm verify
```

The actual-data script deterministically seeds from a recorded complete root payload, offsets its coordinate by `[0.25,0.25,0]`, declares a ±2.5m AABB, verifies against a complete linear scan, repeats, checks the winner's raw PLY label/position, compares independent display/harness observations and streams complete artifact SHA256s. It writes `artifacts/closest-pole/actual-data.json`; Ctrl-C yields nonpassing cancelled evidence. It does not regenerate data or rerun the full preprocessing audit. Exact command/results/logs are recorded in task006.

The existing uncapped cancellable progressive crop stream and independent display/harness LOD are unchanged. HTTP/session wiring and indexed pruning now exist as described above; task008 rendered browser verification passes. Model calls and CAD edits remain later stages. Foundation/preprocessing/tasks003–004 reviews remain separate; implementing this query does not approve them.
