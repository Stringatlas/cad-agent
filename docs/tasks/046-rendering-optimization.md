# Task046 — Bounded high-quality point rendering

## Request / acceptance
Optimize slow dynamic rendering in a browser-driven tuning loop for useful VLM imagery. Default native rendering has a hard 3M-point ceiling, tunable downward. Enlarge points to reduce gaps. Preserve exact picking, original source identity, screenshot coverage, human approval, and unrelated dirty work. Compare established renderer techniques; measure load, draw calls and interaction. Desktop/mobile visual and selected/error checks; automated tests/typecheck/build. Fresh review remains separate.

## Plan / delegation
Parent integrates viewer/UI, profiles and iterates in Chrome. Isolated children investigate server costs; implement bounded binary transport, cancellation-safe scheduler, and dense GPU batching with unit tests. Parent runs combined verification and diff/graph review. No commit requested.

## Initial evidence
Legacy default: 3,217,790 crop points +50k overview, 1,240 crop chunks /1,242 GPU geometries; 120-frame idle RAF median16.7ms/p9516.8ms (not GPU time). Baseline screenshot `/tmp/render-optimization/baseline-legacy.jpeg`. Independent adapter diagnostic: 998 nodes/3M points,160MB aggregate JSON; node decoding2.28s, stringify0.961s, parse0.609s, excluding HTTP/GPU (single run, no controlled cache).

## Strategy
Potree's [Retz example](https://potree.org/potree/examples/showcase/retz.html) uses3M points, octree screen-space refinement, adaptive sizes and EDL. Adopt bounded octree selection, compact binary streaming, batching, opaque depth-tested splats and demand rendering first. EDL/multipass reconstruction and inferred surfaces are not implemented: extra fill cost and invented geometry would not repair source scan gaps. Camera-driven native mode becomes default under this newer request; old mode remains explicit opt-out.

## Impact / safety
`createTorontoViewer` UNKNOWN/unresolved Svelte callers: verified Toronto.svelte and ClosestPole.svelte. `createPointOverrideRender` LOW: viewer caller. `createProvenancePickCache` HIGH: overview/detail pick caches, update/appendCrop and HTTP perf flows; warning surfaced before edit. Change only widens typed-array input and preserves copied binary64 authority/validation. Toronto Svelte LOW. Binary export barrel aggregate CRITICAL warning recorded by child; additive exports only. Stale index/untracked symbols limit graph certification.

## Implementation / tuning decision
- Default adaptive mode; maximum resident3M points, quality budgets500k/1M/2M/3M. Independent explicit full-resolution crops remain uncapped, so this is not a whole-viewer memory ceiling.
- Compact bounded binary node transport:34 bytes/source point plus metadata, binary64 positions and exact keys/labels retained. Original JSON inspection route remains. A3M-point payload aggregate is~102MB plus metadata versus the initial~160MB JSON diagnostic (format-size comparison, not a controlled end-to-end speedup).
- Dense131,072-slot GPU batches, normalized byte colors, circular opaque depth-tested splats; immutable native caches resolve exact original picks. Bulk eviction rebuilds each affected batch once with transactional rollback. Single physical streaming lane retains useful in-flight work and replans before admission.
- Demand-driven GPU draws; control/diagnostic RAF still runs. Visual invalidation covers source/quality/scene changes. Async camera-timer renderer failures latch until explicit retry.
- Retain4px default after2/3/4/5/6px ×1M/2M/3M comparison.2px is finer but leaves sparse gaps;6px visibly bloats wires/foliage.4px improves coverage without the worst thickening. Existing scan stripes, occlusion and missing surfaces remain; no geometry is invented. No EDL, Gaussian/elliptical reconstruction or VLM accuracy improvement is claimed.

## Measured browser evidence
Existing Chrome, local warm artifact/server,1440×900 desktop and390×844 mobile. These are single-machine observations, not portable benchmarks.

| Tuned resident points | Logical nodes (same initial pose) | Native batches / draw calls |
| --- | --- | --- |
| 1,000,000 | 173 | 8 / 8 |
| 1,999,999 | 427 | 16 / 16 |
| 3,000,000 | 704 | 23 / 23 |

