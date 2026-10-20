# Task066 — incomplete semantic cache diagnosis and conservative recovery

## Scope / status

Implemented the semantic disk-cache boundary and cache tests. Independent focused review found one missing-generation lookup issue; parent corrected it and follow-up review found no remaining actionable issues. Whole-checkout fresh-session review remains pending. No source assets or pre-existing cache directories were deleted, renamed, repaired in place, or rebuilt during diagnosis; no processes were stopped and no inference was purchased.

## Actual local diagnosis (2026-10-20)

Read-only inspection of the canonical OS-temp `spatial-cad-semantic-disk-v1` root found 159 empty hash directories, 745 directories with manifests, and one nonempty directory missing its manifest. Merely having a manifest is **not** a validation claim for the other 745 directories.

The actual default prepared Toronto dataset binds to cache identity:

`15ea2abb4cde8243b33eb73961983c8d0c6e2c618627e35cf68b4ff858a94b95`

It contains **only `source-1.bin` (86,268,688 bytes)**. `index.json`, `records.bin`, `pages.bin`, and `source-2.bin` through `source-4.bin` are absent. The prepared source reports **78,320,210 points**, revision `beff0c86c640bdfac9c0961265bd2642adbf310e673af1108307ec17ee141993`. This is the default whole dataset, not the earlier 1 ha search fixture.

The old load path treated any existing directory without `index.json` as permanent `corrupt-data: Incomplete semantic cache`; preparation called that same loader before build and could never recover. Direct `SemanticDiskIndex.load` still reproduces that exact error intentionally; preparation now distinguishes this narrowly recoverable state.

The cause of the historical file disappearance is **not established**. The source-1 file dates from October 16 while the directory changed at 07:51 UTC October 20, matching many empty directories. This is compatible with external temp cleanup, but is not proof. Normal interrupted builds use private `.building-*` directories, write/sync the manifest last, and atomically rename a completed staging directory. Interrupted builds alone do not explain a published hash directory containing just one old lookup file.

Artifacts (OS temp, not repository/source assets):
- `/tmp/task066-cache-inventory.json` — directory inventory and surviving file stat.
- `/tmp/task066-cache-source-binding.json` — source binding and metadata-only read accounting.
- `/tmp/task066-cache-real-readonly-check.jsonl` — exact direct-load error, then non-building prepared lookup returning unavailable; zero source payload bytes read.

## Recovery design

- Preserve the incomplete directory **and every byte in it**. Do not recursively delete, quarantine, overwrite, or acquire/remove operator locks in existing cache directories.
- Only missing-manifest directories containing expected regular cache files (or empty) qualify. Reject directory/file symlinks, unknown entries, nested directories, and lock markers. Inspect incrementally, with cancellation and unchanged-directory checks.
- Rebuild from the normal validated complete source into private staging, then atomically publish to the next deterministic sibling `IDENTITY-recovery-N`. There are eight total slots (original plus seven recovery generations); exhaustion requires operator inspection rather than unbounded disk growth.
- Existing manifests that fail integrity/binding validation, and mutations to an active resident index, still fail closed. Recovery does not certify partial source, bypass source revision checks, change checksums, relax provenance coverage, or turn corrupted manifests into misses.
- Keep the in-process preparation gate and cancellation behavior. Independent processes use the same recovery slot and existing atomic rename winner/loser semantics. A losing builder loads the published winner without replacing its files. Valid existing caches are never removed.
- Selection-only `loadPreparedSemanticDiskIndex` discovers a valid recovery generation but never builds or scans payload. During cold recovery it returns unavailable rather than exposing staging/partial data.

## Checks

Node `v22.23.3`; pinned pnpm.

- `pnpm exec tsx --test tests/semantic-disk-storage.test.ts` — **13/13 pass**; `/tmp/task066-cache-tests.log`.
- `pnpm exec tsx --test tests/semantic-disk-storage.test.ts tests/source-point.test.ts tests/spatial-page-index.test.ts tests/semantic-instances.test.ts tests/pole-index.test.ts` — **53/53 pass**; `/tmp/task066-cache-regression.log`.
- `pnpm exec tsc -p apps/server/tsconfig.json --noEmit` — pass; `/tmp/task066-cache-server-tsc.log`.
- `pnpm exec tsc -p tests/tsconfig.json --noEmit` — pass; `/tmp/task066-cache-tests-tsc.log`.
- LSP diagnostics for both changed TypeScript files — clean.
- Scoped `git diff --check` — pass; inspected scoped diff.

