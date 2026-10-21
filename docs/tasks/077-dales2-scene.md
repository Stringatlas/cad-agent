# Task077 — Process DALES-2 and make it the default scene

## Request and scope
Process the local `data/raw/DALES-2` dataset and create a new scene instead of
Toronto3D. Preserve raw data, Toronto functionality and unrelated user changes.
This slice provides a read-only sampled scene; migrating Toronto-specific agent
and editing contracts is explicitly **not implemented**. DALES never receives
Toronto authorities or references.

## Acceptance / implemented
- [x] All 29 local LAZ tiles converted and independently audited: **357,621,323
  original points**, no source downsampling. Recipes record source hashes and
  native DALES-2 classes, original-row identities and local frames.
- [x] DALES-2 is the application default, initially tile `5080_54435`. All 29
  independent tiles are selectable; normalized coordinates are never merged.
- [x] Orbit/zoom/fit, bounded display quality, semantic point picking and a compact
  accessible native-class key. Selected source identities use original sample
  precision rather than GPU Float32 buffers.
- [x] Read-only operator-registered routes bind samples to artifact revisions;
  client paths, edits and raw ranges are not accepted. Existing I/O caps remain.
- [x] Toronto remains explicit opt-in. DALES mounts neither Toronto chat nor
  approval/edit UI; unavailable DALES chat is stated truthfully.
- [x] Focused tests, desktop/mobile browser checks and independent scoped review.
- [x] Review finding fixed: independent centimeter coordinate validation cannot be
  relaxed by tampering with converter metadata scale; all tiles re-audited.
- [ ] Full suite green: existing failures remain, see below.
- [ ] Fresh-session whole-diff review/approval remains pending. No commit made.

## Artifacts and architecture
See [preprocessing guide](../dales2-preprocessing.md) for acquisition, exact
conversion commands, source/release hashes, attribute preservation, palette and
independent validation. Generated assets are ignored under
`data/processed/dales2/<tile>/`; summary is
`data/processed/dales2/preprocessing-summary.json` (approximately 29.6 GiB).

Runtime: `apps/server/src/prepared-cloud-routes.ts` owns the fixed tile registry;
`prepared-cloud.ts` retains the shared bounded-reader implementation. Optional
`display` sampling purpose uses existing display limits; default harness limits
remain unchanged. `Dales.svelte`, `dales-viewer.ts` and
`prepared-cloud-client.ts` implement separate disposable rendering and picking.
`App.svelte` chooses DALES by default and isolates unsupported agent capabilities.
Default display is 60k points, Light 20k, Fine 100k, not full-resolution streaming.
All display class colors are semantic, not photometric imagery.

## Verification — actually run
Node22.23.3 / pnpm10.34.6; no paid inference.

| Command/check | Result / artifact |
| --- | --- |
| Source hash/header/full label inventories | All29 pass; `/tmp/dales2-source-verification.json`, `/tmp/dales2-inspection-validation.json` |
| Real conversion + independent every-point validation | All29 pass; `/tmp/dales2-batch.log`, `/tmp/dales2-revalidation.log` |
| Strengthened centimeter validator production rerun | All29 / 357,621,323 points pass; max per-axis error 0.010000000000000009m (1e-9m floating epsilon); `/tmp/dales2-centimeter-revalidation.log` |
| `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/dales2-preprocessing.test.py -v` | Final14/14 pass independently; `/tmp/dales2-validator-independent-tests.log` |
| All29 real default display samples | Pass; `/tmp/dales-runtime-production-samples.jsonl` |
| `pnpm typecheck` | Pass, zero errors; four pre-existing unused CSS warnings in user-modified `ProviderAccount.svelte`; `/tmp/dales-final-typecheck.log` |
| `pnpm build` | Pass, existing bundle warning; `/tmp/dales-final-build.log` |
| `node --import tsx --test tests/dales-runtime.test.ts tests/prepared-cloud.test.ts` | 15/15 pass; `/tmp/dales-final-focused-tests.log` |
| Isolated headless browser, real source, desktop1280x720 + mobile390x844 | Nine checks pass, no errors; `/tmp/dales-runtime-browser/report.json`, screenshots/AX in same directory; script `/tmp/dales-runtime-browser.mjs` |
| `node --import tsx --test tests/*.test.ts` | Final1177 tests:1162 pass/15 fail; `/tmp/dales-final-full-tests.log` |
| HEAD baseline `c1047a1` in separate archive with snapshot-local workspace links | 1172 tests:1158 pass/14 fail including intermittent cache cancellation; `/tmp/dales-head-c1047a1-tests.log` |
| Changed TS LSP diagnostics; `git diff --check` | Pass; Svelte checks via typecheck |

Browser covered default/all29/no Toronto requests, native semantic picking, zoom,
tile switch clearing pick, quality replacement, mobile error/retry, explicit
Toronto then DALES remount isolation, and fresh mobile fit/picking/key. Previously
dispatched Toronto requests may finish after unmount; no new Toronto work is
started by the mounted DALES scene.

Baseline comparison: final failures are the existing stable baseline failures
plus two assertions/warnings from the user's pre-existing `ProviderAccount.svelte`
changes. An obsolete source assertion demanding Toronto as the default was
updated to require DALES while retaining Toronto/nearest and no-synthetic checks;
no safety assertions were removed. Intermittent baseline cache-cancellation
failure did not recur in final run. Names/comparison before this assertion update:
`/tmp/dales-head-baseline-comparison.json`. Unrelated account changes untouched.

## Review and graph limitations
Independent scoped source review found the metadata-scale validation weakness;
fixed with corruption regressions, independently rechecked (14 fixtures pass).
No other material scoped findings were returned. This does not replace a fresh
whole-diff review.

Graph index three commits stale. Pre-edit `createDemoServer` impact MEDIUM;
reader class LOW with interface dispatch unresolved; Svelte/new importer symbols
UNKNOWN, source/text verified. Ambiguous generic `sample` lookup included HIGH
unrelated hits; qualified reader dispatch unresolved. Runtime graph change
analysis reported HIGH and omitted unindexed new files; it is **not** a clean
whole-diff certificate or commit gate. No commit attempted.

## Remaining / next action
Fresh-session review against this task and actual tracked + untracked diff.
Preserve unrelated `ProviderAccount.svelte`. DALES agent perception/chat and
approval-gated CAD editing require a separate explicit generic scene-binding
migration; never reuse Toronto taxonomy/frame contracts. Native progressive
full-resolution display, cross-platform converter qualification and verified
geographic/inter-tile transforms are not claimed.
