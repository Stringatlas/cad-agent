# Read-only tool protocol and durable evidence (v1)

This additive, headless slice implements [task011](tasks/011-tool-protocol-evidence.md). It is not a model loop, benchmark runner, mutation API, CAD proof, HTTP route or viewer change. Dataset artifact revision is **not** project geometry revision. Existing observation, closest-label search, independent verifier and full-detail rendering algorithms are unchanged.

## Boundaries and trusted composition

- `packages/contracts/src/tool-protocol.ts`: versioned envelopes, fixed bindings, canonical/detached arguments and small runtime validators; no framework or Node imports.
- `packages/agent-harness/src/tool-protocol.ts`: allowlist, returned-data/evidence validation, admission, cancellation and semantic projection through an injected `ReadonlyToolAdapter` and SHA-256 function. No concrete Node/server/Pi/render/kernel types.
- `packages/agent-harness/src/run-evidence.ts`: redacted bounded export, strict loading and executing replay.
- `apps/server/src/tool-adapter.ts`: trusted composition of `PotreeDataset.info/observe` and `queryIndexedClosestPole`. The historical query name supports all nine scalar labels and still independently verifies every complete result.
- `apps/server/src/tool-evidence.ts`: fixed prepared-asset digests and operator-only evidence persistence.

The adapter and hasher are trusted dependencies, not request fields. Structural checks reject wrong bindings, unknown statuses, forged request/configuration hashes, inconsistent witnesses/counts/coverage and mismatched search/verifier evidence. They do **not** turn an arbitrary malicious implementation with fabricated, internally consistent proof strings into an independently verified source. The concrete adapter's existing independent verifier remains the authority. Hashes are integrity/comparison values, not signatures or proof of authorship.

## Requests and outcomes

Every request has exactly `schemaVersion`, `toolVersion`, `runId`, `requestId`, `binding`, `tool`, `args`:

```json
{
  "schemaVersion": "spatial-readonly-v1",
  "toolVersion": "readonly-tools-v1",
  "runId": "inspection-1",
  "requestId": "metadata-1",
  "binding": {
    "datasetId": "toronto3d",
    "artifactRevision": "<64 lowercase hexadecimal characters>",
    "artifactDigest": "<64 lowercase hexadecimal characters>",
    "units": "m",
    "frameId": "toronto3d-local-v1"
  },
  "tool": "dataset.metadata",
  "args": {}
}
```

| Tool | Exact arguments | Successful coverage/status |
| --- | --- | --- |
| `dataset.metadata` | `{}` | `observed`, `metadata-only`; dataset metadata, not geometry verification |
| `dataset.observe` | `{lod: {budget, depth}}`; integer budget 1..4096, depth 0..3 | `observed`, `bounded-first-chunk-sample`; fixed-purpose harness sample, not exhaustive coverage |
| `dataset.nearest-label` | `{input, filter, metric, domain}` using existing nearest-query contracts | `verified-found` or `verified-none`, `complete:true`; existing search and independent verification evidence retained |

Nearest arguments require `metric:euclidean-3d`; filter schema `toronto3d-scalar-label-v1`, attribute `scalar_Label`, value 0..8; explicit whole-dataset or AABB domain; explicit local coordinate or stable original point key. No implicit filter, spatial restriction, alternate sampling, filesystem path or display settings are accepted.

