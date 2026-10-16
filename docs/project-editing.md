# Local project sessions and approved box edits

[Task014](tasks/014-project-sessions.md) and [task015](tasks/015-approved-box-edits.md) add one local project authority, explicit persistence, scene context and human-approved box **parameter** edits. They do not implement a model, a channel operation or project-integrated CAD solids. Pi is development tooling, not the product agent.

## Use the workspace

Run Node22 and pinned pnpm10.34.6:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. The server listens on loopback3001. Viewer and chat load the same server snapshot; unavailable/invalid authority has no browser seed fallback.

1. In **Synthetic demo**, click an entity (or its list entry). Choose pin name A or B, then Cmd/Ctrl-click a cloud point. Pins retain the original point index and binary64 coordinates, not rounded/GPU positions. Orbit, selection and pins do not edit geometry.
2. Send exact command `context` in chat. It calls `/project/context` and displays validated selections with session, geometry revision, meter frame/origin and stable entity references. This is a deterministic input seam, not a model answer. `metadata` and `observe B D` remain the separate [Toronto inspection commands](shared-project-chat.md).
3. In chat-side **Box parameter proposal**, select update/create, enter the exact entity ID and three comma-separated local-meter numbers for center/dimensions. Existing demo ID is `proposal-box`; create requires an unused ID. Dimensions must be positive.
4. **Preview exact proposal** displays the server-issued ID/digest, binding, exact before/after and a disposable wireframe. It changes no geometry. Changing any input clears the preview.
5. Deliberately click **Approve exact proposal**. The server verifies the stored exact proposal and unrelated entities, publishes atomically and advances revision once. Scene/chat consume the returned authority. This is `parameter-postconditions-not-cad`, not a kernel-valid solid.
6. **Undo latest edit** requires confirmation and the latest retained transaction. Undo applies a checked inverse as a new revision, never rolls revision back; no redo. This page must hold the exact inverse receipt. In-page same-session Refresh retains receipts, including overlapping/failed reads; a full page reload, unreceived commit or external edit can leave a server undo ID without a verifiable local inverse. Undo is then explicitly disabled, not guessed.
7. **Save project** explicitly saves current geometry. Commits are initially unsaved; no autosave. **Load saved project** confirms discarding unsaved geometry, restores saved IDs/coordinates/revision, rotates session and clears history/pins/proposals. **Reload shared project** only reads current authority; it is not Load from disk.

Snapshot replacement remounts the demo camera. Edit/load/undo invalidate old selections/context/previews. Cancelled or failed mutation replies can be ambiguous: editing blocks until explicit Reload, with no automatic mutation retry. Rendering failure/context loss is reported separately from commit truth; WebGL restoration resumes rendering without changing authority.

Toronto selections are excluded: its origin/frame/artifact revision are not mapped to the demo. Retained synthetic selections remain visibly identified. Building a channel from A to B and provider/auth/model orchestration remain future work.

## Persistence and operator safety

Default trusted path: `~/.spatial-cad-harness/project.json`. Set `SPATIAL_PROJECT_PATH` **before server startup** to a different operator-controlled path, e.g.:

```sh
SPATIAL_PROJECT_PATH=/absolute/trusted/project.json pnpm dev
```

No HTTP request accepts a path. Snapshot envelopes are versioned/checksummed, strictly validated and bounded to2MiB,256 entities and10,000 cloud points. Save uses an exclusive writer lock, a remembered stored digest and atomic rename; another writer's changed snapshot requires Load before Save. This is not multiuser synchronization or a power-loss durability guarantee. A crashed writer may leave a lock requiring operator inspection/removal only after confirming no writer is live.

Startup loads existing valid saved geometry with a fresh session and no undo history. Corrupt existing persistence **fails startup explicitly**, never silently falls back to demo. Missing saved state at startup starts the demo; explicit Load of a missing/corrupt snapshot fails without mutation. Unsaved changes are intentionally lost on restart.

Acceptance-owned servers use unique OS-temp project paths (`scripts/isolated-demo-server.ts` or explicit browser fixture paths), not the operator default. Production corruption checks remain fail-closed.

Local Host/Origin checks are not public-hosting authentication. Do not expose this unauthenticated service publicly. Existing `/cad/*` remains a separate startup-bound sandbox: edit or Load makes its source stale, returning409 until server restart. Sandbox bodies are never published into the project or persisted by Save.

## HTTP contract

