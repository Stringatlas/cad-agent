# 006 — Headless closest Pole-labelled point

Status: Implemented and verified; user authorized the first slice with “Proceed”. **Fresh-session review pending.**

## Scope

Implement the first slice of [the architecture plan](../plans/2026-10-13-closest-pole-harness.md): explicit coordinate/point-reference input, 3D Euclidean distance, whole prepared dataset or explicit inclusive AABB, deterministic provenance ties, full hierarchy scan and independent linear-record verification. Headless local invocation only; no HTTP/UI/model integration, spatial pruning, dataset regeneration, crop/LOD changes, CAD or project mutations.

## Acceptance criteria

- [x] Validated dataset/revision/frame/filter/domain/input contracts and deterministic tool executor.
- [x] Exhaustive semantic adapter covers ancestor/descendant payloads, proxies and all file ranges; bounded reads and constant point working memory with no total work/time/point caps.
- [x] Independent verifier resolves input, decodes/scans records and rejects altered answers; no partial/stale/cancelled certification.
- [x] Independent fixtures cover nearest/ties/no match, class/region boundaries, missed samples/deep proxies, malformed data, resolution, cancellation/resource/stale failures and cleanup.
- [x] Complete recorded actual-data AABB check with full linear oracle, artifact digests, raw witness tolerance and unchanged sampled display/harness evidence.
- [x] Focused/regression checks and `pnpm verify`; actual diff inspected, exact commands/logs and redacted OS-temp handoff recorded; fresh-session review pending.

## Checkpoints

Baseline: `fb5c777`, only the previously authored plan untracked. Node22.23.3 / pnpm10.34.6 available; existing dependencies used. GitNexus concept query and upstream impacts for `parseMetadata`, `decodePoint`, `PotreeDataset`, `PointObservationSource` unavailable with LadybugDB read-only recovery error; risk UNKNOWN, callers/processes unresolved. Source confirms decoder/metadata users in existing Potree adapter, observation/crop fixtures and scripts. Existing symbols will remain unchanged; additive contracts/exports and separate semantic adapter only. No index regeneration or commit planned. Earlier review statuses remain separate.

## Implementation

New contracts/assertions/canonical requests and harness query/verifier interfaces with `executeNearestPole`. Separate server `SemanticArtifact` snapshot, `PotreeSemanticSource`, `LinearRecordVerifier` and `queryClosestPole` composition. Local callers supply a trusted dataset directory separately from the validated tool request; no request path/HTTP endpoint is exposed. [Invocation and semantics](../closest-pole-query.md).

Search follows all hierarchy chunks/payloads with full range/count coverage; verifier independently parses and linearly scans physical records, counts hierarchy records for evidence comparison and checks canonical query input/winner/class/distance/counts/binding. Both paths share opened files and safe reads, not decoding/reduction/traversal. Canonical request copies protect against caller mutation. Abort checks after adapter/verifier prevent late publication even if an operation ignores cancellation. Source/progress failures and stale bindings cannot certify.

No spatial pruning/model/UI/session/HTTP/CAD changes; no total point/work/time caps, downsampling, new dependencies or data regeneration. Existing `potree.ts`, `crop.ts`, route handlers, observation algorithms, all web files, geometry and project-state remain byte-for-byte unchanged. Ordinary LOD and uncapped progressive display regressions passed. Tree-shaken web bundle remains 622.06kB with its existing warning; no browser verification is claimed.

## Exact verification and artifacts

