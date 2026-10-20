# Task066 — isolated browser evidence

## Result

Mock-provider browser acceptance passed on desktop **1440×900** and mobile **390×844**, with both five- and three-point numerical evidence pools. The mock model explicitly chooses original pool IDs **[third, first]**, publishing only **C1–C2** in that order. This verifies plumbing, not real model judgement quality.

Owned files: `scripts/browser-area-candidates-smoke.mjs` and this evidence document only. No product source edits, commits, paid inference, production listener requests, or existing browser/profile use.

## Commands and artifacts

Node `v22.23.3`, pnpm `10.34.6`. Parent reported `pnpm build` passing before this child ran; the script itself serves Vite source with its fixture-only AOI/capture-failure seam, not the built bundle.

- `node --import tsx scripts/browser-area-candidates-smoke.mjs /tmp/task066-browser-final` — **passed**; log `/tmp/task066-browser-final.log`.
- `AREA_CANDIDATE_COUNT=3 node --import tsx scripts/browser-area-candidates-smoke.mjs /tmp/task066-browser-count3` — **passed**; log `/tmp/task066-browser-count3.log`.
- `node --check scripts/browser-area-candidates-smoke.mjs` — passed.
- `git diff --check` — passed at verification checkpoint.
- LSP diagnostics for the script — clean after each edit.

Each artifact directory contains `report.json`, `actual-provider-bodies.json`, `tool-results.json`, accessibility snapshots, screenshots, current-viewport captures, initial authority snapshots, and exact delivered targeted images `1440-delivered-assessment.jpg` / `390-delivered-assessment.jpg`. Artifacts use synthetic source/images and synthetic test credentials only; no real provider credentials are logged.

## Assertions exercised

- Real chat submission → real server model route/tool transport → complete 100×100m source scan. All four provisional scans per run examined **120,000 source points**, not a capped AOI sample.
- Initial visible heading is **Provisional locations**. Mock transport reads the actual returned `candidateAssessmentCapture` and requests that exact RGB plan camera.
- Real WebGL targeted capture contains the entire provisional candidate pool. Its actual JPEG bytes, matched by **SHA-256** against the capture tool observation, are present in a **later provider request** before the mock calls `finalize_area_candidates`. Initial/user/history images alone cannot satisfy this assertion.
- Model finalization publishes the strict subset **[pool index2, pool index0]** with copied coordinates/IDs, new ranks1–2, rationale and uncertainty. Both scene markers and shortlist follow this order/count; heading becomes **Model-assessed locations**.
- Rationale is visible in each shortlist row; expanding **Scan evidence** exposes both uncertainty strings. C2 selection updates the button and actual scene label highlight.
- Final rendered label rectangles stay on-canvas, outside the shortlist, non-overlapping. Real synchronous WebGL pixels contain readable dark label ink/light backgrounds (not just DOM counts).
- User camera position **and orbit target** are equal before chat and after the targeted capture/finalization; subsequent explicit C2 selection is allowed to navigate.
- CAD/point/object authority snapshots remain byte-for-byte equivalent; no CAD/object proposal UI appears. AOI change removes candidate markers and shortlist.
- Second turn on each viewport injects a fixture-only capture exception. Tool truthfully returns unavailable; chat explains visual assessment unavailable; all numerical candidates remain **Provisional locations**, with no assessed heading or authority mutation. Historical images from the first turn do not cause implicit finalization.
- No page/console errors. Browser/Vite/backend/project/source are owned, headless, ephemeral and cleaned in `finally`; request assertions reject production `:5173` / `:3001`. Existing orphan fixture `:66333` untouched.

## Visual inspection

Inspected actual screenshots and delivered images, not only assertion output:

- `/tmp/task066-browser-final/desktop-03-scene-candidates.png`: readable C1/C2, two rationale rows, expanded uncertainty/evidence. Existing evidence is long only when explicitly expanded.
- `/tmp/task066-browser-final/mobile-03b-selected-C2.png`: readable/non-overlapping C1/C2 above the mobile shortlist; C2 has distinct yellow scene highlight and selected row. Rationale wraps within the viewport; lower evidence continues below the visible portion of the scrollable panel.
- `/tmp/task066-browser-run5/mobile-06-unavailable-scene.png` and `desktop-05-capture-unavailable.png`: explicit provisional/unavailable copy with numerical pool retained. Final run repeats the same asserted states.
- `/tmp/task066-browser-final/1440-delivered-assessment.jpg` and `390-delivered-assessment.jpg`: actual temporary plan view includes labeled evidence points and visible dense synthetic source ground around them, rather than only pins or the unrelated live orbit image.

For the five-point run the capture reports **50,000 displayed original-source points**, with nearby projected source-sample counts **491,589,673,716,716**. The scene remains explicitly sampled/incomplete; this fixture does not certify real Toronto visual completeness, occlusion quality, suitability, clearance or model reasoning. Mobile chat is a deliberate overlay; it must be closed before interacting with the underlying scene shortlist (the test does this rather than forcing clicks through it).

## Harness development / limitations

Early runs exposed harness mistakes, not product failures: eager access to `viewer` before mount initialization; camera diagnostics require `?smoke`; mobile chat intercepted a click on underlying evidence; the unavailable scenario initially used the smaller AOI left by the invalidation check, so its examined count differed. These were corrected by lazy access, enabling smoke diagnostics, closing mobile chat, and explicitly resetting the full1ha AOI. No receipt/context/pixel checks were weakened.

GitNexus impact for the standalone script returned **UNKNOWN / target not found**. Source search confirmed no external callers; the script is an isolated executable CLI fixture. Index uncertainty remains, not a clean graph certification. No commits requested or performed. Script is already untracked in this shared working tree, so its full contents—not only `git diff`—need independent review.

Read installed `browser-policy`, `visual-qa` and `handoff` skills. No installed `pi-browser-harness/SKILL.md` was found in project/user agent skill locations; used the existing project Playwright isolation pattern instead. Headless Playwright owns fresh ephemeral browser state and never steals user focus.

**Next:** parent independent source/script review and fresh-session review remain pending. No live-provider adherence, real production dataset browser run, semantic-cache correctness, or whole-checkout verification is claimed by this evidence.
