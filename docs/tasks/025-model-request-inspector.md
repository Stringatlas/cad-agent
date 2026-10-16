# Task025 — Actual model request inspector

Status: implemented; independent incremental task025 review found no actionable defects. Separate whole-checkout fresh-session review remains pending.

## Authorized scope
Expose an in-memory, bounded, safe inspection of each effective provider request in chat, including tool rounds and continuations. Preserve existing chat/account behavior and read-only tool authority. No live inference, account mutation, configuration changes, service restarts, index repair or commits.

## Acceptance criteria
- Snapshot derives from the same effective body dispatched to the provider; shows actual `instructions`, input roles, visible history, scene provenance, tools/calls/results, model/mode/options. Never invent a system message or claim provider-internal mapping.
- Explicit omissions for credentials/auth headers and opaque reasoning; allowlisted representation, bounded memory and no persistent request logs or browser storage.
- Prepared/dispatched/completed/failed/cancelled lifecycle remains truthful. Display-only retained history is distinguished from active server continuation.
- Fake-provider tests cover request parity, omissions, tool rounds, continuation, bounds and lifecycle. Client tests cover validation, retention, cancellation and stale gates.
- Inspect rendered UI with isolated fixtures and no operator account/provider access; record commands and artifacts. Independent review is separate from implementation.

## Execution / delegation
Backend/contracts and deterministic provider tests delegated with exclusive ownership of server request-inspection code, contracts and server tests. Parent owns web client/UI, client tests, task and usage documentation. Independent child reviews the completed diff and test evidence. Checks: LSP diagnostics after edits; focused tests; `pnpm verify`; browser fixture check; final diff/graph analysis with limitations recorded.

## Results

All bounded acceptance criteria implemented. Backend derives a safe snapshot from the detached effective request body used for dispatch, every round/continuation. Actual instructions/roles/options/tools and visible replay are shown, with explicit credential/header, opaque-reasoning, unknown-field and truncation omissions. Snapshots are capped at 48 KiB/128 input items/12,000 text characters; browser snapshot retention has a separate 256 KiB budget with visible oldest-entry eviction counts. Local cancelled/interrupted monitoring never claims confirmed provider termination. Read-only tool authority unchanged; no persistent request logging/browser storage added.

Start checkout was clean at HEAD `f106be3`; predecessor task023/024 work was already present in that commit and was not reset. No commit, live inference/account mutation, configuration change, service restart or graph repair performed.

### Exact verification
- Node `v22.23.3`, pnpm `10.34.6`.
- `pnpm exec tsx --test tests/model-request-inspection.test.ts tests/provider-model.test.ts tests/model-chat.test.ts tests/provider-model-auth.test.ts tests/model-diagnostics.test.ts`: **152 passed**; `/tmp/spatial-task025/backend-tests.log`.
- `pnpm exec tsx --test tests/model-request-inspection-client.test.ts tests/model-chat-client.test.ts tests/model-chat-ui-context.test.ts`: **125 passed**; `/tmp/spatial-task025-client-tests.log`. Tests include malformed phase sequences, three rounds/continuations, stale/cancel/disconnect handling and 16-turn eviction bounds.
- Final `pnpm verify`: **532 passed**, workspace/tests typecheck and builds pass; `/tmp/spatial-task025/verify.log`. Svelte zero errors/warnings; existing Vite >500 kB bundle advisory. Initial verify caught TypeScript assertion-induced narrowing in a new test; corrected without weakening assertions before final pass. An initial client regression run also caught unnecessary message cloning; fixed to preserve retained-message identity when no eviction is needed.
- LSP requested after edits. Parent session retained stale missing-contract-export diagnostics; no Svelte LSP configured. CLI full typecheck is clean; child diagnostics were clean. No workaround/index repair claimed.
- `node /tmp/spatial-task025/browser.cjs`: **33 fixture assertions passed**, nine paired AX/screenshots visually inspected desktop/mobile; `/tmp/spatial-task025/browser-metrics.json`, `browser-run.log`, `browser-handoff.md`. Existing Chrome CDP, new isolated context, own ephemeral static server, deny-all Fetch interception before navigation, explicit redirect-hop denial proofs; only fake provider/account fixtures. Own resources cleaned up. No live service access. Empty scene intentional; no live inference or geometry certification.
- Independent fresh-context incremental review: **no actionable defects**; `/tmp/spatial-task025/independent-review.md`. Independently ran **239 focused tests**, `pnpm typecheck`, encoded frame-bound probes and `git diff --check`. This is not whole-checkout or live-provider approval.
- Final diff inspected, `git diff --check` passes. `gitnexus_detect_changes(scope:all)` and `node .gitnexus/run.cjs detect-changes --scope all --repo .` rerun; aggregate **CRITICAL** risk (39 indexed changed symbols/29 affected). MCP output clipped and CLI summarizes capped listings; one-commit-stale index excludes new files. This is **not clean graph certification**. Source/tests and independent direct review cover actual tracked/untracked diff; no graph repair or commit authorized. CLI evidence `/tmp/spatial-task025/graph-changes-cli.txt`.

### Remaining limits / next action
No live provider verification authorized or performed. Browser fixtures exercise presentation/lifecycle; backend parity/security is established by deterministic fake-fetch tests, not synthetic browser events. Browser eviction stress is covered in client tests, not rendered browser stress. Whole-checkout fresh-session review remains pending separately. Next milestone may be planned independently; no expanded tool/CAD authority is included here. Completion handoff: `/tmp/spatial-task025/completion-handoff.md`.
