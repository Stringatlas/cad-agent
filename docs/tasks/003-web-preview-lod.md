# 003 — Toronto3D web preview with independent LOD

Status: Implemented; browser verification blocked; fresh-session review pending

## Ownership

- Implementation owner: Delegated web-preview agent.
- Review owner: Unassigned (fresh session).

## Goal

Preview the prepared Toronto3D dataset in the web app with independently adjustable user-display LOD and harness-observation/input LOD.

## Scope

- Include local read-only access to the prepared Potree dataset, bounded progressive point rendering, separate LOD settings and a concrete reproducible harness-input sampling/observation boundary.
- Preserve the synthetic demo and existing module boundaries. Keep meters, right-handed Z-up and the Toronto3D translation origin explicit; do not reuse the demo origin.
- Exclude model calls, CAD changes, deployment, global installs, dataset regeneration and edits to raw/prepared data.
- References: docs/architecture.md, docs/decisions/001-coordinate-conventions.md, docs/toronto3d-preprocessing.md, prepared metadata/manifest.

## Acceptance criteria

- [ ] Web UI loads the prepared dataset locally with useful initial framing, orbit/zoom and explicit loading/error states (including absent data).
- [x] Clearly labeled display and harness LOD controls independently affect their respective outputs. Changing display LOD does not change harness settings/sample; changing harness LOD does not change display settings/budget. Separate channels/adapter outputs tested; browser control exercise remains blocked below.
- [x] Harness input is an actual bounded observation/sample, not a cosmetic slider; expose counts and reproducibility metadata with dataset identity, units, frame/origin and LOD settings. No claim of a running model loop.
- [x] Point fetching, CPU/GPU allocations and harness sample sizes are bounded; no whole multi-GB dataset download. Handle stale async requests and dispose resources. Lifecycle suppression unit-tested; visual/GPU lifecycle browser check remains blocked.
- [x] Data serving is read-only, restricted to intended assets, validates ranges/inputs and does not expose arbitrary filesystem paths.
- [x] Deterministic small fixtures cover decoding/sampling, limits, malformed input and independent LOD behavior; baseline pnpm verify passes.
- [ ] Browser checks exercise actual Toronto3D rendering, both controls, independence, navigation and console diagnostics; record evidence or explicit blockers.
- [x] Documentation includes launch steps, data prerequisites and LOD semantics/limitations; actual changes inspected and fresh-session review remains explicitly pending until performed.

## Implementation progress

Implementation completed within the bounded scope. Foundation and preprocessing reviews remain separate; this task does not approve them or modify tasks 001/002.

- Default demo preserved verbatim in `apps/web/src/Demo.svelte`; `App.svelte` switches scenes and unmounts/disposes them. New Toronto component/viewer uses local Z-up coordinates, source bounds for framing, progressive root-then-selected display, independent harness controls, visible statuses and JSON observation download.
- New shared observation contracts; `@spatial/agent-harness` exposes `PointObservationSource`, deterministic sampling and purpose-specific LOD caps. Server `PotreeDataset` is the actual read-only adapter, independent of viewer state/camera.
- Fixed dataset routes, loopback Host/Origin checks, no CORS/raw file endpoint, strict query/range/size validation, symlink rejection and two-request concurrency cap. Uncompressed first-chunk Potree2 only, depths 0–3; display ≤100k and harness ≤4096 points. Exact semantics/limits: `docs/web-preview-lod.md`.
- Actual depth3 candidate population is 139,241 points; largest operation read 7,660,191 source bytes. Default harness (1024/depth2) read 2,029,456 source bytes and returned 54,846 JSON bytes through HTTP. No full payload download, dataset regeneration or modification.
- Eight new deterministic tests (17 total), actual-data integration script and existing-Chrome Toronto browser script added. Node 22.23.3 / pnpm 10.34.6 used; only local offline dependency linking/lock update, no new external package or global install.

The first UI acceptance criterion and browser criterion remain unchecked: implementation exists, but this session cannot certify actual visual framing, navigation, control events, download UI or browser console behavior without connected Chrome.

