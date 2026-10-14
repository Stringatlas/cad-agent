# Read-only shared-project inspection chat

Task012 integrates a left scene/right chat workspace with a **deterministic caller**, not a model. There are no provider/auth calls, CAD operations, mutations, approval, undo, save/load or persistence. The rendered box remains a mesh proposal, not an OpenCascade body. See [task012](tasks/012-shared-project-chat.md) and [task011 protocol](tool-protocol.md).

## Run

Use Node22 (`>=22.12 <23`) and pnpm10.34.6:

```sh
pnpm install --frozen-lockfile
pnpm dev
# Open http://127.0.0.1:5173 (server :3001)
```

The browser **must** fetch `/project`; it has no independently seeded demo fallback. `Reload shared project` disposes the old viewer/chat, cancels requests and fetches a fresh server snapshot. An unavailable server is an explicit error. The server owns one read-only in-memory snapshot and session per instance; restarting resets the session. Selection, orbit, LOD and crops remain disposable browser view state, never geometry edits.

Toronto inspection requires the fixed prepared dataset described in [preview setup](web-preview-lod.md). First use hashes the prepared manifest, metadata, hierarchy and payload for task011 artifact evidence; this can be slow and cancellable. A missing dataset does not prevent rendering the demo, but inspection reports `dataset-unavailable`. HTTP cannot supply a dataset path, tool name, adapter or configuration. A trusted operator/test may pass `createDemoServer({ datasetRoot })`; normal startup uses `DEFAULT_DATASET_ROOT`.

## Exact command grammar

| Input | Dispatcher call | Meaning |
| --- | --- | --- |
| `metadata` | `dataset.metadata`, `{}` | Toronto dataset information; **metadata-only**, not a point inspection. |
| `observe B D` | `dataset.observe`, `{ lod: { budget: B, depth: D } }` | Bounded first-chunk BFS/even sample; `B=1..4096`, `D=0..3`. |

Case and spacing are exact. Integers have no leading zeros. For example `observe 32 0` works; `observe 01 0`, `metadata `, arbitrary prose, `move box` and tool names are rejected as `unsupported-command`. Nothing generates a fake conversational/model answer. Chat exposes no nearest-label command; the existing **Closest: label** scene tab retains its independent exact all-nine-label query UI and uncapped progressive detail path.

Observation coverage is **bounded-first-chunk-sample**, not exhaustive, nearest-point evidence or CAD verification. Increasing depth cannot traverse hierarchy proxy chunks outside that first chunk. The returned point count may be below the requested budget. Existing observation resource ceilings remain in force; see [preview limits](web-preview-lod.md) and protocol validators.

## Explicit independent frames

- Shared demo: `demo-local-v1`, geometry revision from `/project`, meters, right-handed Z-up, world origin `[1000, 2000, 10]`; authoritative IDs `synthetic-cloud`, `proposal-box`. Viewer and chat receive the same fetched snapshot.
- Inspection artifact: dataset `toronto3d`, `toronto3d-local-v1`, meters, right-handed Z-up, world origin `[627285, 4841948, 0]`. The canonical tool request carries the artifact revision **and content digest**. Neither is the demo geometry revision.

There is **no mapping** of Toronto observations into demo geometry. Chat displays both bindings explicitly; no inspection response changes scene entities or geometry revision.

## HTTP API

Same-origin dev/preview proxies `/project`, `/chat/` and `/datasets/` to the local server. The server uses no-store responses.

### `GET /project`

Returns raw `ProjectState` JSON (not a wrapper), with:

```text
X-Spatial-Session: <server instance identifier>
X-Spatial-Frame: demo-local-v1
Cache-Control: no-store
```

The client validates the project plus session/frame headers before mounting the workspace. Project units, local origin, IDs and revision are shown in both scene and chat.

### `POST /chat/inspect`

Only `Content-Type: application/json`, no query parameters or content encoding. Exactly these fields:

```json
{
  "sessionId": "<X-Spatial-Session from GET /project>",
  "projectRevision": 0,
  "generation": 1,
  "requestId": "request-1",
  "command": "metadata"
}
```