Source of truth: `packages/contracts/src/project-edit.ts`. All POST bodies are exact schemas; extra fields, query strings, compressed requests and unsupported media types are rejected. Use `Content-Type: application/json` (UTF-8 charset allowed). POST admission includes body reading; one POST at a time,16KiB body budget,5s body timeout,120 POST/minute. Local Host (`localhost`/`127.0.0.1`) and absent or local HTTP Origin required, including raw GET `/project`.

Common binding **B**:

```json
{"sessionId":"<current session>","projectRevision":0,"frameId":"demo-local-v1","units":"m"}
```

Obtain actual binding from `/project/session`; never hardcode revision/session. Browser generation/request cancellation is client-owned, not an extra project API field.

| Route | Exact request additions to B | Success result |
| --- | --- | --- |
| GET `/project/session` | No body | `{snapshot,nextUndoTransactionId,persistence:'explicit-save',savedRevision,dirty,limits}` |
| POST `/project/context` | `entityIds: string[]`, `points: [{name:'A'|'B',entityId,pointIndex,position:[x,y,z]}]` | Canonical context plus `coordinates`, entity IDs/kinds, `coverage:'explicit-project-selections'`, `source:'synthetic-project'` |
| POST `/project/proposals` | `edit:{kind:'update-box'|'create-box',entityId,center:[x,y,z],dimensions:[x,y,z]}` | Exact bound proposal, `proposalId,digest,expiresAt,coordinates,before,after,verification` |
| POST `/project/approve` | `proposalId,digest,humanApproved:true` | Commit result below; no edited parameters in approval |
| POST `/project/undo` | `transactionId,humanApproved:true` | Commit result, operation `undo` |
| POST `/project/save` | None | `{snapshot,savedRevision,persisted:true}` |
| POST `/project/load` | None | `{snapshot,nextUndoTransactionId:null,persisted:true}`; new session |

`ProjectSnapshot` is `{sessionId,frameId,project}`. Raw GET `/project` remains compatible: raw `ProjectState` plus `X-Spatial-Session`/`X-Spatial-Frame` headers, not the result envelope.

Other successes use `{ok:true,result:T}`; ordinary project-route failures use `{ok:false,error:{code,message}}` with bounded messages, no filesystem paths. Top-level malformed targets instead return400 `{error:'Invalid request target'}`; unexpected dispatch failures return500 `{error:'Internal server error'}` before streaming, or abort an already-started stream. Treat these as transport failures, never commit evidence. Commit result is `{snapshot,transactionId,nextUndoTransactionId,operation,verification:'parameter-postconditions-not-cad',persisted:false}`. Clients must check expected exact changed entity and preserved unrelated state, not trust rendering as verification. Browser independently verifies canonical proposal SHA256 and exact commit/inverse snapshots.

Context accepts at most32 unique entity IDs and two uniquely named points; original authoritative point index/coordinates must match exactly. Proposals/history retain at most32 entries; proposals expire after5min. Box center/dimension magnitudes are at most1,000,000m; dimensions are strictly positive. Session/revision mismatches, invalid points, unknown entity/proposal, altered approval digest, expired proposal and stale undo fail without publication.

Typical HTTP failures:400 invalid,403 local-only,404 unknown/missing,409 stale/approval mismatch/expired proposal/unavailable undo,413 resource limit (including size/time/history budgets),422 corrupt/invalid point/postconditions,429 busy/admission/rate limit,503 storage. Consult runtime error code rather than interpreting every failure as permission to retry a mutation.

## Verification and remaining limits

Final baseline: `pnpm verify`163/163 tests, typecheck and build pass. Existing Chrome CDP9222:15 interactive checks (including real context loss/restoration),10 shared-chat,10 all-label/window and8 demo checks pass. Exact commands/artifacts and independent review verdicts: [task014](tasks/014-project-sessions.md#verification-and-review) and [task015](tasks/015-approved-box-edits.md#verification-and-review).

Forced WebGL restoration followed by disposal produces retained Chrome/Three stale-object deletion warnings; restored drawing, listener disposal and authority preservation pass. Build retains the >500KB bundle warning. Parent cached LSP reports obsolete missing exports while workspace CLI checks pass; graph coverage remains incomplete for Svelte/dynamic/untracked change mapping. These are not clean tooling certification. No public hosting, model/provider, channel, real CAD edit, multiuser, redo or full-reload inverse recovery claim.
