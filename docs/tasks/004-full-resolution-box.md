# 004 — Full-resolution display inside a selectable box

Status: Historical implementation; total crop caps superseded by task005; browser verification/fresh-session review pending

**User supersession:** [task005](005-projected-full-resolution.md) removes arbitrary total crop point/source-work/deadline limits and adds projected Shift-drag progressive display. The cap/rejection/API/hash descriptions and evidence below describe task004's historical implementation, not the current service. Ordinary display/harness LOD limits remain unchanged.

## Scope
Add a local-meter Z-up axis-aligned selection box to Toronto3D, retaining the overview. Load **every** stored point within the inclusive box across all intersecting octree levels/proxy chunks. Display only: harness LOD, sample and settings remain independent. No raw/prepared data changes, model/CAD work, deployment, commits or index regeneration.

## Acceptance criteria
- [ ] Visible box with editable center/dimensions and practical view-based placement; explicit load, loading/count/error/reset controls and documented interaction. Implemented, but actual visual/interaction verification is blocked below.
- [x] Full-resolution spatial query includes ancestor and descendant payloads and hierarchy proxies, with inclusive boundary filtering; never silently downsamples.
- [x] Strict bounds validation, fixed local endpoint/assets, concurrency/cancellation, bounded hierarchy/source work, output and allocations. Oversized selections fail explicitly with shrink guidance.
- [x] Fixture tests cover proxy traversal, boundaries, malformed input/caps and async stale/disposal behavior; harness independence preserved.
- [x] `pnpm verify` and bounded actual-artifact integration recorded with point/source byte counts.
- [x] Browser script exercises box/full-resolution/independence; actual browser attempt honestly blocked. Browser assertions/visual inspection are NOT passing evidence.
- [x] Owned changes inspected; docs/evidence and OS-temp handoff saved; fresh-session review remains pending.

## Implementation

