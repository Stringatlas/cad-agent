# Task034 — Toronto point edits and real CAD solids

## Status
Implemented and integration-verified; fresh-session review pending. Preserved uncommitted tasks032/033; no commit.

## User correction and scope
Toronto is the actual CAD editing workspace, not the synthetic demo. AI must propose changes to selected source points and create real kernel-backed solids in the Toronto scene. Synthetic is a test fixture, not the destination for product functionality.

Bound this first slice to source-point translation and axis-aligned box / Z-cylinder solid creation in `toronto3d-local-v1`, meters, right-handed Z-up, origin `[627285,4841948,0]`. No mapping through synthetic coordinates. Existing OpenCascade adapter and isolated worker perform actual solid creation, validation and tessellation. No booleans, channels, arbitrary transforms, persistent CAD document, STEP UI, or rewritten source cloud/index in this slice.

## Authority and safety
- Reuse the server point override authority for AI proposals and human publication; never create a second model-owned point state.
- Separate Toronto CAD authority owns retained native candidates, session/revision/artifact binding, pending proposals, accepted bodies and latest-first Undo. Scene meshes remain disposable projections.
- Model tools can only propose. Each retained change has visible pending feedback and its own explicit Accept/Decline. No model approval or automatic mutation.
- Kernel solid validity, measured application bounds/volume postconditions, tessellation, atomic publication and rendering are separate outcomes. Check artifact/session/revision before publication.
- Worker invalidation must fail closed; a mesh cache must not silently stand in for an unavailable native body.
- State is volatile and clears on server restart. Ambiguous writes require Refresh before further mutation. Stale candidates are invalidated, not rebased.
- Source point overrides do not change original semantic query domains. Captures with edited/ghost imagery remain blocked unless truthful provenance is implemented.

## Acceptance criteria
- [x] AI point-move tool resolves named attached Toronto records, independently checked through original-record rereads, and retains an exact pending move without mutation.
- [x] AI box/cylinder tools create actual OpenCascade candidates in Toronto coordinates, validate positive-volume single solids and application postconditions, and retain tessellation outside model events.
- [x] Toronto scene renders distinguishable pending ghosts and accepted solids; each proposal has explicit Accept/Decline, stale-safe publication and latest-first Undo.
- [x] No synthetic selection or coordinate mapping is needed for Toronto tools.
- [x] HTTP contracts reject malformed/stale/cross-frame calls, bound resources, enforce local access and cancellation, and contain native failures.
- [x] Focused tests cover kernel-backed candidates, approval/decline/undo, source-point proposals, model tool restrictions, frontend reply binding and ambiguous mutation.
- [x] Typechecks, full baseline tests, build and isolated existing-Chrome interaction/render checks are recorded with exact artifacts.
- [x] Actual diff inspected; fresh-session review remains a separate checkpoint.

## Delegation
Backend: shared CAD contracts, authority, routes, shared point session and server composition. Model: provider tools, bound scene, metadata-only proposal results. Frontend: Toronto CAD renderer/review/controller, point proposal discovery and browser fixture verification. Parent: shared product docs, integration checks, final diff and handoff.

## Verification
- Parent rerun: `node --import tsx --test tests/*.test.ts` — **677/677 pass**, `/tmp/task034-parent-tests.log`.
- Parent rerun: `pnpm typecheck` — pass, Svelte zero errors/warnings; `/tmp/task034-parent-typecheck.log`.
- Parent rerun: `pnpm build` — pass, existing >500 kB bundle warning; `/tmp/task034-parent-build.log`.
- `git diff --check` — pass. Parent inspected authority/model source and composition/point/client integration diff; `/tmp/task034-parent-integration.diff`. Child scoped diff inspections recorded in their reports. Whole-checkout fresh review is not claimed.
- Native/HTTP focused checks: 25/25; model focused checks: 64/64. Commands and evidence: `/tmp/task034-agents/backend.md`, `/tmp/task034-agents/model.md`.
- Existing-Chrome fixture browser: `node --import tsx scripts/browser-toronto-cad-smoke.mjs http://127.0.0.1:9222 /tmp/task034-browser` — all six acceptance groups pass. Actual OpenCascade worker, prepared point fixture and fake provider transport; no operator credentials or production data mutated. Report `/tmp/task034-browser/report.json`, log `/tmp/task034-browser-run.log`, screenshots `01-ai-pending-native-ghosts.png`, `02-human-accepted-native-solid-and-point.png`, `03-ambiguous-write-explicit-refresh.png` and corresponding accessibility snapshots. The recorded connection failure is the deliberately dropped approval reply recovery scenario, not an unreported clean console.
- Browser covers AI point/box/cylinder proposals without mutation; orange native tessellations; individual Decline and exact same-native-body Accept; actual point override Accept; capture blocking; independent Undo; committed-but-dropped response / explicit Refresh; unchanged prepared bytes; source switch disposal.
- LSP child owned-file checks clean. Parent cached workspace diagnostics retain the old `point-override-client.ts` evidence-property error and project-route deprecation hint; real repository TypeScript/Svelte checks pass. Cached LSP is not reported as clean.
- Pre-edit graph impacts run by each owner; stale/UNKNOWN paths supplemented by source callers. Aggregate `detect_changes(scope:all)` reported **CRITICAL** across combined dirty tasks, with truncated/stale/unindexed coverage; not a clean graph certificate. No commit attempted.

## Remaining limits and next action
Live provider and production-scale Toronto interaction are not tested by the fixture smoke. Native validation is real; inference is simulated in automated acceptance. State clears on server restart. Kernel handle loss fails closed and requires restart; mesh is never a recovery CAD authority. Initial operations remain box/cylinder and source-point translations, not arbitrary modification of existing solids, booleans or channel modeling. Multiple pending point changes are reviewed one at a time; CAD ghosts are shown together. Each authority has independent latest-first Undo. Screenshot grounding is blocked with edits/ghosts. Native WASM memory is not hard capped.

Next: fresh-session review against this task and actual dirty diff, especially worker invalidation, authority binding and model-event-to-review lifecycle. Do not conflate these passing checks with review approval.
