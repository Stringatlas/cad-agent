# 053 — Camera orbit center and edge detail

Status: Ready for review

## Goal / scope
Make navigation and adaptive detail usable away from the dataset center. Web-only disposable camera/render changes; no geometry authority, provider calls or unrelated dirty-worktree cleanup.

## Acceptance criteria
- [x] Double-click visible cloud/CAD content changes the orbit center; misses/modifier gestures do not. Rendered point vertices, including overrides, supply pivots rather than points on the picking ray. Targets outside navigation distance limits are rejected without mutation.
- [x] Wheel zoom follows the pointer rather than the old scene center.
- [x] Adaptive budget prioritizes the current inspection target, including distant dataset edges, while retaining ancestor payloads and the hard 3M ceiling.
- [x] Focused tests, typecheck/build and actual-cloud desktop/mobile browser checks recorded.
- [x] Task diff inspected, unrelated staged/unstaged work preserved; no commit.
- [ ] Fresh-session integrated review.

## Implementation / diagnosis
The old orbit target remains fixed absent pan/flight/programmatic focus. Wheel zoom targets that center. Adaptive candidates grant camera-near foreground absolute priority over inspected distant regions.

Both viewers now enable pointer zoom and double-click retargeting with lifecycle cleanup. `orbit-focus.ts` shares gesture filtering, rendered-vertex hit resolution and damping flush/retargeting. Toronto passes its current orbit target as the optional dataset-local `AdaptiveView.focus`. Focus-first budget allocation changes priority only: near radius/projected size eligibility, frustum culling, ancestors, hard budget, request cancellation and hysteresis remain intact. Focus can favor one visible region over others; it is not full detail for the whole cloud. Navigation guidance stays in existing collapsed help.

Bounded independent child review found two P2 issues (Points ray hit versus vertex; maxDistance eye jump), corrected with regressions. This is not fresh-session integrated approval.

## Graph risk / coverage
Repo-local GitNexus index dated 2026-10-19: viewer impacts UNKNOWN (Svelte callsites confirmed in Toronto, ClosestPole and Demo). Adaptive planner CRITICAL/validation HIGH: replan/update/configure/retry paths; warning surfaced before integration. New helper absent from index: UNKNOWN, source usages checked. Existing global dirty-worktree detect-changes reports 74 files/778 symbols/179 flows/CRITICAL and summary truncation despite limit10000; not clean certification. Artifacts `/tmp/lod-impact-{better,push,update}.txt`, `/tmp/lod-detect-changes-full.txt`. No commit requested.

## Verification evidence
Node22.23.3, pnpm10.34.6. Exact commands:

| Command/check | Result | Artifact |
| --- | --- | --- |
| `node --import tsx --test tests/orbit-focus.test.ts tests/orbit-stability.test.ts tests/adaptive-display*.test.ts tests/camera-flight.test.ts` | 69/69 pass after review fixes | `/tmp/task053-tests.log` |
| `pnpm typecheck` | Pass, 0 Svelte errors/warnings | `/tmp/task053-typecheck.log` |
| `pnpm build` | Pass; existing >500k bundle warning | `/tmp/task053-build.log` |
| `node --import tsx --test tests/*.test.ts` | Snapshot before final two review corrections: 926/931 pass, same five known task052 baseline failures | `/tmp/task053-full-tests.log` |
| `node --import tsx scripts/browser-orbit-lod-smoke.mjs http://127.0.0.1:9222 /tmp/task053-browser-final` | Five actual-cloud browser groups pass after review fixes; no page errors | `/tmp/task053-browser-final/report.json`, `desktop.png`, `mobile.png`, `*.ax.txt` |
| LSP | Helper/viewer/tests/script/adaptive clean; Toronto LSP cache still reports stale imported focus/setObjects signatures, while fresh typecheck/build pass | Tool output; authoritative fresh logs above |
| `git diff --check` and bounded source diff inspection | Pass | No whitespace errors |

Browser groups: peripheral cloud double-click moves orbit target >100m away from old center while preserving eye; zoom loads deeper native nodes at edge; orbit uses new pivot; off-center wheel shifts target; mobile resize stays valid. Resident points checked <=3M throughout. Desktop/mobile screenshots inspected (initial successful run `/tmp/task053-browser/{desktop,mobile}.png`); final rerun screenshots retained separately. Ephemeral servers/tab closed by script; operator servers untouched. No provider calls.

### Failures retained
- Initial unit assertion used exact equality for a target with ~6e-14m Three.js round-off; corrected to 1e-10m tolerance, not relaxed behavior.
- First browser fixture started at the default street view, not whole dataset; peripheral >100m point unavailable. Fixture now uses the actual Frame dataset UI before edge selection; no camera mutation backdoor.
- A later browser rerun failed to settle during street startup, before test interaction: camera unexpectedly at minDistance, 244 nodes still pending after90s. Cause unproven; retained `/tmp/task053-browser/report.json` and `/tmp/task053-browser.log`. Unchanged rerun passes at `/tmp/task053-browser-final`; do not erase or call the failed run passing.
- `pnpm exec tsx --test ...` blocked by sandbox IPC pipe EPERM; equivalent `node --import tsx --test ...` runs successfully without the CLI's auxiliary IPC server.
- Five full-suite baseline failures: agent screenshot/reference loop; initial-image proposal before EOF; scene-context conversation reset expectation; inspector UI source expectation; chat-first UI source expectation. These match task052's known failures and are outside this change. Full suite was not rerun after review corrections; final focused tests/typecheck/build/browser were.

## Next action
Fresh-session review against this task and actual bounded diff. Preserve tasks047–052 and operator `.pi/sandbox.json`; no staging/commit/cleanup requested.
