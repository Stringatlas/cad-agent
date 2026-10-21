# Task069 browser evidence — passed mocked-provider integration

## Command and ownership
- `node --import tsx scripts/browser-scene-exploration-smoke.mjs /tmp/task069-browser-child-final` — **passed**, twice (second run includes explicit scrolling of the recovered answer into the mobile transcript viewport before its screenshot).
- Runtime: Node 22.23.3, pnpm 10.34.6. Parent reports `pnpm typecheck` and `pnpm build` passed before this continuation; this child did not rerun them.
- Owned ephemeral headless Chrome profile, SwiftShader WebGL, synthetic original-source dataset/project, real backend and Vite on OS-assigned listeners. No production development listeners touched, AOI seam, numeric scan seam, paid inference, or authoritative geometry mutations.
- Provider only mocked. Capture-inspection seam exposes the existing viewer capture method solely to inspect image pixels; it does not inject marks/AOI, bypass the client, or replace product callbacks. This is a Vite-source integration check, not execution of the built production bundle.

## Verified on desktop 1440×900 and mobile 390×844
- Actual provider rounds load `candidate-assessment`, inspect scene/source bounds, request an arbitrary-camera RGB capture, and receive image bytes matching the returned SHA-256. Custom capture preserves live camera and orbit target.
- Model fixture supplies three arbitrary coordinates without a deterministic candidate pool; original-source radius query returns complete count and bounded examples.
- Marks preserve IDs while moving/removing/reordering into C1/C2; stale annotation revision returns conflict, followed by actual current-mark read and completed recovery response.
- Real UI bridge and renderer display readable C1/C2 labels, including text/background pixel checks, nonoverlap, canvas containment and hypothesis-panel avoidance. Selecting C2 updates accessible pressed state, panel highlight and rendered label highlight.
- Ordinary send retains marks. Actual New chat clears UI/renderer/revision; a subsequent conversation accepts revision zero and displays a new C1.
- Initial/final point-override, CAD and scene-object authority snapshots are equal. No area shortlist or geometry proposal appeared. No page/console errors were recorded.

## Artifacts and visual inspection
Root: `/tmp/task069-browser-child-final`; command log: `/tmp/task069-browser-child-final.log`.
- `report.json`: both viewport checks passed, empty error list, label boxes/pixel counts, capture metadata and camera state.
- `actual-provider-bodies.json`, `tool-results.json`, `{desktop,mobile}-{explore,resume,reset}-stream.ndjson`: synthetic provider inputs, real tool results and server streams.
- `{desktop,mobile}-{initial,final}-authorities.json`: unchanged authoritative state.
- Inspected with image reads: `{desktop,mobile}-01-idle.png`, `-02-recovery-chat.png`, `-03-marked.png`, `-04-selected.png`, `-05-new-chat-clear.png`, and `-06-new-chat-remarked.png`; corresponding `.ax.txt` snapshots saved.
- Idle views have no hypothesis overlay. Marked views show legible C1/C2 plus rationale/unknowns; selected views distinguish C2 by text label, gold marker and selected panel state. Mobile labels avoid the bottom hypothesis sheet. Recovery answer is readable after normal transcript scrolling. New chat removes old annotations; desktop newly remarked C1 is visible. Mobile newly remarked screenshot has chat open, so its scene marker is covered; renderer state is asserted, not visually certified in that particular screenshot.
- `{desktop,mobile}-delivered-custom-capture.jpg`, `-marked-capture.jpg`, `-selected-capture.jpg` preserve provider-delivered/custom and pixel-checked images (capture files may contain PNG bytes despite the diagnostic `.jpg` suffix).

## Final post-review rerun
- `node --import tsx scripts/browser-scene-exploration-smoke.mjs /tmp/task069-browser-postreview` — **passed**, exit 0, after the parent's objects-binding and failure-cleanup changes. Log: `/tmp/task069-browser-postreview.log`; artifacts: `/tmp/task069-browser-postreview/report.json` plus provider bodies, tool results, streams, authority snapshots and screenshots in the same directory.
- Desktop 1440×900 and mobile 390×844 passed all assertions listed above; report error list is empty. Provider remains mocked; no paid inference or geometry mutation.
- Directly inspected final `desktop-03-marked.png` and `mobile-03-marked.png`: C1/C2 remain readable, separated and clear of the hypothesis panel on both viewports. This rerun added no source changes; only this evidence document was updated.

## Changes, limits and next action
This continuation changed only the runner's recovery-screenshot scroll and this evidence document; no product UI fix was necessary after the parent's client allowlist/reset fixes. All source/query/authority assertions remain intact. Script LSP diagnostics: clean. Graph impact for `shot` returned UNKNOWN/ambiguous because this new script is absent from the index; text/source inspection confirmed the runner is isolated. No low-risk inference was made from absent graph callers.

This verifies transport, rendering and lifecycle with deterministic model output, not actual model judgement, paid inference, real Toronto-scale performance, arbitrary camera/occlusion coverage, full geometry approval, or the full test suite. Chrome ProcessSingleton permissions blocked the parent's separate launch; this child-owned launch succeeded. `pi-browser-harness` and `spatial-rendering` skills were not installed; browser-policy, visual-QA and handoff guidance were read. No commit; unrelated changes preserved. Fresh-session review remains pending.