- First2px observation after each budget change:~2.07/4.36/4.61s respectively, including stability polling,350ms wait and screenshot overhead; subsequent `loadMs` entries are cumulative size-loop time, **not** load latency. Not a cold-start measurement.
- Orbit plus streaming/settle:13.39s;790 RAF samples median16.7ms/p9517.6ms, five main-thread long tasks50–76ms. RAF timing is **not** GPU frame time or guaranteed FPS. Zoom settles at3M/655 nodes/23 draws.
- Settled2.2s idle: renderedFrames1314→1314, no draws. Built smoke independently verifies no new requests or frames while idle.
- Review caught per-node eviction rebuilds. Synthetic3M/1000-node alternating-half eviction improved2560ms→48ms,998→12 registrations; full eviction0.53ms/zero rebuilds. Synthetic CPU probe, not measured browser interaction latency.
- Tuning report and15 same-pose comparison PNGs: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/task046-tuning/` (`report.json`, `budget-*-size-*.png`, orbit/zoom/mobile images). Replay source: `/tmp/task046-tuning-replay.cjs` (browser-run-script needs an allowed path).
- Visually inspected3M2/4/6px, selected desktop, mobile framed scene and near street. Near-street mobile/chat closed: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/pi-browser-screenshot-pi-nnpmhna1-e47f63de-ac5f-4f53-8c69-1709eae63925.jpeg`. Road is legible; wires/foliage remain noisy. No new persistent overlays.

## Verification / review
- Node22/pnpm10.34.6: **`pnpm verify` passed807/807 tests, typecheck and build**; `/tmp/task046-verify-final.log`. Existing bundle-size warning remains. An earlier suite run hit a semantic disk-storage cancellation-cleanup flake; isolated7/7 and two subsequent full runs passed. Parent shell cannot access pinned Node under sandbox; isolated child executed verification.
- Built actual-cloud smoke: `pnpm exec tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task046-browser-verified` **passed all13 checks**; `/tmp/task046-browser-verified.log`, report/AX/PNGs in that directory. Checks cover default binary ceiling/batching,2/6/4px redraw without refetch, idle, orbit/zoom, budget shrink, quality changes, capture coverage/staleness, exact picking/semantic label vs independent JSON, route guards, independent manual crop, injected503 latch/retry, mobile hit-testing/no overflow, legacy fallback and rapid on/off cleanup. No page errors; only console error is intentional503 fixture. No provider calls.
- Earlier browser attempt failed an obsolete historical capture-status string; corrected assertion now verifies current text **and** stale resolution/disabled preview. Another attempt lost its viewer during zoom with unexplained closest-label requests; a repeat and the final rebuilt run passed unchanged. Cause unresolved; do not present earlier attempts as passing.
- Independent source review found/fixed bulk eviction stall; follow-up review found/fixed uncaught camera-timer eviction failure. Focused tests verify rollback, retained provenance, atomic residency, error latch and retry. Final read-only child inspection found no further confirmed defects. **Fresh-session integrated review remains pending.**
- LSP clean for changed implementation/smoke files; `git diff --check` passed. Full aggregate diff includes extensive unrelated tasks040–045/operator changes; those were preserved.
- GitNexus complete raw backend change report `/tmp/task046-graph-final.json`:43 tracked files/188 symbols/140 affected flows, aggregate **CRITICAL**. CLI abridged output retained at `/tmp/task046-graph-final.cli.txt`; MCP output truncation was not accepted as clearance. Raw report has no partial/truncated fields, but stale graph omits new untracked adaptive symbols. Source/test review supplements UNKNOWN results; **not graph certification**. No commit.

## Status / next action
Implementation and requested long browser tuning/acceptance loop complete. Remaining limitations: occasional streaming long tasks, full-dataset framing still visually noisy, source gaps/occlusions, independent uncapped crops, no controlled cold-start/VLM benchmark. Next: fresh-session review scoped to task046 against actual combined diff and above artifacts; preserve unrelated work. No outstanding reproducible acceptance failure.
