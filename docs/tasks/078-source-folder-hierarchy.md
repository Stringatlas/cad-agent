# 078 — Organize application source folders

Status: Ready for review

## Ownership

- Implementation owner: Codex
- Review owner: Unassigned (fresh session)

## Goal and scope

Organize `apps/web/src` and `apps/server/src` by responsibility while preserving
behavior and existing uncommitted DALES work. Keep application entrypoints at the
source root; move implementations and update imports, runtime asset paths,
source-inspection tests, scripts and current documentation. No API or symbol
renames, behavior changes, new dependencies or package-boundary changes.

## Acceptance criteria

- [x] Source roots contain only entrypoints and folder documentation.
- [x] Related modules live together with direct, resolving imports.
- [x] Worker bootstrapping, server `.env` and dataset paths retain their targets.
- [x] Typecheck/build pass; full-suite results compared with the pre-move baseline.
- [x] Diff inspected for path-only changes and preservation of existing work.
- [ ] Fresh-session review completed (pending independently of implementation).

## Progress and risk

Completed 118 file moves. Web folders group auth/chat/shared components, shared
viewer helpers, DALES, and Toronto features. Server folders group agent, auth,
CAD, datasets, spatial queries/indexes, preprocessing, placement and scene state.

Both source roots now have a README map. Imports, dynamic module/worker paths,
configuration/data URLs, source-reading tests, scripts and current documentation
follow the new paths. Application code differs from the initial working tree only
in relative path literals. All 118 destinations are visible to Git; a narrow
`.gitignore` exception includes `apps/server/src/datasets/` without changing the
general dataset-asset ignore rule. Existing DALES work was preserved.

Pre-edit GitNexus analysis covered all moved files, application entrypoints and
representative server/worker symbols. `semantic-artifact.ts` and
`semantic-disk-index.ts` are HIGH risk (25/21 direct importers); callers include
queries, placement, point/object state and preprocessing. `createDemoServer` and
`ProviderModel` are MEDIUM; `CadWorkerClient` is LOW. Svelte/dynamic references
with UNKNOWN impact were checked against source imports and literal references.
File-level reports omit process axes; graph process coverage is truncated, so
these reports are not proof of complete runtime coverage.

## Verification evidence

- Node v22.23.3; pnpm 10.34.6.
- `node .gitnexus/run.cjs analyze --index-only`: completed after retry with
  access to the global registry lock. CLI used the refreshed index; MCP metadata
  continued to report the cached index as three commits behind.
- `python3 /tmp/source-hierarchy-impact.py`: 125 upstream impact targets;
  `/tmp/source-hierarchy-impact.json` and
  `/tmp/source-hierarchy-impact-summary.txt`.
- Pre-move `pnpm test`: 1,163 passed, 14 failed (1,177 tests), saved to
  `/tmp/source-hierarchy-baseline-tests.log`. Initial sandbox attempt was blocked
  by tsx IPC permissions; actual baseline ran with local IPC/network access.
- Original text snapshot: `/tmp/source-hierarchy-before.json` (local diagnostic;
  do not copy wholesale into handoffs). Move map: `/tmp/source-hierarchy-moves.json`.

## Final verification

| Command/check | Result | Artifact |
| --- | --- | --- |
| `pnpm typecheck` | Pass, including tests; Svelte 0 errors/warnings | `/tmp/source-hierarchy-typecheck.log` |
| `pnpm build` | Pass; Vite warns about the large app chunk | `/tmp/source-hierarchy-build.log` |
| `pnpm test` | 1,162 pass / 15 fail: 14 baseline failures plus shared-temp-directory cancellation interference | `/tmp/source-hierarchy-tests.log` |
| `pnpm exec tsx --test --test-name-pattern='cancellation at build' tests/semantic-disk-storage.test.ts` | Pass, 1/1 | `/tmp/source-hierarchy-cancellation.log` |
| `pnpm exec tsx --test --test-concurrency=1 tests/*.test.ts` | 1,163 pass / 14 fail; exact same failures as pre-move baseline | `/tmp/source-hierarchy-tests-serial.log`, `/tmp/source-hierarchy-test-comparison.json` |
| `python3 /tmp/source-hierarchy-audit.py` | 121 app files differ only by relative paths; all retain original targets through the move map; unrelated DALES work preserved | `/tmp/source-hierarchy-audit.log` |
| `git check-ignore --stdin` with all 118 destination paths | No destinations ignored | Move map above |
| `git diff --check` | Pass | No whitespace errors |

Initial post-move checks exposed three stale test paths, now corrected: provider
auth's `.js` specifier, the Markdown Vite SSR URL, and the lazy tools-route import
assertion. No acceptance assertions were removed or relaxed.

GitNexus `detect_changes({scope: "all", repo: "cad-agent"})` initially reported
CRITICAL and a truncated listing against old paths. Retried via CLI with
`--limit 10000`, then refreshed the index after moves and reran detection. The
post-refresh report is saved as `/tmp/source-hierarchy-detect-final.json`; the
CLI companion is `/tmp/source-hierarchy-detect-final.txt`. Final detection reports
37 symbols, 0 affected processes, LOW risk, with no partial/truncated flag. Untracked move
destinations are not fully represented by the ordinary git diff used by that
tool; the path audit and build/test checks cover the moved source directly.

Browser checks were not run: rendering, markup, styles and interaction logic are
unchanged, verified by the application path-only audit. No browser pass is claimed.
The task-relative diff is `/tmp/source-hierarchy-review.diff`; ordinary unstaged
git diff presents moved tracked files as deletions until their destinations are
staged. No commit or staging was performed.

## Remaining work

The 14 baseline failures remain outside this reorganization. Fresh-session review
is the next action. Redacted handoff:
`/tmp/spatial-cad-source-hierarchy-handoff.md`.

## Review

Fresh-session review pending.
