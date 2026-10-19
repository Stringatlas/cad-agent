# Task 058 — Area of interest in Scene hierarchy

Implemented: move contextual AOI status (All heights/Capturing) and Clear into the existing Scene hierarchy. Remove floating AOI panel/styles. Preserve outline, selection/capture callbacks, chat context and visible error recovery unchanged.

Files: `apps/web/src/SceneObjects.svelte`, `apps/web/src/Toronto.svelte`, structural regression in `tests/workspace-ui-hierarchy.test.ts`.

Verification already run: `pnpm typecheck` and `pnpm build` passed (logs `/tmp/task058-typecheck.log`, `/tmp/task058-build.log`). Test invocation blocked by tsx IPC EPERM (`/tmp/task058-tests.log`), not retried. Cached LSP reports pre-existing `toronto-viewer.ts:486` error; typecheck has zero errors. User explicitly requested no further tests for this small task; browser checks not run. Fresh-session review pending. No commit; preserve unrelated dirty changes.
