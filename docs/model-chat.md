# Provider-backed scene chat

[Task019](tasks/019-model-chat-loop.md) connects Scene chat to the server's explicitly configured OpenAI API-key or ChatGPT-plan provider. Credentials remain server-side; there is no paid-key fallback. This is a read-only, structured-scene chat loop—not autonomous CAD or the complete VLM harness.

## Use it

1. Configure **`apps/server/.env`** as described in [provider authentication](provider-auth.md), then restart your local backend after configuration/source changes. Imported test factories still default to disabled authentication. No keys belong in the web environment or browser.
2. Open **http://127.0.0.1:5173**. For ChatGPT, use **Account → Sign in with ChatGPT**, complete **Continue with ChatGPT** in the backend tab, return and refresh account status. Identity-only sign-in is insufficient; plan-usage permission is required.
3. In Scene chat, click **Refresh models**, then choose a model. Catalog discovery contacts the configured provider, but does not generate an answer. Authentication readiness or a listed model does not prove successful inference or model compatibility. The API-key catalog can include models unsuitable for Responses/function calling; select a compatible model. ChatGPT choices come from the selected account's visible catalog.
4. Pin A/B and/or select a synthetic entity, inspect **Current model context**, type your request, and **Send**. Sending makes a real provider request and may consume plan usage or incur API charges. No request is sent automatically, and failures are never automatically retried.
5. Text streams incrementally. Only a complete provider response and validated stream ending mark the answer complete. **Cancel** preserves an explicitly incomplete partial; the next Send starts a fresh server conversation. **New chat** clears local history while preserving your draft.

Changes to scene selections/source, project binding, model or account invalidate the conversation and suppress stale responses. Returning focus from another window/tab or hiding/leaving the page also invalidates model readiness/history conservatively; refresh models and choose again. Draft text stays in the mounted workspace, not browser storage. Reloading the page loses it.

## Scene context and authority

- Synthetic selections pass through the authoritative project's exact entity/point, session, geometry revision, meter and frame checks. Selected box parameters and exact original A/B point references reach the model.
- Toronto attachments retain names, original binary64 coordinates, dataset artifact revision, source file/row, meter units, right-handed Z-up frame and translation-only origin. The server checks artifact revision, source-row admission and metadata bounds. It **does not independently reread/verify the exact original point record** at this chat boundary; the model receives `recordValidation: unverified`, not fabricated geometric evidence.
- Toronto is **unmapped to the synthetic project**. Non-demo modes may carry an empty project revision binding but never hidden synthetic selections. A missing project authority does not silently seed substitute geometry.
- No screenshot/image, point-cloud observation download, nearest-label query or CAD body is automatically supplied to this model loop. Existing deterministic inspection remains under Technical tools.

The only model-callable tool is the namespaced read-only **`scene.inspect_scene`**, returning the actual bound context. Model tools cannot approve/propose edits, create channels/CAD, Save, Load, Undo or publish geometry. Existing box parameter preview and deliberate exact approval remain separate. Model text, stream completion and rendered meshes are **not CAD verification**.

## Protocol and privacy

- `GET /chat/models` returns only mode/readiness/fixed code, opaque lifecycle generation and bounded model IDs/labels.
- `POST /chat/turn` accepts a bounded request identity, opaque conversation handle or null, generation, selected model, user text and explicit scene context. Clients cannot supply assistant history, credentials, provider endpoints or executable tools.
- Responses are bounded NDJSON `start`, `delta`, `tool` and exactly one `done`/`error` event. The client validates identity, terminal framing and EOF; a transport failure never becomes a completed answer.
- The server uses only public `https://api.openai.com/v1/models` and `/responses`, rejecting redirects. Provider SSE parsing preserves complete output items, including completed-item encrypted reasoning and assistant phase, for stateless replay. Opaque reasoning stays server-side, not in visible chat/tool context.
- ChatGPT requests use `stream:true`, `store:false`, full input arrays, instructions/developer context and namespaced function tools. They omit HTTP `previous_response_id`, system-role input and unsupported sampling/output-cap fields. API-key requests also use stateless streaming and add `max_output_tokens:4096`.
- Full replay history is volatile server memory; only successful turns enter it. No browser credential/history storage, project persistence or logging of provider bodies is added. Provider data handling is still subject to the configured provider's policies; `store:false` is not a claim of zero provider retention.