| Command / check | Result | Artifact |
| --- | --- | --- |
| `pnpm exec tsx --test tests/semantic-query.test.ts tests/observation.test.ts tests/crop.test.ts tests/crop-concurrency.test.ts tests/crop-feedback.test.ts` | PASS34/34; 10 semantic cases including depth6/unsupported depth25, adjacent binary64 distances, large >4MiB node/160001 records, malformed data, verifier tampering, cancellation and existing crop/LOD regressions. Later injected ENOMEM/EIO assertions passed in final full suite. | `artifacts/closest-pole/focused-tests.log` |
| `pnpm exec tsx scripts/check-closest-pole.ts` | PASS; finalized actual artifact query/repeat, independent full scans, raw witness, unchanged samples and full prepared-artifact digests. | `artifacts/closest-pole/actual-data.log`, `actual-data.json` |
| `pnpm verify` | PASS43/43; typechecks, Svelte0 errors/warnings, web build/server typecheck. Existing >500KiB bundle warning remains. | `artifacts/closest-pole/verify.log` |
| `git diff --check`; per-new-file `git diff --no-index --check /dev/null <path>`; owned-diff/source inspection; local documentation links | PASS whitespace/links/scope; no-index exit1 means additions. Includes untracked files rather than trusting tracked diff alone. | `artifacts/closest-pole/change-inspection.log`, `owned-files.patch` |
| GitNexus final concept query/upstream `impact(queryClosestPole)`/`detect_changes(scope:all)` | UNAVAILABLE same LadybugDB read-only recovery. Risk UNKNOWN, graph callers/processes unresolved, not a clean graph check. No index rebuild or commit. | `artifacts/closest-pole/graph-status.json` |
| Browser checks | NOT RUN: headless change, no rendering/interaction changes. User's prior task005 browser confirmation remains separate from automated evidence. | Not applicable to this slice |

Initial sandbox `tsx` attempt failed at IPC `listen EPERM`; escalation permitted test execution with required local IPC/loopback sockets. `focused-initial.log` retains that infrastructure failure. Initial typecheck caught a domain-narrowing issue; corrected by capturing the immutable domain. `typecheck-initial.log` retains it. The fixture's deliberate mutation cast was corrected; final `pnpm verify` typechecks the test and actual-data script. Intermediate successful baseline/actual-data runs were superseded by final evidence after hierarchy/physical-read diagnostics and extra regression assertions. No acceptance criterion was weakened.

## Actual-data scope and result

Canonical coordinate `q = [164.16,808.845,141.097]`; inclusive AABB min `[161.66,806.345,138.597]`, max `[166.66,811.345,143.597]`, all in local meters. Seed is the smallest source key among Pole points in the complete root payload, offset by `[0.25,0.25,0]`; exact seed/request/revision/code hash in report.

Both paths scanned **78,320,210 points** and found **2409 Pole-labelled points in that AABB**. Winner `(sourceFileId=1, sourceRow=846038)`, prepared position `[163.942,808.7650000000001,141.059]`, `distanceSquared=0.05536799999998453`, distance **0.23530405861349804m**. Search visited8242 hierarchy chunks and28835 nonempty payload nodes. Search and verifier each read4,307,611,550 payload bytes; concrete total physical reads include8,615,223,100 payload bytes,1,701,612 hierarchy bytes and68,110 metadata bytes. Largest read4,194,300 bytes, below4MiB. Repeat output/evidence exactly equal. Final first/repeat latencies38.678s /35.762s on this local run; not an interactive SLA or RSS measurement.

The original PLY winner label is6; maximum per-axis prepared/raw error0.000997558594m, within recorded0.0015m tolerance. Artifact digests include full hierarchy/payload; verifier transcript SHA256 equals independently streamed full payload SHA256. Display/harness observations before/after exactly equal. This is an exact **region** result using whole-source reads, not a measured whole-dataset nearest-query audit or rerun of the preprocessing audit.

## Limits / next action

No known failing runtime acceptance checks. GitNexus graph verification remains unavailable; source/diff inspection and passing tests do not make it a graph all-clear. Verification assumes immutable trusted artifacts and the earlier provenance/fidelity audit; the stat/root fingerprint does not prove adversarial integrity. Point-reference queries use extra full resolution passes; spatial pruning/latency optimization remains deferred.

Next bounded action: **fresh-session review of task006 against the actual source/diff and evidence**, before wider HTTP/UI/model stages. Earlier tasks001–004 reviews remain pending. No commits/deployments made. Redacted OS-temp handoff: `/tmp/spatial-cad-closest-pole-implementation-handoff.md`.
