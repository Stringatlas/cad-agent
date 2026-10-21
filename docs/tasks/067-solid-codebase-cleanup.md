# Task067 — bounded SOLID transport cleanup

## Scope and acceptance (defined before implementation)

Behavior-preserving consolidation of the duplicate Toronto CAD and authored-object browser JSON transports. Keep public transport signatures, endpoint paths, request encoding, response limits/errors, cancellation, existing read-only retry allowlist, and all controller approval/revision checks unchanged. No UI/rendering changes, provider calls, authority/controller unification, or generic HTTP framework.

- [x] Extract a narrow Toronto authority JSON transport responsibility; clients retain domain policy and validation.
- [x] Characterize both existing transports before extraction: exact actions/body/signal, MIME/size/JSON/envelope errors, no mutation retries, abort propagation, different refresh retry policies.
- [x] Run the same characterization tests after extraction and existing authority/controller tests.
- [x] Run LSP diagnostics and CLI typecheck; inspect scoped diff for unrelated changes.
- [x] Record exact results and limits; independent focused review completed with no actionable findings.

## Baseline / ownership

Owned existing files: `apps/web/src/scene-object-client.ts`, `apps/web/src/toronto-cad-client.ts`. New files: `apps/web/src/toronto-authority-transport.ts`, `tests/toronto-authority-transport.test.ts`, this task. Preserve every other file. Baseline copies, HEAD and scoped diff: `/tmp/agents/task067-solid-baseline/` (working tree clean at capture).

Graph-first context and impact: `sceneObjectTransport` UNKNOWN/no graph callers; source search confirms default constructor dependency in `SceneObjectController`. `torontoCadTransport` LOW/one direct test-file caller; source also confirms default `TorontoCadController` dependency. CLI `TMPDIR=/tmp/agents node .gitnexus/run.cjs analyze --index-only` succeeded, but MCP still reports the previous three-commit-stale graph; graph freshness/certification unresolved. Analyzer also reports incomplete/truncated process enumeration. No commits.

## Verification / completion

## Abstraction / additions / removals

Added `torontoAuthorityRequest`, a narrow shared transport for these two Toronto authority endpoints. It owns action routing, JSON request encoding, existing MIME/text-size/envelope checks and result extraction. Domain clients retain explicit endpoint/limit/error policies, public transport types and injectable controller transports. Removed duplicate mechanics from the two exported transport bodies. No authority validation, approval gates, controller lifecycle logic or read-only retry policy moved or removed. No framework, class hierarchy, dependency or UI change. Override transport deliberately remains separate: its timeout, strict envelope and error policy differ.

## Exact checks

- Before extraction: `TMPDIR=/tmp/agents node --import tsx --test tests/toronto-authority-transport.test.ts` — **7/7 pass**, log `/tmp/agents/task067-solid-baseline/characterization-before.log`.
- After extraction: `TMPDIR=/tmp/agents node --import tsx --test tests/toronto-authority-transport.test.ts tests/toronto-readonly-fetch.test.ts tests/scene-object-client.test.ts tests/toronto-cad-client.test.ts tests/point-override-client.test.ts` — **44/44 pass**, log `/tmp/agents/task067-focused.log`. Includes existing exact reviewed-candidate publication, decline/Undo, stale replies, cancellation and mutation-no-retry coverage.
- `TMPDIR=/tmp/agents pnpm typecheck` — **pass**, Svelte 0 errors/0 warnings; log `/tmp/agents/task067-typecheck.log`.
- LSP diagnostics for both edited clients, new helper and characterization test — **clean**. Parent workspace-wide cached diagnostics still report 12 errors in unrelated area-candidate files plus two hints; CLI typecheck/build pass. Workspace LSP is not certified clean.
- `git diff --check` — **pass**; scoped diff manually inspected: only two existing transport bodies/imports changed, no controller changes.
- `gitnexus_detect_changes({repo: 'cad-agent', scope: 'all'})` — two expected changed transport symbols, one affected `SceneObjectTransport → Clean` flow, medium aggregate risk. This does **not** certify the new untracked helper/tests or resolve MCP freshness/process truncation.

- Parent: `TMPDIR=/tmp/agents pnpm build` — **pass**, log `/tmp/agents/task067-build.log`; Vite reports a >500 kB chunk-size warning.
- Independent read-only fresh-agent review against HEAD `a547f8a`: **no actionable findings**; independently reran the focused checks, **44/44 pass**. This is a focused Task067 review, not whole-checkout certification.

No full-suite/browser run; no UI or rendering changes authorized. No provider inference or production/orphan server interaction. Whole-checkout review remains separate. Handoff: `/tmp/agents/task067-solid-handoff.md`.
