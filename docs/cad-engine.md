# CAD sandbox API

[Task013](tasks/013-cad-engine.md) adds actual OpenCascade solids through pinned `replicad-opencascadejs@1.1.0` (direct kernel bindings, not the Replicad JS modeling wrapper). Run `pnpm install --frozen-lockfile` and `pnpm dev`, then access the API directly at **http://127.0.0.1:3001**. No credentials are needed. Keep the listener on loopback; Host/Origin checks are not authentication and do not make public rebinding/proxying safe. The web proxy/chat does not expose these operations yet.

## Authority and coordinates

Bodies live in an ephemeral server-instance sandbox, **not `ProjectState`**. These endpoints never edit `/project`, increment its revision, replace the viewer's proposal mesh, or bypass approval. A body is not an approved project edit. Source binding is provenance: demo session ID, source geometry revision and `demo-local-v1` frame (`PROJECT_FRAME_ID`). Toronto data has a separate frame/revision and is not mapped into this sandbox.

All input/output positions and lengths are **local meters, right-handed Z-up**; volume is **m³**, not millimeters. Primitive `center` is the midpoint. Cylinders point along local Z. World placement remains translation by the demo project's origin and is not baked into the output. STEP declares SI meters and uses local coordinates.

## Endpoints

`GET /cad/capabilities` returns `{ok:true,result:{source,units,handedness,upAxis,operations,limits,sandbox:'ephemeral',publishesProject:false,resetInvalidatesBodies:true}}`. It does not load the kernel. Read `source` from this response rather than inventing IDs/revisions.

`POST /cad/execute` accepts uncompressed `application/json` (optional UTF-8 charset):

```json
{
  "sessionId": "<capabilities.source.sessionId>",
  "projectRevision": 0,
  "frameId": "demo-local-v1",
  "operation": {"kind":"box","center":[0,0,0.75],"dimensions":[1.8,1.2,1.5]}
}
```

Copy the actual `projectRevision` from capabilities; the example is not a fixed revision guarantee. All top-level/operation/reference keys are strict. No endpoint accepts query parameters. Capabilities accepts no body.

| `operation.kind` | Additional keys | Result |
| --- | --- | --- |
| `box` | `center: [x,y,z]`, `dimensions: [dx,dy,dz]` | New validated body |
| `cylinder` | `center`, `radius`, `height` | New validated body, Z-axis |
| `boolean` | `operator: 'union' \| 'subtract' \| 'intersect'`, `left`, `right` | New validated body; inputs unchanged |
| `inspect` | `body` | Stored measured validation/result |
| `tessellate` | `body` | `{body,units:'m',vertices,normals,triangles}` |
| `export-step` | `body` | `{body,units:'m',step}` |
| `delete` | `body` | `{deleted:true}`; release sandbox handle |

Every `body`, `left`, `right` reference is exactly `{bodyId,bodyRevision:1}`. Bodies are immutable, so revision1 is the only current version; new operations issue new IDs. Unknown/deleted/cross-instance handles cannot resolve. Deleting a boolean input does not destroy its retained output.

Success is `{ok:true,result}`. Creation/boolean/inspection result:

```text
{
  body: {bodyId: 'cad-<uuid>', bodyRevision: 1},
  source: {sessionId, projectRevision, frameId}, units: 'm', complexity,
  valid: true, volume, bounds: {min:[x,y,z], max:[x,y,z]},
  topology: {solids:1, faces, edges, vertices},
  kernel: {name:'OpenCascade', package:'replicad-opencascadejs',
           version:'1.1.0', validation:'BRepCheck_Analyzer'}
}
```

Validation invokes native geometric/exact BRep checks, measures volume/bounds/topology and requires exactly one positive-volume solid with no loose faces/edges/vertices. Empty intersections, full subtraction, surface-only and disconnected unions are rejected; they do not publish a body. This is kernel solid validation, **not complete application-specific geometric postcondition verification or approved project publication**.

