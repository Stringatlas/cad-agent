# Exact closest Pole-labelled point

The first slice of [the architecture plan](plans/2026-10-13-closest-pole-harness.md) is implemented for local headless callers. It finds the nearest **stored Toronto3D point with `scalar_Label = 6`**, a proxy for a physical pole. It does not segment pole instances or measure distance to a fitted pole axis. [Task006](tasks/006-closest-pole-headless.md) records the exhaustive offline baseline; [task007](tasks/007-closest-pole-ui.md) adds the HTTP/UI boundary and [task008](tasks/008-closest-pole-performance.md) optimizes that interactive path. Each task's fresh-session review remains separate.

## Interactive indexed path

The Closest pole tab resolves Cmd/Ctrl overview clicks to original source references, never GPU coordinates/indexes. Its fixed read-only `GET /datasets/toronto3d/closest-pole?request=<encoded canonical request JSON>` route invokes `queryIndexedClosestPole` from `apps/server/src/pole-index.ts`. Headless callers can use the same request below with that function; `preparePoleIndex(directory, signal?, progress?)` optionally prepares it ahead of the first request.

Preparation performs one complete bounded physical-record decode/validation pass plus hierarchy coverage and one-to-one provenance validation. It persists exact binary64 Pole records and checksummed paged source-row lookups outside the source artifacts in OS temp `spatial-cad-pole-index-v1`. The cache binds real root, revision and asset device/inode/size/mtime/ctime, uses integrity checks and atomic publication, and never publishes cancelled partial builds. Corruption fails explicitly instead of silently rebuilding or sampling. Resident caches are bounded to two entries/192MiB estimated weight; category data is capped at96MiB and lookup construction at512MiB. Persistent entries have no automatic disk eviction; OS/manual cleanup may remove derived entries while not serving queries.

Queries search spatial buckets exactly and independently reduce **all indexed Pole points**, including the explicit domain test and numeric-key tie rule. They directly reread selected/winning original prepared records. This verifier is category-linear, **not** a fresh exhaustive original-record scan. Both evidence objects bind `index: {points,hash}`; search uses `pole-category-index-v1`/`indexed`, verification uses `pole-category-linear-v1`. Search `scannedPoints` counts visited category records, verification counts every indexed Pole. Reference `resolutionPoints` is1 in each independent path (coordinate:0); `sourceReads` separately reports actual original-file I/O, including preparation when required. NDJSON progress starts with optional `index` before resolve/search/verify; fast queries may coalesce/skip intermediate progress. Browser validation binds request/revision/evidence, requires terminal framing and EOF, and suppresses stale/cancelled results.

Actual production HTTP plus production browser-client/channel logic measured **46.745–53.655ms warm**, **290.801ms fresh-process persisted first query**, with897,825 indexed Poles over78,320,210 source records and165B original payload reads per selected-reference query. The exact winner/distance matches prior evidence. Warm improvement is at least1,464× against the saved78.590s HTTP baseline (not rerun). Actual backend cold construction was11.147s (~7×, not orders of magnitude), cache350.7MB and peak cold RSS~595MB. These are distinct measurements: no cold HTTP latency is claimed. Current existing-Chrome checks additionally pass native picking, indexed evidence, cancel/retry, markers/camera, resize and teardown/remount; four instrumented, ungated gestures/retries completed verified UI in117–149ms on the prepared backend (not a cold/startup or percentile benchmark). See `artifacts/closest-pole-performance/{actual-data.json,http-summary.md,http-actual.json}` and `artifacts/closest-pole-performance/browser/{summary.md,report.json,timings.json,verify-final-pass.log}`. Current baseline passes61/61 tests; fresh-session review pending.

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
