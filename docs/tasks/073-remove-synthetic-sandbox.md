# Task073 — Remove synthetic sandbox

## Scope / result
User authorized hard deletion of all synthetic sandbox UI, agent tools, backend, persistence, fixtures and tests; preserve Toronto and unrelated work. Removed synthetic viewer/project controls, box parameter proposal stack, project/session/chat routes, synthetic model mode/reference/skill/schema, generator and dedicated tests/browser scripts. Kept Toronto CAD/points, human approval and Tools inspector. Generic geometry helpers and generated Toronto fixture data are not the removed sandbox. Historical task records remain history.

## Verification
- `pnpm typecheck`: PASS, web zero warnings (`/tmp/task073-typecheck-final.log`).
- `pnpm build`: PASS (`/tmp/task073-build-final.log`).
- `node --import tsx --test tests/*.test.ts`: 1144/1157 pass; 13 failures remain (`/tmp/task073-tests-final.log`). Failures concern legacy removed decision-workflow expectations and UI source assertions; not claimed clean baseline or completed regression certification.
- `git diff --check`: PASS.
- Browser: checked scene selector only has Toronto3D/Find nearest. Desktop and mobile error-state shell screenshots `/tmp/task073-desktop.png`, `/tmp/task073-mobile.png`. Backend unavailable during this check; no loaded-scene/selected/pending runtime certification.
- GitNexus pre-edit impacts run; some UNKNOWN/stale edges confirmed with source search. Whole-checkout detect_changes is CRITICAL across extensive pre-existing changes and output truncated; not a clean graph gate. No commit.

## Next
Fresh-session review pending. Review actual diff against scope and remaining test failures; do not confuse unrelated existing dirty changes with this task.
