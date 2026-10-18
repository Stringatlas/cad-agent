# Task043 — restrained chat layout and composer

## Scope
Bounded UI cleanup requested by the user: remove persistent correctness narration, give conversation the available chat height, and clear successfully sent input without losing failed submissions or newer edits. No placement/backend changes.

## Acceptance
- Remove the original-dataset selection disclaimer and persistent context-change paragraph; retain evidence and context on demand.
- Scene references default collapsed, with compact discoverable names/types and removal/details still accessible. Auxiliary disclosures cannot crowd out conversation.
- Completed sends clear only the unchanged submitted draft; rejected, failed/cancelled submissions and edits made during an async send survive.
- Keep actionable errors and human Accept/Decline controls accessible.
- Run current compiler/tests/build; inspect desktop/mobile idle/selected/pending/error UI if an existing browser is available. Record blockers honestly.
- Preserve unrelated dirty work; no commit; fresh-session review pending.

## Implementation
- `Chat.svelte`: references default closed; single-line names/types preview and count remain discoverable. Reference and technical disclosures are capped at 20% height each when explicitly opened; existing details/removal controls remain.
- `ModelChat.svelte`: removed context-change banner and original-dataset selection paragraph entirely. Context/evidence remain in existing disclosures. Moved approval explanation into model/session settings (actual scene Accept/Decline controls unchanged). Removed routine completed/internal-code footer and duplicate failure narration; streaming uses a concise status and history-limit recovery stays visible. Per-message failure/recovery and blocked-authority messages remain.
- Composer captures submitted text and input-edit revision; clears only after a completed send with no intervening edits. Rejected, failed/cancelled sends retain draft/attachment. Newer edits, including edits back to the same text, survive async completion.

## Verification — 2026-10-17
- `pnpm typecheck`: pass; Svelte 0 errors / 0 warnings. `/tmp/task043-typecheck.log`.
- `node --import tsx --test tests/model-chat-ui-context.test.ts tests/model-chat-client.test.ts`: 79 pass. `/tmp/task043-chat-tests.log`.
- `node --import tsx --test tests/*.test.ts`: 771 pass, 0 fail. `/tmp/task043-all-tests.log`. Composer test executes the actual component handler against completion/rejection/error/cancellation/newer-edit states; this does not replace DOM/browser acceptance.
- `pnpm build`: pass; existing large-bundle advisory remains. `/tmp/task043-build.log`.
- LSP: TS test clean; no Svelte LSP configured, supplemented by current `svelte-check` above.
- `git diff --check`: pass. Scoped diff inspected; `/tmp/task043-ui.diff`.
- Graph: repository `cad-agent`, correct worktree, index one commit behind HEAD. Upstream impact for `Chat.svelte`, `ModelChat.svelte`, and component `send` unresolved/UNKNOWN (Svelte handlers not indexed); source confirms `App → Chat → ModelChat`, form-submit/Enter handlers. No pre-edit HIGH/CRITICAL warning. Aggregate `detect-changes --scope all --repo .` reports CRITICAL across existing dirty work (18 files / 89 symbols / 40 flows); not a task-only all-clear. `/tmp/task043-graph-changes.log`.

## Browser blocker / remaining acceptance
Browser skill read; no new Chrome launched and no user tab modified. Harness socket `/tmp/pi-browser-daemon.sock` missing; browser tools unavailable in this child. Investigated existing Chrome: port 9222 refused; existing Testing Chrome listener accepted basic version/target probes, but Playwright CDP timed out and subsequent attempt was explicitly rejected with HTTP 403. Stopped rather than bypassing access controls. `/tmp/task043-browser-probe.log`, `/tmp/task043-playwright-connection.log`. Desktop/mobile idle/selected/pending/error screenshots and actual DOM interaction remain **unverified**; parent should reconnect approved browser and inspect before acceptance.

## Status
Implementation complete; browser acceptance blocked; fresh-session review pending. No commit. Unrelated dirty files preserved. Handoff: `/tmp/task043-chat-ui-handoff.md`.
