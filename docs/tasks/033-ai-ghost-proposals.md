# Task033 — CAD-first vision and AI ghost proposals

## Scope
Document the shared, extensible CAD-first product vision and connect model create-box/update-box proposal tools to the existing authoritative parameter-edit workflow in the synthetic project scene. This bounded slice is NOT project-integrated kernel CAD or Toronto frame mapping.

## Acceptance
- Shared vision linked from AGENTS.md and architecture, with current capability limits distinguished from goals.
- Model can request create and modify box proposals only in a bound synthetic project; no model approval, undo, save or mutation tools.
- Server retains exact revision/frame/unit-bound candidates; invalid/stale input never mutates geometry.
- Pending changes automatically appear as distinguishable ghost previews with per-change Accept and Decline, exact parameters and verification limits. Accept publishes only that retained candidate; other revision-bound proposals invalidate after mutation (never silently rebase).
- Decline invalidates the retained server proposal without changing geometry; expiry, refresh, source changes and concurrent operations fail safely.
- Human-approved edits retain checked inverse Undo and explicit Save behavior.
- Regression tests cover tool admission/dispatch, stale/invalid/no-approval safety and client proposal handling. Browser checks inspect ghosts and acceptance/decline/Undo where available.
- Preserve task032 dirty work; record commands/results/artifacts; fresh-session review remains pending.

## Delegation
Backend agent owns provider-model.ts, model-scene.ts, model event contracts and backend tool tests. UI agent owns web proposal controller, model/chat integration and viewer ghosts plus client tests. Parent owns shared docs, decline route/session behavior, integration and verification. All agents run GitNexus impact before editing symbols and inspect source to supplement stale/UNKNOWN results.

## Status
Implemented; acceptance checks below pass. Fresh-session review and live-provider compatibility remain pending. No commit made. Task032 pre-existing dirty work preserved.

## Implementation
- Shared vision: `docs/product-vision.md`, linked from `AGENTS.md` and architecture.
- Namespaced `scene.propose_box_create` / `scene.propose_box_update` only for bound synthetic project. Model cannot approve, decline, undo, save or mutate. Exact tool wrapper `{kind:'project-box-proposal',proposal}`.
- Strict retained candidate admission, pending queue and translucent non-pickable amber ghosts, scene-overlay individual Accept/Decline and checked Undo. Accept/Decline locked during streaming. Acceptance invalidates peers; screenshot grounding blocked while ghosts exist. Image-turn previews wait for complete clean EOF to preserve active pixel grounding.
- `POST /project/decline` checks exact binding/ID/digest and deletes only that proposal without geometry/revision mutation. Lifecycle resets clear client ghosts; unreviewed retained server proposals expire under existing bounds.
- Updated legacy source-integration test for additive ModelChat callbacks, preserving original control assertions and adding proposal wiring checks.

## Verification evidence
- `pnpm typecheck`: pass, `/tmp/task033-typecheck.log`.
- `node --import tsx --test tests/*.test.ts`: final **658/658 pass**, `/tmp/task033-tests-rerun.log`. First integration run identified and corrected a brittle literal component-tag assertion. Next run had one unrelated timing-sensitive semantic-disk cancellation/staging assertion failure (657/658); unchanged full rerun passed. Original failure retained `/tmp/task033-tests.log`; no acceptance checks weakened. Direct Node runner avoids previously observed tsx CLI pipe EPERM.
- `pnpm build`: pass, `/tmp/task033-build.log`; existing >500kB bundle warning remains.
- `node --import tsx scripts/browser-ai-ghost-proposals-smoke.mjs`: pass using existing Chrome9222, built bundle, isolated fixture/project/backend and synthetic model transport. `/tmp/task033-browser/report.json`, actual provider bodies, nine PNG/AX artifacts. Automatic two-ghost rendering; per-change Decline no mutation; exact Accept; checked Undo; stale peers invalidated both UI/server; screenshot blocked/restored; no collected browser errors. Screenshots02/05/08 visually inspected by verification agent. No operator persistence/configuration changed or Chrome launched. Live provider not tested.
- Focused backend/client/render tests and decline HTTP coverage pass. LSP checked modified TS/new tests: no compilation errors; routes retains existing deprecated request.aborted hint. `git diff --check`: pass. Parent inspected integration diff; this is not fresh-session review.
- GitNexus impact: ProjectSession MEDIUM (server/routes/model consumers); createProjectRoutes LOW (server startup flows). Agents checked other edited symbols and supplemented stale/Svelte UNKNOWN results against source. `detect_changes(scope:all)` flags **critical combined-checkout risk**, 46 indexed changed symbols/73 affected, including prior task032 work. Index is two commits behind; new/Svelte coverage incomplete, so graph certification is NOT clean. No commit attempted. Fresh review must inspect actual tracked and untracked files, not rely on graph coverage.

## Next action
Fresh-session review task033 against actual diff, distinguishing preserved task032 work. Check live-provider tool-schema compatibility separately; then plan a bounded project-integrated real-CAD milestone with explicit frame mapping rather than calling these parameter meshes solids. Completion handoff: `/tmp/task033-completion-handoff.md`.