## Bounds and recovery

| Resource | Limit |
| --- | --- |
| User text / request | 12,000 characters / 64 KiB |
| Admission | One active catalog/turn request; 30 requests/minute |
| Provider operation | 90 seconds; 1 MiB total provider body; 128 KiB frame |
| Answer / tool calls | 32,000 characters / two inspect_scene calls per turn |
| Conversations | Eight retained completed conversations, 30-minute idle TTL |
| Conversation | 16 completed turns; 256 KiB replay history |
| Catalog | Up to 128 models |

ChatGPT rejects provider-side `max_output_tokens`; local output/deadline cancellation is **not a guaranteed provider token-spend ceiling**. A disconnected request may already have consumed usage.

Each failed assistant message now shows its own specific failure and recovery panel, retained even after a later explicit send succeeds. Empty or partial text still remains incomplete, not committed server history.

For a parser failure, the backend terminal prints a single `[model-provider]` JSON diagnostic with a fixed parser `check` tag and HTTP status, for example `{"operation":"responses","check":"snapshot-conflict","httpStatus":200}`. A rejected non-SSE response additionally includes a closed `responseFormat` category: `json`, `html`, `text`, `missing` or `other`, with the corresponding UI code `provider-format-*`. Example: `{"operation":"responses","check":"content-type","httpStatus":200,"responseFormat":"json"}`. This classifies only the declared header. Task022 additionally inspects at most1KiB/16reads/250ms of a wrong-MIME HTTP200 body internally, then cancels it. Closed appearance tags (`empty`, `sse-like`, `json-like`, `html-like`, `other`, `timeout`, `read-error`, `cancelled`) are not protocol validation or inference success; wrong-MIME content remains rejected unconditionally. Unknown/vendor media types fall into `other`.

For the authorized local investigation, wrong-MIME rejections also write content-redacted records under Node's OS temp directory: `spatial-model-diagnostics-*/diagnostic-<pid>-<sequence>.json`. Randomized directories are0700, exclusively created files0600, and each writer retains its latest8 records (older process directories remain until OS/operator cleanup). Schema1 records PID/local timestamp/sequence, status, closed format/body-appearance, exact-expected/absent/other URL category, allowlisted response type, redirected and body-presence flags. No raw URL, header, prefix or error text is stored; artifact failure cannot replace rejection. These backend-only records are not exposed via HTTP or chat events. Test records must not be confused with an actual listening backend PID.

Diagnostics do not log prompts, response text, opaque reasoning, raw exceptions, raw headers/IDs or credentials. Share only that diagnostic line and the UI error code—not `.env`, authentication files, request bodies or headers. They identify a rejected check, not proof of the provider's root cause. Development watchers may reload on source changes; otherwise deliberately restart/refresh to load them. No model request or retry is automatic. A missing diagnostic can mean failure outside the instrumented parser checks (for example transport/UTF-8 decoding or admission). [Task021](tasks/021-model-failure-observability.md) records the bounded fake-provider/browser verification; live compatibility remains unverified.

Fixed codes distinguish unavailable credentials/permission, unsupported capability/model, plan eligibility/usage, stale scene/account/conversation, resource limits and interrupted streams. Check Account, explicitly refresh models or start New chat as appropriate; do not repeatedly retry usage/policy failures. At 16 turns, start a new conversation. At eight retained conversations, New chat alone does not reclaim server history: wait for 30-minute idle expiry, or deliberately restart the local server (volatile chat history is lost). Authentication, provider availability and inference success remain distinct.

## Verification limits

Fake-provider CLI and safely guarded existing-Chrome evidence are recorded in task019. Live ChatGPT/API-key inference, actual account eligibility and production Toronto record verification were **not tested**. Earlier browser regressions and graph coverage limitations remain separately documented; this implementation does not certify them or authorize paid tests.