Unknown fields/tools/versions, invalid types, nonfinite numbers and unbounded values fail closed. Run IDs/request IDs/code identity are bounded nonsecret tokens (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`). Bindings and arguments are detached before asynchronous adapter work; the admitted call is deeply frozen. Success data is descriptor-copied into one inert bounded snapshot before validation, hashing and publication; oversized arrays are rejected before index enumeration/copying. Request, metadata, query, observation, configuration and artifact arrays must be ordinary dense data arrays: accessors, symbols, custom properties/prototypes/iteration/serialization hooks are rejected without invoking them. Ordinary frozen arrays are accepted. JavaScript structural checks do not guarantee safety against arbitrary Proxy traps; adapters/hashers and the JavaScript environment remain trusted dependencies. Results are validated against the call, fixed frame, configured search/verifier pair and per-label configuration hashes. Each indexed search/verifier proof must report matchingPoints equal to the category index count for whole-dataset domains; AABB domains may report a subset. Observation hashes are recomputed from the same bounded snapshot that is published. Request hashes use the existing fixed-order `canonicalPoleRequest` encoding, not the sorted generic JSON encoding.

Replies contain exact `schemaVersion`, `toolVersion`, `request`, `outcome`. Invalid input has `request:null` so arbitrary caller fields are not echoed. Valid requests retain their canonical request. Admission errors (`stale-binding`, `budget`, `busy`, duplicate-ID `invalid-input`) occur before adapter work. Adapter errors remain errors; resource/transport outcomes stay incomplete. Wrong returned evidence is `verification-rejected/evidence-binding`. Actual adapter rejection becomes `verification-rejected/adapter-rejected`, with freeform reason withheld. Thrown exceptions become `error/unavailable`; their text is never included.

## Budgets, cancellation and late work

Trusted configuration fixes max calls, max concurrency, a **per-call** deadline and maximum exported evidence bytes. Supported hard ceilings are 1000 calls, 32 concurrent calls, 300000ms per call and 4MiB evidence; concrete defaults are 64 calls, 2 concurrent calls, 60000ms and 256KiB. Budgets are part of replay configuration identity.

Caller cancellation and deadlines propagate an `AbortSignal`, return explicit `incomplete/cancelled` or `incomplete/deadline`, and suppress late success/rejection. Monotonic checks also prevent false success after a synchronous adapter blocks past its deadline; the event loop cannot deliver cancellation until synchronous work yields. Timers/listeners are cleaned up when the caller receives a terminal outcome. Concurrency slots remain held until underlying work actually settles: a noncooperative adapter cannot defeat the work bound by timing out repeatedly. Late settlement releases its slot without appending a second trace record. No thread/process termination is promised; a permanently noncooperative adapter can occupy a slot permanently. Call budgets do not silently change AABB, labels, depth or sampling.

Only admitted calls are retained in the bounded run trace. Invalid/stale/duplicate/concurrency/call-budget admission denials are returned to the caller but are not retained as replayable calls. Request IDs cannot be reused within an admitted run. Export requires a published terminal outcome for every admitted call so far (`traceRecords` rejects unpublished calls). The export is a snapshot; later admitted calls require a new snapshot. Export fails explicitly with `EvidenceFailure/export-budget` if a complete snapshot exceeds its configured byte budget; no truncation is represented as complete evidence.

## Default evidence and replay

`redacted-run-evidence-v1` stores schema/tool/code identity, full canonical configuration and hash, prepared asset identity, run ID, canonical calls and records with `status`, `semanticHash`, and bounded numeric timing/available read metrics. It omits observation/cloud arrays, node lists, raw adapter reasons, exception strings and filesystem roots. Explicit fixed coordinate triples/point keys/labels in calls remain necessary for replay; callers must use nonsecret run/request/code identifiers. This is controlled-field redaction, not a general secret detector for arbitrary identifier contents.

Sorted canonical JSON normalizes property ordering and negative zero. Semantic outcome hashes include dataset/frame/revision, observation algorithm/LOD/count/candidate count/sample hash, or verified query/witness/label/domain, algorithm/config identity, matching/category counts and full coverage. They exclude elapsed time, physical read/cache counters, cache identity, traversal/transcript hashes and observation node-read lists. These excluded values describe work, not a different answer. Observation content remains protected through its recomputed sample hash. Verified adapter replies still contain their original validated evidence; redacted traces store its semantic hash instead of dumping it.

Replay:

1. Bounds and validates the entire saved JSON, records, call bindings, unique IDs and config/artifact hash identities.
2. Rejects explicit schema/tool/code/config mismatch or malformed evidence.
3. Verifies all fixed artifact contents **before** creating/executing a runtime.
4. Creates a fresh run and actually reexecutes recorded calls, sequentially in recorded completion order.
5. Compares semantic hashes and statuses; timing/read-work variation does not fail replay.

Saved traces are unsigned: removing records cannot be detected without an authenticated original-run manifest. Replay validates and executes the supplied records; it does not certify original-run completeness or proof of authorship. It must not be described as tamper-proof complete-run evidence.

Statuses include `matched`, `malformed-evidence`, `schema-mismatch`, `tool-mismatch`, `code-mismatch`, `config-mismatch`, `artifact-missing`, `artifact-mismatch`, `cancelled`, `outcome-mismatch` (record ordinal) and `execution-error`. A matched rejected/incomplete/error outcome remains rejected/incomplete/error; matching never promotes it to verified success. Cancellation/deadline/resource outcomes can differ on a subsequent execution and then correctly report `outcome-mismatch`. Replay does not reproduce original concurrent scheduling, elapsed timing, caller abort timing or cache state. Operator-provided `codeVersion` must accurately identify deployed code; this slice validates equality, not a self-derived code/package attestation.

## Artifact preparation and persistence

`prepareReadonlyTools(directory, {codeVersion, budgets?}, signal?)` explicitly reads and binds:

- `manifest.json`
- `octree/metadata.json`
- `octree/hierarchy.bin` (entire file)
- `octree/octree.bin` (entire file)

SHA-256 is streamed with one 64KiB buffer, with abort checks and bounded reads. Identity contains fixed asset names, exact sizes and SHA-256 values; its aggregate digest is SHA-256 of their sorted canonical JSON. Dataset revision remains the existing metadata/root-hierarchy/stat fingerprint, separate from this full content digest. Tests demonstrate a same-size byte change with restored mtime leaves the existing revision unchanged but changes the content digest.

Missing files, symlinked/intermediate-symlinked asset paths, changed/replaced files and cancelled preparation fail explicitly. Ordinary concurrent changes are checked by before/after file descriptors/path stat identities and dataset revision. The operator-selected root is canonicalized at preparation; root paths never enter tool requests or saved traces. Each replay explicitly streams assets again before execution. Normal interactive tool calls do not secretly repeat the whole-cloud hash pass. Semantic index preparation continues to use the existing adapter lifecycle, not a rewritten algorithm.

**Precondition:** preparation, calls and replay use trusted immutable prepared files under trusted configuration. Stat rechecks are not content certification. There is a TOCTOU gap between hashing and later query reads, and no atomic snapshot or adversarial-writer exclusion. This is **not production content-addressed admission**, artifact authentication or source-file archival. Durable traces can replay only while the matching trusted prepared artifacts/configuration/code identity remain available.

`RunEvidenceStore` is a separate operator API, outside the product tool surface. Configure an existing private **canonical, nonsymlinked** directory (use `realpath` for OS-temp aliases). `save(id, text)` validates bounded evidence and a path-free token ID, writes a private exclusive temporary file, fsyncs, atomically renames and fsyncs the directory. It replaces a destination symlink rather than following it. `load/read` reject symlinks, changed/replaced files and oversized/malformed JSON before use. No arbitrary request path or file-read tool exists. Trusted directory ownership is still required; this is not a hostile multiuser storage service.

```ts
// Trusted operator-side composition, not callable through tool arguments.
const prepared = await prepareReadonlyTools(preparedDirectory, { codeVersion: deployedCommitId });
const runtime = prepared.createRuntime('inspection-1');
const reply = await runtime.execute({ schemaVersion: 'spatial-readonly-v1', toolVersion: 'readonly-tools-v1',
  runId: 'inspection-1', requestId: 'metadata-1', binding: prepared.binding,
  tool: 'dataset.metadata', args: {} });
const store = new RunEvidenceStore(privateCanonicalEvidenceDirectory);
await store.save('inspection-1', prepared.exportEvidence(runtime));
const replay = await prepared.replay(await store.load('inspection-1'));
```

## Verification boundary

`tests/tool-protocol.test.ts` covers validation, all-label/domain forwarding, returned data/evidence tampering, budgets, rejection/resource/errors, cancellation/deadline/late work and semantic-vs-read-work hashing. `tests/run-evidence.test.ts` exercises real tiny prepared assets and independent indexed verification for all nine labels, streamed content identities, persisted replay, redaction/export limits, schema/tool/code/config/outcome/artifact tampering and constrained storage.

No browser verification is applicable to these headless-only additions. Exact check results and unresolved graph/fresh-review gates belong to task011; this document does not declare the task complete or independently reviewed.
