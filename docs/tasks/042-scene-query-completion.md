# 042 — Terrain and full-source spatial queries

Status: Ready for review

## Ownership
- Implementation: parent agent plus isolated ground, spatial transport and validation agents.
- Review: Unassigned (fresh session).

## Goal and audit
User requests completion of semantic instances, ground elevation(x,y), quality-reported primitive fitting and scalable nearest/radius/clearance. Task037/038 already implement full-dataset per-class voxel connected components, primitive fits with measured residual/coverage, supported ground-cell minima and a disk-page KD-tree. Missing: interpolated ground query and product HTTP access to general spatial queries. Fit validators also accept inconsistent quality payloads.

## Scope
- Add O(1) indexed sparse cell-center triangulation over existing observed minima, with explicit unavailable holes/exterior/steep spans and no extrapolation.
- Expose revision-bound local read-only elevation and nearest/radius/point-distance HTTP queries using full offline artifacts/original records, never truncated display summaries.
- Tighten finite fitted metrics, quality formula, class/kind and cylinder dimension consistency.
- Preserve existing verified nearest-label path, uncluttered UI, approval authority and unrelated task040/041 dirty changes.
- Excludes robust terrain estimation, point-level disk reordering, arbitrary building footprint reconstruction, effective edited-position queries, model-tool integration and solid/surface clearance certification. These remain explicit follow-up scope, not claims of completion.

## Acceptance criteria
- [x] Terrain interpolation matches planes at negative/positive coordinates, rejects unsupported holes/extrapolation/steep spans and reports original-minimum limitations.
- [x] Terrain HTTP reads full validated fixed-path artifact with revision/frame/meters, no capped-overlay dependency.
- [x] Spatial HTTP supports exact nearest and radius count/capped witnesses plus explicitly point-only distance, with admission/deadline/abort/stale/security checks.
- [x] Inconsistent/null fitted metrics and class/geometry mismatches rejected, poor but internally consistent quality allowed.
- [x] Focused and baseline checks recorded, actual-dataset query smoke recorded if available.
- [ ] Actual scoped diff inspected; fresh-session review remains pending until separately performed.

## Risk and delegation
Ground and fit audit agents read implementation first; separate agents own ground module/tests, spatial route/tests, and fit validator/tests. Parent owns full-artifact loader extraction, route composition, terrain transport/integration tests and docs. `createDatasetRoutes` graph impact LOW: direct caller createDemoServer, affected server/performance-check flows. `preprocessingSummary` and new symbols unresolved/UNKNOWN in stale graph; source/text callers verified (dataset routes and tests), not treated as unused.

## Implementation and verification
Implemented ground lookup/transport, spatial transport, full-artifact reader extraction, route composition and fit validators. Task040/041 rendering work and operator settings preserved. Parent inspected scoped tracked diff and new code; isolated adversarial source inspection found no actionable defect. This is not fresh whole-task sign-off. No rendering/layout changes; browser not run for backend math/transport and rejection-only browser validator changes.

| Exact command/check | Result | Evidence |
| --- | --- | --- |
| `pnpm verify` | Typecheck passes; test launch blocked by tsx CLI Unix-pipe EPERM under `/tmp/agents`; composite did not reach build | `/tmp/task042-verify.log` |
| `node --import tsx --test tests/*.test.ts` | 770/770 pass; no skipped/cancelled | `/tmp/task042-tests.log` |
| `pnpm exec tsc -p tests/tsconfig.json --noEmit` | Pass | `/tmp/task042-test-types.log` |
| `pnpm build` | Pass; existing >500kB web chunk warning | `/tmp/task042-build.log` |
| `node --import tsx scripts/check-scene-queries.ts` | Pass; actual composed HTTP, supported/interpolated/missing/exterior ground, nearest/radius/point-distance matched independent exhaustive78,320,210-point/19,122-page oracle | `/tmp/task042-actual-query.json` |
| `git diff --check` | Pass | No whitespace diagnostics |
| LSP per new/modified files; workspace cached diagnostic check | New modules clean; parent cache reports34 errors/1 hint for stale older types, including unrelated prior work. Current workspace/tests tsc and svelte-check pass; not a clean cached-LSP claim | Reproduce `lsp_diagnostics('*')` |
| `gitnexus_detect_changes(scope:all)` then `node .gitnexus/run.cjs detect-changes --scope all --repo .` | Aggregate CRITICAL:89 changed symbols/40 affected flows across entire dirty checkout (including preexisting Potree/render changes). MCP text truncated; CLI summary rerun confirms aggregate. Stale index misses untracked new modules; not clean graph certification | `/tmp/task042-graph-changes.txt`, `/tmp/task042-graph-cli.json`, `/tmp/task042-graph-cli.err` |

Actual query: radius1m count16, capped witnesses5 all audited; nearest0.2878159133891114m. Warm HTTP timings at this one location: nearest101ms, radius79ms, point-distance72ms; full independent scan13.1s. This is one location/cache state, not a general latency target or benchmark guarantee. Preprocessing artifact accepted stricter validators without regeneration;13394 full ground cells read. No provider calls or geometry edits.

## Review / remaining work
Fresh-session review pending against task042 scoped changes and existing dirty work; no commit created. Graph CRITICAL aggregate and stale/new-file coverage require deliberate review, not waiver. Next bounded action: fresh review, then separately expose source-bound product-agent tools if assigned. Robust ground estimation, partial-scan cylinder improvement, point-level disk reordering and true CAD/surface clearance remain follow-up. Existing task041 browser recheck remains independently pending.
