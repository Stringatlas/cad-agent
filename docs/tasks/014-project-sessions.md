# Task 014 — Authoritative project sessions and scene context

## Assignment
User authorized the next couple of tasks and said Proceed. Implements roadmap item5's bounded single-user local authority/persistence gate and a deterministic scene-context seam. Not a model loop or CAD publication service.

## Acceptance
- One server authority supplies viewer/executor entities, units/frame and geometry revision; no browser geometry seed/fallback. Selection/camera remain disposable view state.
- Fixed operator-controlled snapshot path, bounded validated version/checksum envelope, atomic explicit Save, explicit Load and restart preserve IDs, coordinates and revision. Stale writes, corrupt/missing files fail explicitly without state changes. Load/restart invalidate old sessions/proposals; no HTTP paths.
- Scene entity selections and original synthetic point references named A/B reach deterministic harness context, bound to session/geometry revision, frame/origin, meter units and stable entity ID/point index. Validate exact original coordinates; stale/forged references rejected. Toronto remains separate; no implicit mapping.
- Save/Load/Refresh and context have browser evidence, pending/late responses cannot overwrite active state, failures have truthful feedback. Preserve existing picking/orbit/query/crop/chat paths.
- Appropriate deterministic tests, baseline/build, diff inspection and independent fresh-source review.

## Scope/exclusions
Single-user loopback service; explicit Save (not autosave); bounded synthetic project. No multiuser realtime synchronization, arbitrary dataset import, auth/provider/model calls or CAD body persistence. No A→B channel operation yet. Parameter edits belong to task015.

## Completion
Implemented all bounded acceptance criteria above. Backend owns authority/contracts/transitions/routes; frontend shares one controller snapshot across scene/chat and original synthetic A/B references; parent integrated documentation/verification. [User/API guide](../project-editing.md) documents exact grammar, transport, persistence and limits. No commits; preexisting architecture interactive-agent requirement preserved.

## Verification and review
Final commands from repository root, Node22.23.3/pnpm10.34.6:

```sh
pnpm verify
node scripts/browser-interactive-edit-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-interactive-final/interactive
node scripts/browser-shared-chat-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-interactive-final/shared-chat
node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-interactive-final/all-label
pnpm verify:browser http://127.0.0.1:9222
git diff --check
node .gitnexus/run.cjs analyze --index-only --pdg
node .gitnexus/run.cjs status
node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 1000
```

- Baseline **163/163 pass**, workspace/tests typecheck and build pass: `/tmp/spatial-interactive-final/verify.log`. Build retains >500KB chunk warning.
- Actual existing-Chrome **15 interactive**, **10 shared-chat**, **10 all-label/window**, **8 demo** checks pass, current bundle `index-pZSyhV8y.js`. Interactive/chat/all-label evidence: respective `/tmp/spatial-interactive-final/` directories/report.json and command logs. Demo evidence: `artifacts/browser/report.json` and screenshots; `/tmp/spatial-interactive-final/demo.log`. Owned unique temp persistence and backend/preview ports only; user3001 preserved. No Chrome launch or legacy Toronto3001 script run.
- Interactive checks include original A/B context, Save/restart preserving exact geometry/IDs/revision with fresh session, confirmed Load rotating session, stale/invalid rejection, noncooperative late work, ambiguous commit recovery, overlapping/failed Refresh receipt preservation and real WebGL loss/restoration. Runtime screenshots/authority equality JSON in `interactive/`; visible restoration and separate commit truth checked.
- Independent backend rereview **READY**, all three original findings resolved: `/tmp/spatial-interactive-backend-rereview/review.md`. Focused23/23, six adversarial checks, raw-socket malformed-target/foreign-authority policy and streaming-failure cleanup probes pass. Separate seeded and corrupt operator-state full suites **163/163 each**, operator bytes unchanged, production corrupt startup still fails. Exact commands/logs in review.
- Independent frontend rereview **READY**, prior Refresh inverse-receipt loss and runtime-context-loss findings resolved, no new actionable findings: `/tmp/spatial-interactive-ui-rereview/review.md`. Focused21/21, four independent controller probes, web typecheck0 errors/warnings. Supplied browser evidence was reviewed; parent independently reran final browser scripts above.
- Broad test/CLI/browser factory changes intentionally isolate operator persistence; not unrelated behavior refactoring. Reviews inspect actual tracked diff and new files, not only indexed symbols.
- Final graph refreshed at unchanged HEAD4dc9c76, covered146 files match. CLI/MCP detect reports **CRITICAL aggregate**,88 mapped symbols/33 tracked changed files/20 affected processes; `/tmp/spatial-interactive-final/graph-refresh.log`, `graph-status.log`, `graph-changes.log`, `graph-changes-mcp.json`. CLI displayed lists remain capped even with limit1000; repeated MCP query is also tool-output truncated (saved text is not complete JSON). Neither is a clean check. Untracked change mapping, Svelte/dynamic fields and process traversal remain incomplete (83 entry candidates/811 callees/30 walks omitted). Warning is not waived; no clean graph certification or commit gate claimed.
- Parent `lsp_diagnostics('*')` reports **219 cached errors +2 hints** in19 files, chiefly obsolete missing exports already present in source. Saved diagnostics: `/tmp/spatial-interactive-final/lsp-diagnostics.txt`; CLI tsc/svelte-check pass. No source workarounds or claim of clean LSP. Child LSP had tree-sitter/no semantic server; CLI checks supply semantic verification.

## Remaining limits and next action
Single-user loopback, explicit Save, no multiuser/auth/model/channel/project CAD publication. Full page reload without held inverse disables Undo safely; camera remount resets view. Forced WebGL restoration/disposal retains13 Chrome/Three stale-object deletion warnings; same-canvas drawing and authority preservation pass, no unexpected errors/pageerrors. CAD sandbox is startup-bound and rejects edit/Load-stale source until restart.

Focused fresh-context backend/UI reviews are complete; **final whole-checkout fresh-session review remains pending**, including final documentation/evidence and tooling reconciliation before any graph-certified commit. Do not treat task completion as approval of earlier pending task reviews. Next action: fresh session review against tasks014/015 and actual whole diff, not automatic implementation expansion.
