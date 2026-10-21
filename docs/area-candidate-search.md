# Large-area candidate points (Task065)

## Try it in the product

1. Use Node 22 and pinned pnpm; run `pnpm dev` (restart an existing backend so it loads the new tool). Open **http://127.0.0.1:5173** in Toronto3D mode.
2. Start with no accepted point/CAD edits or pending proposals. Undo accepted edits if possible, otherwise restart the volatile backend and reload. Do not select an equipment box or source point first.
3. Navigate to a populated street stretch and **Shift-drag a large area**, about **100×100m** or a similarly sized rectangle. Wait for its snapshot. Selection is an XY footprint across all elevations, not a terrain plane. The existing scene-navigation controls and Frame dataset are under Scene tools.
4. Configure/select your product provider model. Sending chat uses that provider normally; **development checks below do not use paid inference**. Send:

   > Scan this entire large area and suggest up to five candidate POINT locations on relatively level observed ground, away from observed obstacles. Use exploratory preferences: 2m spacing, 0.5m obstacle-screening radius, at most 0.25m observed ground relief, zero minimum pole separation, flat-ground ranking. Show numbered points and evidence; do not create geometry.

5. **`scene.scan_area_candidates`** returns a retained **provisional evidence pool**, not final recommendations. `maxCandidates` (1–20) bounds this numerical pool; it is not a requirement to return five final points. The model requests the returned **`candidateAssessmentCapture`** through `scene.capture_scene`: an explicit RGB plan camera frames the evidence points without changing your viewport. Only a delivered image with nearby displayed source geometry can supply a same-turn `candidateCaptureId`. The model then calls **`scene.finalize_area_candidates`** to select a subset, choose its order/count, and explain each location and its uncertainties. The scene relabels **C1–Cn** in that model-selected order; the compact list distinguishes **Provisional locations** from **Model-assessed locations**. No image/useful rendered context means evidence stays provisional, not visually assessed. Click a point to focus it; expand **Scan evidence** for coordinates, coverage, resolution and uncertainty. Changing the area or geometry invalidates results. Neither scanning nor finalization creates CAD/point proposals.
6. Ask follow-ups such as “Compare these points visually in RGB” or “Rescan preferring locations farther from observed poles.” A later explicit geometry request uses the existing proposal tools and individual human Accept/Decline; a search marker is not an authored object or original source-record reference.

The evidence pool remains a bounded numerical search, not exhaustive alternative generation or a learned driveway/sidewalk classifier. Image receipts enforce actual image delivery and visible nearby source context, not correctness of the model’s subjective reasoning. Capture may be unavailable when the displayed source layers do not cover the requested area; load relevant scene context and retry rather than accepting a pins-only assessment. See [task066](tasks/066-model-led-candidate-judgement.md).

The model may disclose other exploratory preferences derived from your intent; it should not require box dimensions for point discovery. Model adherence with your configured live model is **not certified**: development uses a deterministic mocked provider.

## Reproducible no-inference acceptance

```sh
pnpm typecheck
pnpm build
node --import tsx --test tests/placement/area-candidate*.test.ts
node --import tsx scripts/check-area-candidates.ts --synthetic-only
node --import tsx scripts/check-area-candidates.ts
node --import tsx scripts/browser-area-candidates-smoke.mjs /tmp/task065-browser-local
```

The actual-source command requires prepared Toronto data; browser smoke requires local Chrome (macOS default executable; override `CHROME_PATH`). It starts its own ephemeral backend/project/source, Vite and headless Chrome, with **only provider transport mocked**. It does not touch production listeners. AOI selection is seeded via a fixture-only Vite callback; the Shift-drag gesture itself is not tested by this script. Desktop/mobile chat→tool→real 1ha scan→numbered scene points→capture→selection→AOI invalidation are exercised, with authority snapshots proving no proposals/edits.

## Measured scale and limits

- Actual Toronto **100×100m**, local XY `(250,400)` through `(350,500)`: five candidates in **5.25s**, with 48,022,098 original records examined once across 11,725 relevant pages; 34,072,026 observations within the AOI. Existing semantic cache loaded; **cold real-data cache preparation is unmeasured**. This region is a reproducible engine benchmark, not an automatic camera-navigation command.
- Synthetic **100×100m /120,000 records**: five candidates in **42ms**. Timings are local examples, not latency promises.
- One-pass complete relevant original-source reduction, not capped AOI witnesses. No terrain preprocessing or equipment proposal prerequisite. Semantic disk cache may be prepared if missing.
- Grid resolution, candidate spacing, full observed ground relief/support counts and conservative obstacle screening are explicit. Every relevant support cell needs three Ground/Road_markings observations. Missing support, obstacles at any elevation and AOI boundary slivers reject candidates.
- Pole values are **conservative lower bounds** to nearest observed Pole points globally, including outside the AOI; uncertainty is at most one grid-cell diagonal. They are not exact fitted-pole boundaries. Null means no Pole observations exist.
- Observed-point screening does **not** verify physical free space, continuous support, equipment fit, foundation design, utilities, access rights, safety or code compliance. No learned driveway/sidewalk classifier exists; visual observations remain qualitative.
- Budgets: 120s including index preparation, 100,000 pages, 250,000 area cells and 250,000 occupied pole cells. One scan per shared authority at a time. Exhaustion/cancellation/staleness publishes no partial shortlist. A broad AOI with no supported observations legitimately returns no candidates; do not treat it as free space or silently replace it with a tiny-patch search.

[Task evidence](tasks/065-large-area-candidate-points.md) · [engine algorithm/measurements](area-candidate-engine-evidence.md) · [separate equipment-fit groundwork](placement-search.md).
