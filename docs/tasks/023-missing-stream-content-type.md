# Task023 — Plan-stream parser compatibility

Status: implemented; bounded live ChatGPT-plan success, baseline verification and independent incremental review complete. Whole-checkout fresh-session review pending.

## Scope and acceptance

User authorized fixing confirmed implementation issues, otherwise report uncertainty. Two over-strict assumptions in `apps/server/src/provider-model.ts` blocked the actual plan response:

1. Absent/empty Content-Type was rejected before SSE validation. It now enters the SAME strict SSE parser. Explicit incompatible media types still fail with bounded closed diagnostics; no JSON fallback.
2. The completed event repeated no output items (`output: []`), despite full finalized `output_item.done` snapshots. Recover ONLY this explicit empty-array case from complete done snapshots sorted by wire index. Existing index bounds imply contiguous snapshots and no unfinished observed added items. Never recover added snapshots/deltas; nonempty partial arrays, missing/null output, identity/content conflicts and gaps remain rejected.

Completion + EOF, UTF-8, identity, canonical structure, byte/output/history budgets, cancellation, downstream publication and history checks remain. Tools execute only after successful parser EOF; only complete turns enter retained history. No endpoint changes, retries, billing fallback, credentials/raw provider logs, manual service restarts, index repair or commits. Temporary closed-check probe was removed before final verification.

This supersedes task021/022 rejection of absent/empty MIME and task020's requirement that the terminal array repeat every finalized item. Criteria changed from evidence, not merely to pass tests. Official SDKs accept empty terminal output but return the explicit empty array; retaining finalized snapshots is a deliberately bounded app replay policy, not a claim of exact SDK reconstruction behavior.

## Evidence and sources

- Official SIWC request/terminal guidance: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.md (fresh HTTP200 download `/tmp/spatial-task023/official-inference.md`). Request already matched public endpoint, `store:false`, `stream:true`, model catalog, instructions and tools; no speculative endpoint change.
- Official Responses event docs: https://developers.openai.com/api/reference/resources/responses/streaming-events.md (`output_item.done` supplies finalized item, completion required).
- Official SDK comparison, pinned source URLs and relevant quotations: `/tmp/spatial-task023/sdk-semantics.md`. Helpers allow completed streams with empty terminal output and finalized items; do not attribute app reconstruction policy to SDK behavior.
- Five small, explicitly initiated diagnostic UI sends, same ChatGPT-plan model `gpt-6.1-sol`, prompt `Reply with exactly OK. Do not call any tools.` No automatic retry/fallback; each observed resource count changed by one. Baseline05:15:59Z failed `provider-format-missing`; MIME-only change05:17:06Z reached partial OK then `provider-protocol`; closed-check probe05:18:44Z identified `terminal-index`; structural-only probe05:21:04Z established empty terminal output/allAddedDone/doneContiguous/hasDone all true. Final05:22:20Z completed with assistant `OK`, phase completed/state complete. Timestamps UTC2026-10-16.
- Actual structural probe PID68241 matched listening backend. Private closed artifact `/var/folders/8p/bsh3sqfj7jz3845t18zr_51c0000gn/T/spatial-task023-probe-4znRso/check-68241-1.json`. Probe stored only check + four booleans, no provider text/IDs/headers/credentials, max8 records/process, private temp dir/files. Temporary probe code is absent from final diff.
- Browser harness setup failed at daemon socket; used Playwright CDP against existing Chrome9222 and existing app tab only. Watcher source reload rotated backend session; reloaded app between tests to bind fresh authority, no manual restart. No geometry edits or user pins were present. Final UI artifact `/tmp/spatial-task023/live-fixed.log`; intermediates `live-after.log`, `live-probe.log`, `live-shape.log`. Baseline result captured in session; scripts `/tmp/spatial-task023-live.cjs`, `/tmp/spatial-task023-browser.cjs`.

## Verification

- `pnpm exec tsx --test tests/provider-model.test.ts` →96passed,0failed; `/tmp/spatial-task023/focused.log`. Covers absent/empty MIME valid/invalid, JSON/HTML/appearance alone, refusal/opaque replay, tool wait-for-EOF, cancellation, invalid identity/unfinished/gapped items, existing wrong-MIME/conflict/budget checks.
- `pnpm verify` →460passed,0failed; CLI server/tests TypeScript, Svelte0errors/0warnings and production build pass; `/tmp/spatial-task023/verify.log`. Existing Vite chunk-size warning. Initial full run found stale integration expectation for missing-MIME non-SSE; updated to require actual interrupted-stream failure, plus HTTP end-to-end successful reconstruction/replay test. No runtime change after independent final source review.
- Parent LSP still reports pre-existing stale contract/auth exports (11provider/7provider-tests/11route-tests); CLI compilers pass, child LSP clean. No unrelated workaround.
- Independent incremental review: no introduced defects;96focused +21adversarial synthetic probes, independent typecheck pass. `/tmp/spatial-task023/final-independent-review.md`, `final-independent-focused.log`, `final-independent-probes.ts`, `.log`, `final-independent-typecheck.log`. Whole-checkout fresh-session review remains distinct and pending.
- `git diff --check` passes. Final source diff inspected; bounded to parser, regression tests and docs.

## Risk and boundaries

Clean starting HEAD7d9c297; no unrelated changes present at task start. GitNexus cad-agent readResponse upstream LOW: ProviderModel.turn → model-chat route handle. Index one commit behind, source corroborated. Test files UNKNOWN; package script explicitly enumerates tests/*.test.ts. `detect_changes(scope:all)` reports aggregate HIGH (25symbols/7flows/4files), no truncation flag; stale indexed positions include false-positive touched nested symbols. Treat as review priority, not clean graph certification; no index repair/commit.

Parent owns bounded implementation/test/browser; isolated child reviewed source and adversarial probes; separate child researched official SDK semantics. No module boundary change. Live success is one simple text turn, not API-key/model-wide/tool-continuation/account eligibility or CAD certification. Account connection UI request remains separate and pending. Next: fresh-session review against actual diff; then return to that pending UI scope if requested.