## Verification evidence

| Exact command/check | Result | Diagnostics/artifacts |
| --- | --- | --- |
| `pnpm install --lockfile-only --offline`; `pnpm install --frozen-lockfile --offline` | Passed; add only server workspace dependency links | `apps/server/package.json`, `pnpm-lock.yaml` |
| `pnpm verify` | Passed final rerun: all typechecks, Svelte 0 errors/0 warnings, 17/17 tests, web build and server typecheck. Existing >500 kB bundle warning retained (604.07 kB JS). | `artifacts/toronto-preview/verify.log` |
| `pnpm exec tsx scripts/check-toronto-preview.ts` | Passed all depths/max budgets, local bounds, stable provenance, deterministic independence, actual HTTP/adapter equality | `artifacts/toronto-preview/actual-samples.json`, `actual-samples.log` |
| `node --check scripts/browser-toronto-smoke.mjs` | Passed syntax check; NOT a browser run | Script source |
| `pnpm verify:browser` | BLOCKED/nonzero: `ECONNREFUSED 127.0.0.1:9222`; browser console not captured | `artifacts/browser/report.json`, `artifacts/toronto-preview/demo-browser.log` |
| `node scripts/browser-toronto-smoke.mjs` | BLOCKED/nonzero: same CDP refusal; no screenshots or browser assertions completed | `artifacts/toronto-preview/browser/report.json`, `toronto-browser.log` |
| GitNexus query; upstream impacts for `createDemoServer`, `App`, `Toronto`, `createDatasetRoutes`; `detect_changes(scope: all)` | Unavailable: LadybugDB read-only shadow-page recovery error. Risk UNKNOWN, not zero/low. No index regeneration or commit. | Tool output; manual dependency confirmation described below |
| `git diff --no-index --check /dev/null <file>` for each owned file | Passed; untracked files explicitly included rather than trusting empty `git diff` | `artifacts/toronto-preview/change-inspection.txt` |

A verification intermediate failed solely because Node fetch normalized the forged Host test header (received 200). The test now sends actual raw HTTP with a forged Host and confirms 403, without weakening the server check; final full suite passes. Retained diagnostic: `artifacts/toronto-preview/verify-host-test-failure.log`.

Browser skill inspected; browser setup/tools were unavailable to this child and `/tmp/pi-browser-daemon.sock` absent. Existing Chrome's DevToolsActivePort also named 9222, which refused connections. No browser was launched/installed. Browser-dependent claims remain pending. Parent follow-up also attempted `browser_setup`: failed with `Could not start the browser daemon. Check /tmp/pi-browser-daemon.sock.`; browser verification remains blocked.

Manual source dependency confirmation after graph failure: `createDemoServer` is called by its CLI, server tests and the bounded integration script; `main.ts` mounts `App`, which mounts Demo/Toronto; dataset routes are invoked only by the server; Toronto owns viewer and separate observation channels, with channel tests covering stale/disposal behavior. Contracts flow to server/web and agent-harness without framework/kernel leakage. Graph callers/processes could not be resolved; source confirmation is not a graph all-clear. Existing demo viewer/entities/project-state/geometry source and raw/prepared datasets/tooling were left untouched.

## Review

Pending fresh-session review.

## Remaining failures / next action

1. Enable/connect existing Chrome CDP (or use `/browser-setup` where available), rerun `pnpm verify:browser` and `node scripts/browser-toronto-smoke.mjs [endpoint]` against the built app; inspect screenshots and console, exercise absent-data status if desired. Stop dev servers first so ports 3001/4174 are free.
2. Fresh-session review against this task, source and owned-file evidence; especially security caps, dataset fingerprint limitations, channel independence and browser interactions. No approval is implied by implementation/baseline passing.
3. Full screen-space streaming, deeper hierarchy traversal and model/CAD loops are intentionally out of scope. A first-chunk depth cap and deterministic coarse candidate sample are documented limitations, not full-cloud inference.

Redacted OS-temp handoff: `/tmp/spatial-cad-web-preview-lod-handoff.md` (suggested skills included).
