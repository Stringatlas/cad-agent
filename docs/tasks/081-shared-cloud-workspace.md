# Task081 — Shared point-cloud viewer and agent tools

User requested abstraction of Toronto3D viewer/agent tools, deletion (not
deprecation) of DALES viewer code, and STPLS3D with RGB / instance / semantic
display modes. Task080 source/data additions must be preserved.

## Acceptance
- [x] Shared dataset-aware viewer primitives used by Toronto and STPLS3D.
- [x] DALES viewer implementation and runtime registration deleted.
- [x] All 25 STPLS3D scenes selectable; RGB/instance/semantic switching preserves
  camera and selection; signed native IDs and accessible type/key inspection.
- [x] Agent registration/dispatch uses bound scene capabilities and taxonomy;
  references, continuation and asynchronous work remain isolated on scene switch.
- [x] STPLS3D agent inspection and queries run against its own source adapter.
- [x] Supported capabilities explicit; existing human-approval safeguards preserved.
- [x] Appropriate contracts, integration, baseline and desktop/mobile browser checks.
- [x] Docs and handoff updated.
- [ ] Fresh-session review pending; implementation is not approval.

Single active scene; no implicit cross-scene transforms. Raw/processed DALES
data and offline preparation history are not viewer code and remain untouched.

## Result and boundaries

`viewer/point-cloud-viewport.ts` and `viewer/cloud-colors.ts` are shared by
Toronto and the prepared-cloud viewer. Existing capture, viewport sizing and
orbit-focus utilities are reused. STPLS3D defaults to RGB and exposes native
instance/semantic controls; recoloring retains the viewer/camera/selection.
Fit uses displayed geometry rather than Potree's padded cubic root. Untouched
initial views refit for viewport changes; user navigation remains retained.
Selected points expose semantic type and signed instance ID; keys use disclosure.

All three files under `apps/web/src/scenes/dales/` were deleted, as were the
DALES runtime inventory and its viewer-specific test (replaced with cloud tests).
No DALES application source/import remains. Its source data and offline scripts
remain. The default registry is 25 independent STPLS3D scenes.

Agent dispatch/advertisement share `scene-capabilities.ts`; query schemas use
each bound adapter's native semantic IDs. `cloud-model-scene.ts` independently
resolves attached original records and supplies exact nearest/radius/box source
scans, separate from sampled display. The generic cloud contract cannot carry
Toronto AOIs/authored objects or reuse its frame. ID/revision/frame/origin bind
server continuation; client switches abort/reset context. Browser capture and
source selection rebind and verify the exact original coordinates.

Prepared scenes expose read-only inspection/query/capture/pixel/reference tools.
Toronto retains its existing edit, object, marks and terrain adapters and human
approval loop. Those authorities were not extended to STPLS3D. Full-resolution
display streaming and indexes for prepared-cloud queries are not implemented;
original queries scan all physical records with bounded buffers and witnesses.
No cross-scene operation, automatic reprojection or live-provider certification.

Task080's processed payloads and originals are unchanged. The 25 descriptors now
explicitly declare `instance_id` int32 with unassigned `-100`, and its producer,
loader check and guide were extended accordingly. Raw hashes all still match.

## Verification actually run

Node v22.23.3, pnpm 10.34.6. Logs are OS-temp diagnostics, not build dependencies.

| Command | Result / evidence |
| --- | --- |
| `pnpm typecheck` | Pass; Svelte 0 errors/warnings; `/tmp/task081-typecheck.log` |
| `pnpm test` | Final 1,001/1,001 pass; `/tmp/task081-tests.log` |
| `pnpm build` | Pass; existing bundle-size warning; `/tmp/task081-build.log` |
| `node --import tsx --test tests/datasets/cloud-runtime.test.ts tests/viewer/cloud-colors.test.ts` | 10/10 pass; `/tmp/task081-native-tests.log` |
| `PYTHONDONTWRITEBYTECODE=1 data/processed/toronto3d/tooling/venv/bin/python tests/preprocessing/stpls3d-preprocessing.test.py` | 3/3 pass, real converter and corruption fixture; `/tmp/task081-preprocessing-tests.log` |
| `node --import tsx scripts/check-stpls3d.ts` | All 25 actual clouds load with native instances and Three.js buffers; `/tmp/task081-all-clouds.log`, processed `viewer-compatibility.json` |
| `pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --types node scripts/check-stpls3d.ts` | Pass; `/tmp/task081-check-typecheck.log` |
| `PYTHONDONTWRITEBYTECODE=1 python3 scripts/dataset_recipe.py --recipe config/dataset-recipes/stpls3d.json --raw data/raw/STPLS3D` | All 25 source hashes unchanged; `/tmp/task081-source-hashes.json` |
| `node --import tsx scripts/browser-cloud-workspace-smoke.mjs` | Pass against built web + actual clouds + fake provider in isolated Chrome; `/tmp/task081-browser.log`, `/tmp/task081-browser/report.json` |
| `git diff --check`, actual diff/addition inspection, DALES application-source search | Pass; no staged changes or commit |

Browser checks cover desktop/mobile RGB/instance/semantic states, selected native
type/instance, loading, actionable failure/Retry, scene switch/context clearing,
Toronto loading and switching back. Real browser/model bridge exercised instance
and semantic captures (identical camera, live RGB restored), pixel lookup with a
truthful ambiguous result, exact native-label query and verified reference
attachment. Screenshots inspected under `/tmp/task081-browser/`: desktop RGB,
agent selection, loading, error; mobile instance, semantic, loading, error and
Toronto. No unexpected console errors. STPLS3D has no geometry-pending UI because
its adapter exposes no proposal tools; Toronto approval regression tests pass.

Initial failures were corrected: obsolete two-mode capture assertions, capability
gating that admitted a fake CAD capability in the dataset-less Pole mode, and an
expected capability-shape update. No acceptance assertions were weakened to hide
failures. Browser fixture corrections resolved duplicate labels and the existing
nested pixel-result evidence envelope. Required named spatial/browser skill files
were not found in the installed project/Pi/Codex skills; verification used the
repository's shared helpers and existing Playwright/CDP approach. No LSP tool was
available; the actual CLI typecheck is the diagnostics authority.

## Graph risk and review

Bound repo/worktree: `cad-agent`, this checkout. Pre-edit color path CRITICAL122,
scene canonicalization CRITICAL14, registration CRITICAL2, binding HIGH4. Callers
include color application/crop/adaptive buffers, browser brokers, chat binding,
approval/rebind and reference selection. Warnings were reported before changes.
Viewer graph walks returned UNKNOWN because Svelte calls were unresolved; source
confirmed Toronto.svelte/ClosestPole.svelte and the deleted Dales.svelte callers.
New/unindexed functions and bare constants were confirmed against source rather
than treating missing graph edges as safety evidence.

`node .gitnexus/run.cjs analyze --index-only` succeeded with registry-lock
escalation: `/tmp/task081-graph-index.log`, 12,390 nodes / 36,735 edges / 681 flows.
`python3 /tmp/task081-graph-check.py` ran detect-changes with a temporary index
and temporary object store, including all 22 additions without staging anything
in the user's index: 49 files / 283 symbols / 199 affected flows, **critical**.
`/tmp/task081-graph-changes.log` includes Task080 additions as well. The CLI caps
displayed listings even with limit 1000; graph flows remain a lower bound and this
is not a clean whole-repository certificate or a commit approval.

Handoff: `/tmp/task081-shared-cloud-handoff.md`. Next action: fresh-session review
against this task and the actual combined diff, preserving Task080 data/recipe
work. No further implementation checks are pending in this session.
