# Task019 — Provider-backed scene chat

Status: implemented; independent bounded source/corrective reviews complete with no remaining actionable finding. Live inference, whole-checkout fresh review and complete graph certification remain pending.

## Authorization and scope

User authorized “implement the chat loop” after task018 authentication. Deliver real natural-language chat in the existing scene workspace, not an authentication-only placeholder. Pi remains development tooling. No live model budget, operator credential access, operator-service restart or commit is authorized. Preserve unrelated dirty tasks014–018.

## Acceptance criteria

- Backend-only configured ChatGPT-plan or OpenAI API-key credentials; no silent fallback. Official public `/v1/models` discovery and `/v1/responses` inference. Explicit model choice; distinguish authentication, permission, catalog availability and successful inference.
- Incremental Responses SSE parsing and bounded downstream streaming, visible conversation history, cancellation, honest partial/error states. Successful completion requires provider completion and valid downstream terminal framing, not HTTP200 or EOF alone.
- Replay complete required Responses output/history server-side, including opaque reasoning/tool items; bounded volatile sessions, no browser credential or history persistence. Interrupted turns do not become completed history.
- Every turn carries explicit active-scene A/B point provenance, units, frame and revisions plus authoritative selected project entity references where applicable. Reject stale project context; Toronto remains unmapped and distinct from project geometry. No implicit coordinate conversion or synthetic fallback.
- At most bounded allowlisted read-only `inspect_scene` model calls returning actual bound context. No model CAD, approval, Save/Load or mutation dispatch. Keep deterministic tools and exact human approval controls unchanged; model assertions are not verification. Model-driven channel creation is not implemented in this slice.
- Loopback Host/Origin protections, request/schema/body bounds, fixed provider destinations, redirect rejection, deadlines, stream/output/history/tool/concurrency limits, account/model/context binding, shutdown abort and stale-result suppression. Errors expose no provider secrets/bodies. No automatic generation retries.
- Fake-provider contract/HTTP/client tests cover both billing modes and request restrictions; scene context and tool result replay, failure/cancel/limits/stale/logout/model changes. Verify rendered UI in guarded, owned existing-Chrome fixtures, without operator account or paid calls.
- Run appropriate CLI checks, record exact results/artifacts, inspect actual incremental diff, and obtain independent review. Never label unrun live compatibility or incomplete graph coverage as passing.

## Protocol/design

`packages/contracts/src/model-chat.ts` defines catalog, bounded scene attachments, turn request and downstream NDJSON events. Routes are `GET /chat/models` and `POST /chat/turn`; history is server-owned and conversation IDs opaque. Model functions cannot invoke arbitrary HTTP/filesystem/CAD tools. API-key and ChatGPT catalog shapes differ; catalog choices come from the configured credential, not a hardcoded model list. ChatGPT HTTP requests use `stream:true`, `store:false`, full input arrays and no `previous_response_id`, unsupported sampling/output-budget fields or system-role items. Local output/deadline abort is not a guaranteed provider token-spend ceiling.