Use the actual fetched revision, not an assumed zero. `sessionId`/`requestId` are 1..64-character protocol tokens (first character alphanumeric; remaining alphanumeric, `.`, `_`, `-`). Revision and generation are nonnegative safe integers. Command length is at most80 characters. Unknown fields fail closed. Only localhost/127.0.0.1 Host and, if supplied, HTTP loopback Origin are accepted; this is a **trusted-local development seam**, not a public service or authenticated multi-user API.

A valid envelope receives HTTP200 with echoed session/revision/generation/request ID, a terminal `state` and `code`. Actual dispatcher calls also include:

- `reply`: task011 schema/tool versions, **canonical tool request** and validated outcome;
- `evidence`: runtime `runId`, dispatcher `requestId`, semantic outcome SHA-256 and configuration SHA-256.

The UI expands canonical request/result JSON and shows evidence references. The client checks envelope identity, tool/args, artifact/frame binding and outcome-state agreement. Hashes are evidence references from the trusted server, not signatures or proof of CAD verification; chat does not export a full replay bundle. Outer browser request IDs are distinct from server-generated dispatcher call IDs.

Malformed requests return HTTP400, forbidden origin/host403, oversized declared body/encoding413 and full admission429. An oversized streamed/invalid JSON body is bounded and rejected400. HTTP/non-JSON/invalid/oversized responses become client `server-unavailable-or-invalid-response`; no server filesystem exception text is published.

## States and limits

| State | Examples / semantics |
| --- | --- |
| `pending` | Client-only; preparation or dispatcher work is outstanding. Send disabled; Cancel enabled. |
| `completed` | Actual metadata/observation outcome `observed`, with canonical request and evidence. **Not CAD verification.** |
| `rejected` | `unsupported-command`, `stale-project` (server session or geometry revision), or dispatcher `verification-rejected`. |
| `incomplete` | `preparing-busy`, transport `deadline`, or dispatcher `incomplete` for deadline/resource/transport. No complete result claimed. |
| `error` | `dataset-unavailable`, client server/response failure, or dispatcher `error` (including budget, busy, unavailable, corrupt-data). |
| `cancelled` | Client Cancel, transport cancellation, or dispatcher incomplete reason `cancelled`; late results cannot overwrite it. |

Transport limits: **1024-byte request**, **1MiB response**, **2 active requests**, **20s end-to-end deadline**. Only one preparation runs at once; a concurrent call during first-use preparation gets `incomplete/preparing-busy`. The fixed runtime configuration uses **1000 calls per cached server run**, **2 concurrent adapter calls**, **15s per dispatcher call** and **256KiB evidence-export budget**. The evidence-export budget is not an extra HTTP reply limit. After1000 admitted calls the runtime returns an explicit budget error; restart the local server to create a new run/session. No unbounded chat transcript is retained in the UI; the latest entry is displayed.

Cancellation aborts client fetch and propagates disconnect into server preparation/execution. Generation changes, binding changes, reload and disposal invalidate publication even when a loader ignores abort. A stale/malformed reply can produce a client error but cannot publish its result/evidence. Geometry remains unchanged.

## Repeatable acceptance

```sh
pnpm verify
pnpm build
node scripts/browser-shared-chat-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-browser
# Existing demo regression script now owns its required bootstrap backend:
pnpm verify:browser http://127.0.0.1:9222
# Actual nine-label/window regressions, separately:
node scripts/browser-closest-label-window-smoke.mjs http://127.0.0.1:9222 /tmp/spatial-task012-label-regression
```

Chrome must already expose the specified CDP endpoint; scripts **never launch/download Chrome**. The shared-chat script owns only a new tab and server/preview process groups on3013/4176. It checks desktop/narrow layout, shared binding, demo picking/orbit, native prepared metadata/observe dispatcher evidence, unsupported input, real stale-session/revision rejection, cancelled/reloaded late-publication suppression, actual owned-server shutdown/no-fallback, and actual dataset-unavailable after restarting with a nonexistent fixed root. Cancellation/reload timing gates hold a **real response** using an intentionally noncooperative fetch wrapper; they are not latency measurements or synthetic successful tool results.

Its OS-temp directory contains `report.json`, `metadata.json`, `observe.json`, screenshots and owned-process logs. Any blocked/failed browser connection is reported as failed/unavailable, never passing. Baseline tests cover the additional rejection/incomplete/error distinctions and deterministic transport/client lifecycle. Browser evidence and fresh-context review status belong in task012, not this guide.