Implementation owner: delegated continuation agent (preserved interrupted agent's existing crop work). Review owner: unassigned fresh session.

- Yellow wireframe axis-aligned box in local meters; editable center/XYZ dimensions, Shift-click visible-point placement, Box at view target, Frame box, explicit Load, Clear, loading/count/empty/error states. Editing cancels and clears old detail immediately. Loaded detail uses independent GPU buffers; dim overview remains for context. Switching scenes aborts three channels and disposes resources. This is display selection state, not a CAD/project box edit.
- Shared crop contract and fixed read-only `/datasets/toronto3d/crop` endpoint. Separate `PotreeDataset.crop()` query follows nested intersecting proxies across all stored levels, including coarse ancestor payloads; proxy records are not point payloads. Conservative one-quantization-step pruning, exact inclusive membership, overlap/cycle/proxy/root checks. Successful results are complete, with no budget sampling.
- ≤100k complete points; ≤64 MiB hierarchy/payload source work, 4 MiB/node, 1 MiB hierarchy, 64 KiB/chunk, 32,768 records, 512 chunks, depth24, processing checkpoints/deadline10s. Sequential node reads, bounded planning/output arrays, shared two-operation/no-queue cap, cancellation and 16 MiB browser response cap. Oversized/work-expensive boxes return 413 with shrink guidance and no partial arrays. Metadata reads are separately bounded; already-running OS reads are not forcibly timed out. Caps are algorithmic, not an RSS measurement.
- Harness sampler, settings, sample algorithm and product-agent boundary unchanged. Fixture and actual integration compare harness observations before/after crop activity. Existing sampled LOD endpoints still use first hierarchy chunk/depth0–3; only crop follows deeper proxies.
- Tests: eight crop fixture/client/render tests plus shared crop/harness concurrency test. Browser smoke extended for visible box, Shift-click/numeric placement, 10,914-point detail, frame/edit/clear, oversized rejection and independence. Run instructions and precise semantics in `README.md`, `docs/web-preview-lod.md`, `docs/architecture.md`.

## Actual prepared-data evidence

Three 5 m cubic queries centered on root points (all counts complete, not samples):

| Center (local meters) | Returned points | Source bytes | Scanned points | Hierarchy chunks / max payload depth |
| --- | ---: | ---: | ---: | --- |
| `[243.786, 243.429, 141.267]` | 11 | 402,721 | 7,287 | 1 / 2 |
| `[348.577, 97.573, 150.579]` | 1,427 | 3,118,489 | 56,525 | 2 / 6 |
| `[278.715, 505.852, 139.662]` | 10,914 | 11,637,164 | 211,426 | 11 / 9 |

Nested 2 m box counts: 6 / 279 / 1,420; each exactly equals filtering the respective complete 5 m box's ordered XYZ/RGB. Third nested crop reads 9,499,787 bytes. Repeat hashes identical. Whole-dataset bounds rejected with `CropLimitError`, not truncated. Harness before/after exactly equal. Fixed-route HTTP result equals adapter hash (first crop JSON 1,109 bytes). Full report: `artifacts/full-resolution-box/actual-crops.json`. This bounded integration is not a replacement full-dataset preprocessing audit or independent exhaustive correctness proof.

## Verification evidence

Node22.23.3, pnpm10.34.6; no installs or dataset/tooling changes.

| Exact command | Result | Evidence |
| --- | --- | --- |
| `pnpm verify` | PASS: all typechecks, Svelte0 errors/0 warnings, 26/26 tests, web build/server typecheck. Existing >500kB bundle warning retained (613.31kB JS). | `artifacts/full-resolution-box/verify.log` |
| `pnpm exec tsx scripts/check-toronto-crop.ts` | PASS: nested proxies through depth9, inclusive filtering, repeat/nested equality, bounded bytes, oversized rejection and harness independence, HTTP/adapter equality | `artifacts/full-resolution-box/actual-crops.log`, `actual-crops.json` |
| `pnpm exec tsx scripts/check-toronto-preview.ts` | PASS: prior sampled LOD/harness actual-data regression checks unchanged | `artifacts/full-resolution-box/preview-regression.log`; existing `artifacts/toronto-preview/actual-samples.json` |
| `node --check scripts/browser-toronto-smoke.mjs` | PASS syntax only, not browser behavior | `artifacts/full-resolution-box/browser-syntax.log` |
| `node scripts/browser-toronto-smoke.mjs` | BLOCKED/nonzero: `ECONNREFUSED 127.0.0.1:9222`; no browser assertions, console or screenshots completed | `artifacts/full-resolution-box/browser.log`, `artifacts/toronto-preview/browser/report.json` |
| `pnpm verify:browser` | BLOCKED/nonzero: same CDP refusal | `artifacts/full-resolution-box/demo-browser.log`, `artifacts/browser/report.json` |
| GitNexus upstream impact `createTorontoViewer`, `readFullResolutionCrop`; `detect_changes(scope: all)` | UNAVAILABLE: LadybugDB read-only shadow-page recovery error; risk UNKNOWN, callers/processes unresolved, not low risk | Tool result; manual source confirmation below |
| `git diff --no-index --check /dev/null <owned-file>` for 18 owned files | PASS whitespace checks, includes untracked files; ordinary `git diff` empty because baseline untracked | `artifacts/full-resolution-box/change-inspection.txt`, `owned-files.patch` |

Browser skill inspected. No browser tools/setup callable by this child; `/tmp/pi-browser-daemon.sock` absent. Parent's prior setup failed daemon startup. Existing Chrome was not launched/installed. Visual framing, Shift-click, UI events and actual GPU lifecycle remain unverified; script coverage is ready for connected Chrome.

Graph is unavailable, not an all-clear. After failed impacts, manual source search/read confirms `createTorontoViewer` is called only by `Toronto.svelte`; `readFullResolutionCrop` by `PotreeDataset.crop` plus fixture tests; crop route by server route dispatcher; crop channel/render helper by Toronto/viewer plus tests. Integration/browser scripts are relevant verification callers. Shared contracts flow to web/server without framework/kernel imports. Harness `observe` still delegates to `sample(lod, 'harness')`; crop never routes through it. No commit/index regeneration attempted. Full owned source was inspected including untracked files, and unrelated demo/project-state/geometry/agent-harness sources were not edited by the continuation.

## Review / next action

Fresh-session review pending; implementation does not approve tasks001–003. Connect existing Chrome CDP, rerun built browser checks and inspect `full-resolution-box.png` plus console; then review actual source/owned files against this task, especially hierarchy correctness, fixed limits and channel independence. Stop dev servers first (browser script needs ports3001/4174 free). No CAD/model loop or whole-cloud streaming is implied.

Redacted OS-temp handoff: `/tmp/spatial-cad-full-resolution-box-handoff.md` (suggested skills included).
