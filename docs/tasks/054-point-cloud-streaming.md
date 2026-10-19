# 054 — Point-cloud streaming latency

Status: Reimplemented at user request after task055; fresh-session review pending. No commit requested.

## Reimplementation evidence (2026-10-19)
Reapplied incremental append colors/source IDs and conservative bounds, original-position restoration for overrides, and removal of the active pump's camera-timer gate. No planner, density, budget, concurrency or backend changes; later task053–059 work preserved. Updated browser-script navigation selector to current `Navigation help` copy without removing assertions.

- Focused command: `node --import tsx --test tests/adaptive-display-client.test.ts tests/adaptive-render.test.ts tests/point-override-render.test.ts tests/orbit-focus.test.ts tests/visual-capture.test.ts`:44/44 pass, `/tmp/task054-reimplement-focused-final.log`.
- `pnpm typecheck` and `pnpm build`:pass; `/tmp/task054-reimplement-{typecheck,build}.log`. Final test-only timer adjustment has clean LSP; product unchanged after build.
- Actual-cloud `node --import tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task054-reimplement-browser-final`:13/13 groups pass; `/tmp/task054-reimplement-browser-final.log`.
- `node --import tsx scripts/browser-streaming-profile.mjs http://127.0.0.1:9222 /tmp/task054-reimplement-profile`:pass; `/tmp/task054-reimplement-profile.log`. First pending=0: startup7.56s, frame1.82s, edge focus1.05s, edge zoom1.58s, edge orbit2.39s. Historical baseline below is not a same-session controlled comparison; no new percentage speedup claim.
- Desktop/mobile screenshots and accessibility snapshots saved in those artifact directories; visual human/fresh-session inspection remains pending.
- Initial browser attempt stopped after six groups on obsolete `Navigation & points` selector (`/tmp/task054-reimplement-browser/`); retained as failed evidence. Initial focused run timed out after tests completed with Node22 mocked timers; replaced global timer mocks with a targeted delayed camera timer, then44/44 terminated normally.
- LSP clean for changed TS files; scripts syntax-clean. Scoped `git diff --check`:pass. Renderer diff inspected; full-suite and whole-worktree certification not claimed.
- GitNexus renderer impact LOW; pump HIGH (bind/configure/retry/update), warned before edit and exercised lifecycle regressions. Index one commit stale; source verified. No commit or graph-change certification.
- Handoff: `/tmp/task054-reimplementation-handoff.md`. Fresh-session review and user visual confirmation pending; this is not a promise of instantaneous loading or a new viewport-density fix.

## Historical task054 measurements
The original profiling/evidence below predates task055 and this reimplementation.

## Scope and acceptance
- Profile actual Toronto cloud after camera changes; compare same before/after camera sequence, useful-load and settling times, network and CPU.
- Optimize measured bottlenecks without changing native point identity, exact picks, additive ancestor coverage, revision/lifecycle gates, explicit errors or hard 3M resident-point ceiling.
- Bound in-flight/transient memory; retain desktop/mobile behavior; add regression tests and record evidence.
- Preserve unrelated dirty tasks047–053 and operator sandbox configuration.

## Findings and implementation
Backend read-only investigation used an isolated ephemeral loopback server and actual data. Warm node HTTP requests ~3–17ms; 60 nodes/215k points serial190ms vs two lanes150ms. Three lanes reject429: the backend has a shared two-request admission limit. No evidence that hardware alone explains the delay. Backend unchanged; adaptive loading remains a single physical lane even when cancellation is ignored, leaving room for other dataset operations.

Browser CPU profiling revealed repeated reconstruction/recoloring/bounding scans of whole131k-point batches on small-node arrivals. `apps/web/src/adaptive-render.ts` now appends new color/source-ID spans and incrementally extends source-only conservative bounds, with a constant-time box-derived sphere. Original positions still restore by typed-array copy before override re-registration (unregister leaves modified attributes behind). Full reconstruction remains for eviction, repacking and rollback. Upload ranges preserve pending recolors. API, provenance cache, packing and point budget unchanged.

`apps/web/src/adaptive-display.ts`: remove the camera-timer gate from the active request pump. An active serial lane keeps progressing during camera damping; latest-view replanning before admission still prevents stale chunks/overspending. Idle planning retains150ms throttle, no new concurrency/cache/retries. Regression freezes the camera timer while useful parent-before-child requests finish serially; existing artifact/config/camera/disposal and latched-failure tests remain.

New `scripts/browser-streaming-profile.mjs` reuses task053's actual-cloud navigation sequence with CDP CPU profiling, node-resource timings,250ms point/pending samples and separate plan-completion/camera-settle measures. Owns ephemeral backend/preview and one tab in existing Chrome; no provider calls/operator-server edits. Profiler shutdown failure cannot bypass report saving/cleanup.

