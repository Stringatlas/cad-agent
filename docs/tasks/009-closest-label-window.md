# 009 — Closest semantic label and Shift window

Status: Implemented and verified; fresh-session review pending.

## Scope
User requested Shift window selection in the Closest Pole tab and generalization to `Closest: xyz` with selectable data type. After `Proceed`, use Toronto3D semantic categories (0–8, default Pole) and preserve whole-dataset search: Shift-drag loads a frozen projected full-resolution display window for accurate provenance-based picking, not a query-domain restriction. No CAD edits or model loop.

## Acceptance criteria
- Closest tab offers all nine prepared Toronto3D semantic categories, with Pole default. Selected category binds request, search, verification, result validation and caches; changing category cancels/requeries without stale results.
- Exact indexed nearest search and independent verification support each category, reject invalid labels, and preserve revision/provenance/evidence safety. Existing Pole clients remain compatible.
- Shift-drag in Closest tab progressively loads every point in a frozen camera volume with cancel/clear/retry and explicit incomplete/resource states. No sampling or total cap is introduced.
- Cmd/Ctrl-click can pick detail or overview using original binary64 position and source provenance, never GPU coordinates. Shift takes precedence. Window display does not restrict search.
- Disposal, supersession and revision changes invalidate detail/query caches safely. Existing demo and Toronto preview behavior remain intact.
- Typecheck, tests, build and existing-Chrome interaction checks recorded with exact evidence; no new Chrome launch, commit or graph rebuild. Review remains pending.

## Delegation
Backend agent: shared semantic contracts and category-bound index/query/verifier/routes plus deterministic tests. Window agent: crop provenance contract, server decode/stream and client validation plus tests. Parent: Closest UI/channel, viewer detail picking, integration verification and docs. Files are partitioned; shared export file coordinated.

## Completed
All acceptance criteria implemented. Shared labels0–8 bind exact search, independent verification, witness validation and category caches; `/closest-label` added and legacy `/closest-pole` enforces6. Deliberate96MiB category/192MiB spatial bounds use exact exhaustive fallback (histograms are only allocation hints), never sampling. Original names retained for compatibility. Crop batches carry provenance, and bounded per-chunk pick caches retain original binary64 positions. Window loading and query channels are independent; display revision changes clear stale detail. Initial working tree was clean; prior task history preserved.

## Verification
- `pnpm verify > /tmp/task009-final-verify.log 2>&1` — PASS: all workspace/tests typechecks, Svelte0 errors/0 warnings,78/78 tests, build. Existing Vite650.33kB JS chunk warning remains.
- TypeScript workspace/changed-file LSP clean; Svelte LSP unavailable, checked by `svelte-check` in baseline. `git diff --check` PASS; implementation diff inspected for unintended changes.
- `node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 > /tmp/task009-final-browser.log 2>&1` — PASS nine checks against actual prepared data/built UI/existing Chrome. Evidence: `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/spatial-task009-browser-1Xi941/` contains `report.json`, `console.json`, `network.json`, query/crop NDJSON and screenshots `detail-verified.png`, `narrow-window.png`, `demo-regression.png`. Screenshot visually inspected. No console/page errors. Pole/Fence verified; exact detail position/source key matched server resolution; Shift precedence, frozen volume orbit/clear/reload, cancellation/late batches, whole-dataset binding, category supersession, LOD/resize/Toronto/demo/disposal/remount passed. One unchanged real response was held only for deterministic crop cancellation, excluded from timings. Instrumented verified UI queries219–508ms (not percentile/cold benchmarks). Two-point small window completion checked; existing tests retain uncapped traversal coverage.
- First strict browser attempt failed due numeric label/string option mismatch (blank default selector); fixed with numeric option values and final strict run passed. Failure retained at `/tmp/spatial-task009-browser.ITNVBs/`; prior diagnostic-only run is not acceptance evidence.
- GitNexus query/impact/detect_changes attempts all blocked by LadybugDB shadow replay; risk remains UNKNOWN, not low. Source callers/contracts inspected instead; no graph rebuild or commit. Before a future commit/review, repair graph availability and rerun analysis.
- Own temporary ports3002/4175 and script tab cleaned; user's3001 server untouched, no Chrome launch.

## Remaining limitations / next action
Large categories are correct by exhaustive fixture coverage but may be slow: actual Ground cancellation/supersession verified, not production Ground completion/latency; all-category production performance remains unmeasured. Uncapped detail CPU/GPU memory can exhaust resources with explicit incomplete states. Category caches have no automatic persistent-disk eviction. Existing Pole cache identity changes once to include label.

Next: fresh-session review against this task and actual diff, including category-bound fallback, crop revision/provenance, gesture invalidation/disposal and tests. This implementation does not approve tasks006–008 or earlier work.