Public references: [SIWC models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [errors](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [conversation state](https://developers.openai.com/api/docs/guides/conversation-state), [function namespaces](https://developers.openai.com/api/docs/guides/function-calling#defining-namespaces). Revalidated during implementation; live compatibility remains unrun.

## Delegation

Backend/contracts/provider transport/tests and browser client/chat UI/tests are separate implementation assignments under the shared protocol. Parent integrates documentation and runs verification. Separate guarded fake-provider browser verification and independent fresh-context source review follow integration. No task014–018 broad refactor or retrospective review is implied.

## Evidence and limitations

Initial preservation artifacts: `/tmp/spatial-task019/initial-sha256.json`, `initial.diff`, `initial-status.txt`. GitNexus binds `cad-agent` at this checkout, index commit `4dc9c760`; impact MCP/CLI currently fail because LadybugDB requires shadow-page replay under read-write mode. Risk is UNKNOWN, not safe; actual production/test callers are source-checked. Prior aggregate CRITICAL/capped/unindexed/Svelte/PDG limitations persist; no index repair or clean graph certification claimed. Parent LSP caches previously disagreed with passing CLI checks; do not alter unrelated source to quiet stale diagnostics.

## Completed criteria

All bounded implementation criteria above are delivered: actual backend Responses streaming and complete replayable history, explicit configured-provider model discovery/selection, provenance-bearing scene input and allowlisted read-only scene tool, server-only credentials, no paid fallback, lifecycle/revision/cancellation safety and preserved exact-approval tools. [User guide/protocol/limits](../model-chat.md).

Integration corrected a non-demo scene-binding mismatch: Toronto/pole accept an empty authoritative project revision binding, never retained hidden synthetic selections. The Account panel now invalidates model state immediately at logout and on changed settled status, without discarding history for unchanged status refreshes. Historical task017 local-Send/no-network copy/tests are superseded by explicit model discovery/selection/Send; its prior browser evidence is historical, not rerun acceptance for task019.

Independent review initially found dropped `response.output_item.done` opaque reasoning and coercible mode discriminants. Both were fixed with explicit adversarial regression tests and independent corrective rereview. Completed output items reconcile by index/identity/type with terminal output, preserving nonconflicting complete raw fields/phase and rejecting conflicts; incomplete added-item content is never replayed. See `/tmp/spatial-task019/review.md`, `correction-result.md`, `corrective-review.md` and their referenced before/diff/probe artifacts. The bounded corrective verdict is READY, not whole-tree certification.

## Exact verification and artifacts

Commands ran at repository root with Node v22.23.3 and pnpm10.34.6. No operator provider/account/live inference budget was used.

- `pnpm verify` → exit0; package/test typechecks, Svelte **0 errors/0 warnings**, **391 tests passed,0 failed**, production web build/server typecheck. Final parent log `/tmp/spatial-task019/final-verify.log`. Existing Vite >500KiB chunk warning retained. Earlier integration345-pass log predates corrective regressions; final391 is authoritative.
- `pnpm exec tsx --test tests/model-chat.test.ts tests/provider-model.test.ts tests/provider-model-auth.test.ts tests/model-chat-client.test.ts tests/model-chat-ui-context.test.ts tests/provider-account.test.ts` → **161 passed,0 failed**, independently rerun; `/tmp/spatial-task019/corrective-review-focused.log`.
- `pnpm exec tsx --test tests/model-chat.test.ts tests/provider-model.test.ts tests/provider-model-auth.test.ts tests/provider-auth.test.ts tests/auth-http.test.ts` → **147 passed,0 failed**, `/tmp/spatial-task019/correction-backend-tests.log`. UI-specific pair → **47 passed,0 failed**, `correction-ui-tests.log`.
- Independent adversarial two-billing-mode replay probes → **2 passed**, `corrective-review-probe-command.sh` / `corrective-review-probe.log`; server/test direct typechecks pass in `corrective-review-*-typecheck.log`.
- `pnpm exec tsx /tmp/spatial-task019/browser-final/verify.mjs > /tmp/spatial-task019/browser-final/run.log 2>&1` → exit0, **16 guarded fake-provider existing-Chrome checks passed** against final corrected build. `/tmp/spatial-task019/browser-final/REPORT.md`, `report.json`, `guard-proof.json`, `requests.json`, ARIA snapshots, desktop/mobile screenshots and `verified-sha256-{before,after}.txt` record exact evidence. Existing Chrome9222, fresh owned incognito context, fail-closed CDP Fetch each-hop guard proved303→302→synthetic fulfilment plus denial before application navigation. Owned fixtures cleaned; no operator3001/5173 or provider transport used. Main UI used same-origin native owned-backend streaming with preview assets fulfilled locally; actual Vite proxy tested separately through Node, **not browser end-to-end proxy coverage**.
- Browser cases cover explicit catalog/selection, actual synthetic and Toronto A/B picks, authoritative scene tool, visible streaming before completion, tool/full history replay, partial/cancel/EOF/usage errors, model/scene/account invalidation, logout, both provider modes, stale admission, inert text/no storage, no CAD/mutations and desktop/mobile legibility. Earlier fixture-only failed attempts remain transparently documented in `/tmp/spatial-task019/browser/REPORT.md`; final corrected-build16-pass evidence supersedes them.
- `git diff --check` → exit0, `/tmp/spatial-task019/final-diff-check.log`. Actual task-local source/corrective diffs independently reviewed; unrelated dirty tasks014–018 not certified. `/tmp/spatial-task019/final-preservation.json` shows **169 of183 initial files byte-identical**,14 intentionally changed integration/docs/test files, no missing initial files and13 new task files. Final source/build fingerprints are retained separately.
- Individual child LSP checks and fresh child caches were clean, but parent's final `lsp_diagnostics("*")` still reports **280 cached diagnostics (274 errors,6 hints)** including obsolete missing exports/signatures, discordant with repeated passing direct typechecks/build. This is unresolved tooling discrepancy, not a clean parent-LSP claim; no source workaround was introduced.
- Final MCP and `node .gitnexus/run.cjs detect-changes --scope all --repo .` remain unavailable/UNKNOWN because of LadybugDB shadow replay (`final-graph-cli.log`, exit1), not a clean zero-impact result. Prior aggregate CRITICAL/capped/unindexed/Svelte/PDG risks remain unresolved. No graph repair, index regeneration or commit performed.

## Remaining limits and next action

No live ChatGPT/API-key inference, account eligibility/compatibility, operator service restart, production Toronto exact-record chat verification, image observations, general verified dataset model tools, model CAD/channel creation or whole-checkout fresh review is certified. Model input explicitly marks Toronto exact records unverified and unmapped. Local ChatGPT cancellation cannot guarantee a provider token-spend ceiling. Eight retained conversations expire after30 idle minutes; New chat alone does not free server slots. Earlier regression suites were not all browser-rerun; historical Toronto exact-camera binary64 failure remains unchanged, not relabeled passing.

Next action: user restarts the local backend/reloads the workspace, explicitly Refresh models → choose model → Send if willing to consume their configured usage. Any agent-operated live smoke still requires separate budget/usage approval. Broader VLM/CAD work needs its own bounded task. Final redacted handoff: `/tmp/spatial-task019/completion-handoff.md`; suggested skills there. No commit requested or made.
