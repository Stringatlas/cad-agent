# 049 — Natural RGB / point-type viewer colors

## Request and acceptance
User clarified “satellite texture” means the source point cloud's natural RGB, not map imagery.
- [x] Toronto workspace offers Natural RGB (default) and Point types.
- [x] Type mode has a compact, keyboard-accessible Key disclosure, text labels and matching swatches for source classes 0–8 plus Unknown.
- [x] Overview, camera-driven detail and manual full-resolution chunks honor the current mode, including newly arriving/repacked chunks.
- [x] Toggle changes only disposable color buffers: coordinates, source identities, picks, committed overrides, CAD and pending-edit styling remain unchanged.
- [x] Legacy unlabeled crop streams remain supported and display Unknown in type mode. Production crop batches now carry aligned validated source labels.
- [ ] Desktop/mobile rendered inspection, including selection/pending/error and AOI/derived-overlay coexistence.
- [ ] Fresh-session review.

## Implementation
`apps/web/src/point-colors.ts` owns the shared linear palette and readable key. `Toronto.svelte` owns the mode selector and on-demand key. `toronto-viewer.ts`, `adaptive-render.ts` and `crop-render.ts` recolor from immutable originals without refetching geometry or resetting position overrides. Capture coverage includes the active color mode. Natural RGB retains sRGB-to-linear conversion; adaptive colors retain normalized compact Uint8 storage. Crop chunks retain compact RGB/label copies for roundtrip switching.

`packages/contracts/src/crop.ts`, `apps/server/src/crop.ts` and `apps/web/src/crop-client.ts` add optional aligned source labels with validation and hash coverage, retaining existing unlabeled synthetic compatibility. This is display metadata, not geometry authority or a new classification algorithm. Unknown fallback/edit marker styling remains distinct; derived overlays and pending ghosts retain their existing palette.

## Verification
- `pnpm typecheck` — pass (including Svelte: zero errors/warnings).
- `pnpm build` — pass; existing large-bundle advisory remains.
- `pnpm verify` — blocked at `tsx` IPC socket creation, `EPERM /tmp/agents/tsx-501/99535.pipe`; typecheck stage passed. Log: `/tmp/task049-verify.log`.
- Equivalent direct test runner: `node --import tsx --test --test-concurrency=1 tests/*.test.ts` — **852/852 passed**, zero skipped/failed. Log: `/tmp/task049-tests.log`.
- Tests cover palette/key agreement, RGB conversion, Unknown, input ownership, chunk arrivals, RGB roundtrip, eviction/repacking, buffer identity, source picks and committed positions/overrides surviving recoloring; crop label propagation/filtering/hash/validation.
- LSP clean for helper/crop renderer/tests and child-owned adaptive/crop changes. Toronto viewer's cached diagnostics still referenced old adaptive APIs; current project compiler is clean. Svelte has no LSP configured; `svelte-check` passed.
- `git diff --check` — pass. Inspected task-specific diff; preserved existing task047/task048/operator changes.
- Browser setup failed: `Connection failed: Daemon not running — socket not found`. No browser visual/interaction acceptance or screenshots claimed. Do not repeatedly invoke setup without repairing daemon availability.

## Graph / review risk
Pre-edit impacts: crop renderer LOW (Toronto viewer caller); Toronto viewer UNKNOWN (empty graph callers), adaptive renderer UNKNOWN (missing symbol). Text verification found Toronto/ClosestPole viewers and renderer tests; inspected source because graph is two commits stale. Child checked crop pipeline impact and source callers before edits.
Aggregate `detect_changes(scope: all)` reports CRITICAL across mixed dirty tasks (70 changed symbols,47 affected), not a task-isolated all-clear. The stale index omits new files/adaptive implementation; graph findings do not establish safety. No commit created. Fresh review must isolate this task's changes from existing task047/048 work.

## Next action
Repair browser daemon, verify both modes on desktop/mobile with actual scene data and key open/closed, confirm camera/picking/approvals/AOI/derived overlays/error recovery remain usable. Then fresh-session review against this task and actual diff.
