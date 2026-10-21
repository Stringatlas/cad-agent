# Task069 — Model-directed scene exploration

## Scope / authorization
User authorizes revamping runtime tools and skills into scene interfaces rather than end-to-end decision algorithms, in a long-running implementation session. Model owns exploration, hypotheses, chosen locations, measurements, judgement and iteration. No paid inference authorized. Preserve unrelated dirty task067/068 work.

## Acceptance
- Model can inspect scene bounds/frame, choose its own cameras and arbitrary local-meter locations without an AOI, scan pool or equipment dimensions.
- Composable original-source nearest/radius/box and ground-elevation tools return factual evidence and explicit unavailable states, not recommendation scores.
- Lightweight hypotheses appear as C1–Cn; model can replace, reposition, remove and reorder with stable server-assigned IDs and revision recovery. They are not geometry, original points, verified recommendations or approval bypasses.
- Runtime skills explain interface semantics and evidence limits; no prescribed search→capture→finalize chain. Legacy deterministic scan/fit is optional and not the candidate universe.
- Sustained bounded loop, cancellation and explicit restart; current frame/artifact/edit binding remains checked. Geometry still individually human approved.
- Mock-provider tests demonstrate view/own-coordinate marking/measurement/revision/order rather than selecting numeric scan output; desktop/mobile browser evidence, checks and limitations recorded below.

## Delegation
Independent bounded children: factual perception binding/tests; annotation contracts/rendering/UI/tests; runtime skills/docs/tests; lifecycle audit/tests. Parent owns provider registration, dispatch, annotation lifecycle and shared transport budgets; then independent scoped review and browser verification. Whole-checkout fresh review remains separate.

## Safety / impact
Pre-edit graph: ProviderModel MEDIUM (runtime/broker/routes/binding consumers); turn LOW lower-bound (15 unresolved receiver calls); bindModelScene LOW (runtime rebind and routes); canonicalModelChatEvent LOW (client validator). Client send UNKNOWN (68 unresolved receivers): source confirms ModelChat and tests consume it, not an unused symbol. Children record their own pre-edit analyses. These are not clean whole-checkout graph certification.

## Completed implementation
- `query_points` exposes bounded original-source nearest/radius/inclusive-box queries at model-chosen coordinates; `ground_elevation` supplies supported observed elevation or unavailable. Scene bounds/frame are available without AOI or attached references. No ranking, snapping or fit solver is required.
- `get_scene_marks` / `set_scene_marks` retain up to20 arbitrary hypotheses with server IDs, order-derived C1–Cn labels, explicit rationale/unknowns and optimistic revision recovery. Marks survive successful followups; stale artifact/point/CAD/object bindings reset them. Image IDs are observation receipts only, never proof of inspected coverage or assessment.
- Lightweight contextual list/rendered labels reuse the scene marker renderer without fabricated scan metrics. New chat/cancel/failure clears streamed annotations; no geometry authority changes. Current viewport is preserved during custom captures.
- Interface skills give the model ownership of exploration and next actions. Legacy scan and exact-fit remain compatible optional analyses, not mandatory decision surfaces. Exact named utility-box assessment/individual human approval guards remain.
- Shared bounds:64 scene actions +16 skill calls /81 provider rounds, 15-minute absolute turn deadline, 90-second provider-round timeout; 512KiB text/tool replay,4MiB provider bytes, separate16MiB downstream stream. Existing image/output caps remain. No unbounded background agent or automatic replay of failed work was introduced.

## Verification / status
- `pnpm typecheck` and `pnpm build` **passed** in parent final run; Svelte zero errors/warnings, build chunk-size warning only. Logs `/tmp/task069-final-typecheck.log`, `/tmp/task069-final-build.log`.
- Parent `pnpm test` launcher **blocked** by tsx IPC `listen EPERM` (`/tmp/task069-final-test.log`). Independent child final `pnpm test` ran normally: **1221/1223 passed**,2 previously documented UI source assertions failed (`model-request-inspection-client.test.ts:231`, `safe-markdown.test.ts:54`). Log `/tmp/task069-final-child-test.log`. Do not call the full suite green.
- Focused independent follow-up:39/39 exploration/lifecycle/perception/marks +96/96 runtime/client/object checks passed (`/tmp/task069-followup-review-tests.log`). Final focused provider integration/prompt budget fixtures passed except the documented inspector UI assertion. Fixture sizes were scaled to new bounds; overflow, authority and evidence checks were not weakened.
- Edited source LSP checks clean except pre-existing unused-import hint in provider; full cached workspace still contains stale area-candidate diagnostics despite passing CLI typecheck. Diff whitespace check passed.
- Real headless Chrome mock-provider desktop/mobile checks **passed**: actual custom image bytes, own-coordinate markers/query/revision/order, label pixels/nonoverlap, selection, stale-revision recovery, ordinary followup, New chat reset, unchanged point/CAD/object authority snapshots, zero browser errors. See [browser evidence](../task069-browser-evidence.md) and `/tmp/task069-browser-child-final/report.json`. Parent launch was separately permission-blocked; child-owned run succeeded. Source/Vite integration, not built-bundle execution.
- Independent focused review found failed-turn annotation rollback and missing object-authority binding; both corrected with regressions, follow-up no remaining material focused findings. **Whole-checkout fresh-session review remains pending.**
- Complete raw whole-checkout change analysis `/tmp/task069-full-graph-raw.json` reports171 changed symbols/133 affected processes/32 files and **CRITICAL** risk; raw output has no partial/truncated flags, but index freshness/new-symbol coverage remains unresolved. Display summaries are abbreviated. Not a clean graph/merge certification. No commit.

## Limits / next action
No paid/live inference, actual-model judgement/adherence certification or production78M-scale performance run. Missing visual/ground support remains provisional/unavailable; measurements exclude accepted edits and ghosts even when visible. No general empty-space pixel backprojection, continuous background execution or durable annotation document was added. Installed spatial-rendering/pi-browser-harness skills were absent; browser-policy/visual-QA guidance used. Preserve unrelated dirty tasks067/068. Next: fresh-session review against this task and actual diff, then separately authorized live-model evaluation.