Tessellation is plain flat XYZ positions/normals and flat triangle index triples. It is a disposable mesh cache, not geometry authority. Fixed tolerances are exposed in capabilities. STEP returns text, no file path/download/import surface. Export configures meter units, rereads through the kernel and compares volume/bounds before publication; tests additionally reread through a separately initialized kernel. No browser/kernel native pointers cross these interfaces.

## Reproducible client example

With the server running, execute using Node22:

```sh
node --input-type=module <<'JS'
const base = 'http://127.0.0.1:3001';
const caps = await (await fetch(base + '/cad/capabilities')).json();
if (!caps.ok) throw new Error(JSON.stringify(caps));
async function cad(operation) {
  const response = await fetch(base + '/cad/execute', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...caps.result.source, operation})
  });
  const reply = await response.json();
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.result;
}
const box = await cad({kind:'box',center:[0,0,0],dimensions:[2,2,2]});
const cylinder = await cad({kind:'cylinder',center:[0,0,0],radius:0.5,height:2});
const cut = await cad({kind:'boolean',operator:'subtract',left:box.body,right:cylinder.body});
const mesh = await cad({kind:'tessellate',body:cut.body});
const step = await cad({kind:'export-step',body:cut.body});
console.log({body:cut.body,volumeM3:cut.volume,vertices:mesh.vertices.length/3,
             triangles:mesh.triangles.length/3,stepBytes:Buffer.byteLength(step.step)});
for (const body of [box.body,cylinder.body,cut.body]) await cad({kind:'delete',body});
JS
```

## Limits and failures

Read exported `CAD_LIMITS`/capabilities for exact policy: request8KiB, response4MiB, stored bodies32, additive boolean complexity16 primitive leaves, topology256faces/512edges/1024vertices, primitive lengths0.001–100m, center coordinates±1000m, mesh50kvertices/100ktriangles, STEP2MiB, fixed mesh tolerance0.01m/angular0.2rad. Radius is a length parameter, not cylinder diameter. Boolean complexity is conservative and is not reduced by simplification.

One `/cad/execute` request is admitted, including body reading. No queue; a concurrent execute request returns409/`busy`. Capabilities remains available. Body reading has10s timeout, actual kernel startup/operation has15s hard timeout. Kernel execution is in a separate worker, so health/project/read-only dataset/chat do not wait for native computation. Worker JS old-generation heap limit128MiB (young-generation16MiB, stack4MiB) is **not an absolute WASM/native memory cap**; bounded inputs/registry/complexity/topology/output and hard termination limit exposure. This is not an upstream WASM security audit or a peak native-memory guarantee.

Failure is `{ok:false,error:{code,message}}`:

| HTTP | Codes |
| --- | --- |
| 400 | `invalid-request` |
| 403 | `local-only` (non-local Host/Origin) |
| 404 | `unknown-body` |
| 405 | `method-not-allowed` (includes Allow header) |
| 409 | `stale-source`, `stale-body`, `busy` |
| 413 | `resource-limit` (oversized request) |
| 415 | `unsupported-media-type` |
| 422 | `invalid-solid`, `resource-limit` (geometry/output limits) |
| 503 | `kernel-failure`, `closed` |
| 504 | `timeout` |

Normal validation/resource rejections preserve existing bodies. Cancelling an **already dispatched kernel operation**, operation timeout or unexpected worker/kernel failure terminates the worker and invalidates **all existing sandbox handles**. Disconnection during body reading has not dispatched work and does not reset prior handles. After reset, reacquire bodies with new create operations; source binding stays the same until server restart. Server close/restart drops all bodies/session. There is no persistence, import, undo, transform, model tool registration, project commit or viewer integration.

## Verification

`pnpm exec tsx --test tests/cad-engine.test.ts tests/cad-http.test.ts` exercises actual OCCT and public HTTP transport. `pnpm verify` passes138/138 tests, typechecks and builds. Fresh source review and independent failure probes found no actionable defect; task013 lists artifacts, exact commands and graph/LSP limitations. Browser checks were not rerun for this non-UI slice.