New regressions cover empty/source-only/missing-manifest preservation and rebuild, prepared-only no-scan behavior, concurrent selection/preparation, cancelled waiters and builds, retry, cross-process publication winner inode preservation, symlink/unknown-file/directory/lock refusal, and bounded generation exhaustion. Existing integrity/source-corruption tests continue to pass unchanged.

## Graph / remaining limits

GitNexus repository `cad-agent`, this checkout. Pre-edit impacts for `SemanticDiskIndex.load`, `getSemanticDiskIndex`, and `loadPreparedSemanticDiskIndex` report **CRITICAL** shared-query/preprocessing/scene-object blast radius. Named-symbol/source verification confirmed both loader callers and the gate/build/publication paths. Graph is two commits stale and method receiver edges have known omissions; it is not comprehensive proof.

The parent had already hit EPERM at `/Users/kevin/.gitnexus/registry-lock/analyze.lock.guard`. A child refresh attempt (`node .gitnexus/run.cjs analyze --index-only`) timed out at 20 seconds after warning of an interrupted prior rebuild and truncated flows; freshness remains unresolved. Log: `/tmp/task066-cache-graph-refresh.log`. MCP change analysis and CLI retry (`node .gitnexus/run.cjs detect-changes --scope all --repo .`) identify critical shared paths across the dirty checkout; CLI output is abbreviated and cannot certify full coverage. Log: `/tmp/task066-cache-graph-changes.log`. No commit was made.

The affected app-runtime 78M-point cache has **not** been rebuilt; see the parent verification checkpoint below for the separate fresh-cache benchmark and runtime-path permission limit. Next preparation can now build a validated sibling without deleting the surviving cache. Cold preparation needs several GB of disposable disk space and sufficient request time; production-scale cold latency/resource availability remains unmeasured. Nonempty malformed-manifest caches, hostile/unknown entries, active mutation, and exhausted generations intentionally remain explicit errors. No full-suite/browser/live-model certification is claimed by this cache-only work.

## Parent verification checkpoint

Independent review reproduced a valid recovery being missed if cleanup removed an earlier generation. `locateCache` now searches all bounded generations before selecting an absent publication slot. New generation1/generation3 fixtures assert metadata-only lookup and preparation reuse surviving publications without reading source payload. Follow-up independent review: resolved, no remaining actionable finding; cache tests **14/14 pass**.

- `node --import tsx --test tests/semantic-disk-storage.test.ts tests/source-point.test.ts tests/spatial-page-index.test.ts tests/semantic-instances.test.ts tests/pole-index.test.ts tests/area-candidate-*.test.ts tests/model-capture-*.test.ts tests/provider-model.test.ts` — **270/270 pass**, `/tmp/task066-parent-focused.log`.
- `pnpm typecheck` — pass (Svelte0 errors/warnings), `/tmp/task066-parent-typecheck.log`; changed cache/test LSP clean.
- Parent `pnpm exec tsx` launcher could not bind its IPC socket (`EPERM`); equivalent `node --import tsx --test` ran successfully without the launcher IPC server.
- `node --import tsx scripts/check-area-candidates.ts` — pass against actual78,320,210-point source, `/tmp/task066-real-cache-and-scan.log`. Fresh cache build26.21s; real100×100m scan5.32s,48,022,098 examined records, complete five-point numerical evidence. **Parent TMPDIR resolves to `/private/tmp/agents`, not the app runtime cache root. This is a fresh build/resource check, not repair of the affected directory.**
- Fresh-process `loadPreparedSemanticDiskIndex` reused that parent-temp cache with zero payload reads, `/tmp/task066-real-cache-warm.log`.
- Attempting the benchmark with the app's OS-temp root via `TMPDIR=/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T` failed immediately with `EPERM` on fixture `mkdtemp`, `/tmp/task066-affected-cache-and-scan.log`. No locks/permissions were bypassed; affected incomplete directory remains unchanged. Actual runtime recovery must run with access to that directory, normally through preparation in the app's environment.

Do not describe the affected runtime directory as repaired. The recovery implementation and isolated recovery tests pass; actual damaged-directory publication is permission-blocked in this parent harness.