## Measured evidence
All times seconds; profile overhead included,250ms polling uncertainty. These are local observations, not a controlled benchmark or hardware-independent guarantee. Baseline and optimized runs reached identical final node sets/point counts in each phase.

| Phase | Baseline first pending=0 | Render-only | Final run1 | Final confirmation |
| --- | ---: | ---: | ---: | ---: |
| Startup3M/801 nodes | 9.83 | 8.11 | 7.12 | 9.51 |
| Frame dataset | 2.36 | 1.82 | 1.82 | 2.39 |
| Edge focus | 1.04 | 1.05 | 1.04 | 1.33 |
| Edge zoom | 2.38 | 1.56 | 1.56 | 2.14 |
| Edge orbit | 6.51 | 4.43 | 2.41 | 4.09 |

Orbit useful loading improves37–63% across the two optimized observations; edge zoom10–34%. Startup/frame/focus are variable, so no universal speedup claimed. First visible node changes after movements remain around0.27–0.31s (polling-limited); no first-feedback speedup established. Full orbit camera-settling remains6.12–6.51s vs7.33s baseline: OrbitControls damping continues well after pending reaches0 and is not loading latency. Off-center zoom/mobile need no additional nodes in this sequence.

Baseline884 completed native-resource observations averaged6.0ms responseEnd. CPU whole-sequence sampled self time in rebuild/recolor/sphere scanning drops sharply (e.g. rebuild~0.99s→0.20s, recolor~0.74s→0.064s in first final run); demand render work also drops. Planning remains measurable (~0.68s total); not optimized speculatively.

Artifacts:
- `/tmp/task054-before/{report.json,cpu.json,desktop.png,mobile.png,desktop.ax.txt,mobile.ax.txt}`
- `/tmp/task054-after-render/`, `/tmp/task054-after-flow/`, `/tmp/task054-after-confirm2/`: corresponding measurements/screenshots.
- `/tmp/task054-regression/report.json`:13 actual-cloud regression groups, exact picking/native source payload comparison, bounds/drawcalls, idle, controls, shrink, capture, manual crop, explicit503/retry, cancellation, legacy fallback and mobile input/layout pass.
- Desktop/mobile screenshots visually inspected: cloud and restrained controls present; responsive chat overlay unchanged; no UI added.

## Verification
- `node --import tsx --test tests/adaptive-display-client.test.ts tests/adaptive-render.test.ts tests/point-override-render.test.ts tests/orbit-focus.test.ts tests/visual-capture.test.ts`:43/43 pass, `/tmp/task054-focused-final.log`.
- `pnpm typecheck`:pass, zero Svelte warnings/errors, `/tmp/task054-typecheck.log`.
- `pnpm build`:pass before baseline and each production change; final production build `/tmp/task054-build-flow.log`.
- `node --import tsx scripts/browser-streaming-profile.mjs http://127.0.0.1:9222 /tmp/task054-before`:pass. Same command after render and final changes at artifact paths above:pass.
- `node --import tsx scripts/browser-adaptive-display-smoke.mjs http://127.0.0.1:9222 /tmp/task054-regression`:13/13 groups pass, `/tmp/task054-browser-regression.log`.
- Final profiler/cleanup-script revision rerun `/tmp/task054-after-confirm2`:pass; `/tmp/task054-browser-confirm2.log`.
- One intervening confirmation failed with CDP target/page closed during Profiler.stop, `/tmp/task054-browser-confirm.log`; cause unproven. Original finally let profiler failure bypass artifact save. Fixed report/cleanup handling, then successful unchanged-product rerun. Retain failed evidence, do not classify as passing.
- LSP diagnostics clean on changed TypeScript/test files and profiling script. Scoped `git diff --check`:pass; scoped actual diff inspected against pre-existing task053 edits.
- Full suite not rerun: task053 records926/931 with five pre-existing task052 failures; this task does not claim a full-suite pass.

## Graph / remaining review
Repo-local cad-agent index (2026-10-19 01:12, commit6f9fce4), source verified; createAdaptiveDisplay/createAdaptiveRender impacts LOW. Nested pump impact HIGH (bind/configure/retry/update processes); warned before edit and exercised lifecycle tests. New nested append helper not previously indexed. Entire checkout includes many unrelated tasks: `detect-changes --scope all --repo .` reports75 files/799 symbols/189 processes, CRITICAL; expanded `--limit 5000` rerun still console-elides listings. `/tmp/task054-graph-changes.json` (human CLI output) and `/tmp/task054-graph-changes-expanded.txt`; not clean whole-worktree graph certification. No commit made.

Remaining: fresh-session review against this task and actual scoped diff. Backend decode/metadata/catalog optimization, parallel lanes and camera damping redesign intentionally out of scope. Useful loading is improved, not instantaneous; host variance and still-serial hundreds-of-nodes startup remain limitations.
