# Project instructions

## Goal
Build and evaluate a VLM harness for inspecting point-cloud
scenes and making verified CAD edits.

## Architecture
- Pi is development tooling, separate from the product agent.
- The viewer displays project state; it does not own geometry.
- The product harness accesses geometry through adapter interfaces.
- Keep units, coordinate frames, entity IDs, and revisions explicit.
- Read docs/architecture.md before changing module boundaries.

## Commands
- Use Node 22 (`>=22.12 <23`) and pnpm 10.34.6 (pinned in package.json).
- `pnpm install --frozen-lockfile`; `pnpm dev` (web :5173, server :3001).
- `pnpm build` emits the web bundle; server build only typechecks.
- `pnpm typecheck`; `pnpm test`; `pnpm verify` (all baseline checks).
- `pnpm verify:browser [CDP endpoint]` checks the built viewer with existing Chrome.
  Run `pnpm build` first. Browser availability is not implied by baseline passing.

## Module boundaries
- `@spatial/contracts`: shared types and runtime assertions, no framework imports.
- `@spatial/project-state`: authoritative entities, coordinates and state transitions.
- `@spatial/geometry`: adapter boundary and analytic bounds, no UI dependencies.
- `@spatial/agent-harness`: product interfaces, no Pi/UI/direct-kernel imports.
- `apps/web` owns disposable render caches; `apps/server` is read-only scaffolding.
  Their demo snapshots are independent; no synchronization exists yet.
- The rendered box is a mesh proposal, not an OpenCascade body.

## Working procedure
- Read the assigned task and inspect relevant code before editing.
- If no task exists, write a short task with acceptance criteria.
- Proceed with reversible implementation inside the agreed scope.
- Ask only when unresolved ambiguity materially changes behavior.
- Update task status at meaningful checkpoints, not every tool call.
- Keep changes bounded; avoid unrelated refactors.

## Skills
- Rendering, picking, transforms: spatial-rendering.
- CAD operations and tessellation: geometry-integration.
- Product-agent tools and benchmarks: harness-evaluation.
- Browser checks: inspect and use pi-browser-harness.
- Before stopping or transferring work: inspect and use handoff.
- Use GitNexus for cross-module exploration and impact analysis.
  Verify findings against source; refresh stale indexes only when needed.
  No index exists yet; do not generate one for routine foundation checks.

## Verification
- Run checks appropriate to the change.
- Inspect browser behavior for rendering or interaction changes.
- Record exact commands, results, and diagnostic artifact paths.
- Never report an unrun check as passing.
- Never weaken acceptance checks merely to make a change pass.
- Before review, inspect the diff for unintended changes.

## Completion and handoff
- Record completed criteria, remaining failures, and next action.
- Follow the installed handoff skill: save a redacted handoff under the OS temp
  directory, reference repository artifacts, and include suggested skills.
- Leave fresh-session review pending; never equate implementation with review.
- Review in a fresh session against the task and actual diff.
- Preserve unrelated user changes.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **cad-agent** (220 symbols, 425 relationships, 9 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/cad-agent/context` | Codebase overview, check index freshness |
| `gitnexus://repo/cad-agent/clusters` | All functional areas |
| `gitnexus://repo/cad-agent/processes` | All execution flows |
| `gitnexus://repo/cad-agent/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
