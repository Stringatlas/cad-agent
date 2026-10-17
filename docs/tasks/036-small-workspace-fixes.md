# 036 — Small workspace fixes

Status: Implemented; fresh-session review pending.

User scope (YAGNI): stop requiring manual credential lock deletion after changes; Enter sends chat and Shift+Enter inserts newline; pending scene markers keep the same single number, distinguished only by color. No unrelated refactoring. Existing dirty032–035 preserved.

- Auth root cause: startup deliberately rejected even crash-stale PID locks. `provider-auth.ts` now recovers only strictly validated locks whose owner is confirmed dead (`ESRCH`), serializes concurrent recovery, and checks file identity on release. Live/uncertain/malformed/symlink locks remain fail-closed. Tests use temp directories, never operator credentials. PID reuse remains conservative; interruption during the tiny recovery window may leave a fail-closed `.lock.recover` guard.
- `ModelChat.svelte`: Enter sends through existing guarded send, Shift+Enter preserves newline; IME composition and key repeats do not submit.
- `toronto-viewer.ts`: pending copies use the same number-only badge as originals; amber/mint colors remain distinct. Review-card explanation and individual approval are unchanged.

Verification:
- `node --import tsx --test tests/*.test.ts`: 700/700 pass (`/tmp/task036-tests.log`). Includes five new lock safety/recovery tests and concurrent child-process contention.
- `pnpm typecheck`, `pnpm build`: pass (`/tmp/task036-typecheck.log`, `/tmp/task036-build.log`). Existing Vite bundle-size advisory.
- `node --import tsx scripts/browser-chat-point-moves-smoke.mjs http://127.0.0.1:9222 /tmp/task036-browser`: five groups pass, now using Shift+Enter/newline then Enter/send. Isolated temp authority/fake provider, existing Chrome only, empty console errors. Number-only colored badges visually checked in `/tmp/task036-browser/01-two-originals-two-ghosts-desktop.png`; mobile captures also retained.
- LSP auth/TS files clean; no Svelte LSP, verified with svelte-check. `git diff --check` passes.
- Graph auth impacts CRITICAL due to shared OAuth/server callers (pre-edit worker warning); frontend marker LOW and Svelte UNKNOWN source-confirmed. Index refreshed; combined dirty-tree detect-changes remains aggregate CRITICAL with bounded/truncated coverage, not a clean certificate. No commit.

Next: fresh-session bounded review, preserving all earlier work. Handoff `/tmp/task036-handoff.md`.
