# CAD document objects and scene hierarchy

Status: **first authored-datum checkpoint implemented; fresh-session review pending**.
[Task052](../tasks/052-scene-object-model.md) records implementation, verification and
remaining limitations. The broader document-object design below remains direction,
not approval for a document-engine rewrite. Read alongside [architecture](../architecture.md)
and [product vision](../product-vision.md).

## Problem grounded in current code

- `packages/contracts/src/index.ts`: synthetic `Entity` is only point-cloud or
  parameter box; it is not the Toronto CAD document.
- `packages/contracts/src/point-overrides.ts`: point moves require an existing
  source `PointKey`. They cannot create a new point.
- `packages/contracts/src/toronto-cad.ts` and
  `apps/server/src/cad/toronto-cad-session.ts`: separate volatile Toronto authority
  retains real box/cylinder candidates and publishes exact bodies on acceptance.
- `apps/server/src/agent/model-scene.ts`: model access binds these separate authorities;
  there is no shared authored-object identity/reference model.

Adding fake source records or another renderer-only point tool would perpetuate
this split. A new point should be an authored datum with its own authoritative ID.

## Recommendation

Borrow the *legible organizational tree* of Unity/Godot and the *typed geometry,
features and references* of CAD. Do not introduce an ECS, arbitrary scripts,
implicit parent transforms, or a full parametric solver.

### Three separate structures

1. **Containment tree:** where an object belongs, with one parent, unique IDs and
   no cycles. Reparenting is organizational, not a geometry operation.
2. **Feature/reference graph:** what an object was derived from or depends on.
   Separate from containment; changing a folder must not rebuild geometry.
3. **Proposal ledger:** pending exact changes and their human decisions. Ghosts
   project candidates from this ledger, not committed document objects.

Illustrative navigator (sections may be virtual, not persisted containers):

```text
Toronto workspace
  Sources
    Toronto3D cloud                 external artifact, lazy records
  Derived observations
    Pole instances / ground / fits read-only artifact-backed estimates
  Design
    Point A                        authored datum point
    Equipment                      organizational group, optional later
      Box 1                        CAD body
  Pending changes                  separate review projection
    Create Point B                 non-authoritative ghost
```

Do not allocate one document node per source point. A cloud is one artifact-backed
object; records are addressed lazily by their original provenance. Derived
instances retain their own artifact-scoped identities, not editable body IDs.

## UI direction — scene hierarchy and object tools

User requirement: model the object-tool UI as well as the contracts, with a
**hierarchy at the top-left of the 3D scene**. This is part of the proposed
implementation, not an optional later navigator.

- Use a compact, collapsible scene navigator anchored inside the scene's top-left.
  Show Sources, Derived observations and Design as readable sections; lazily
  expand artifact-backed content, never enumerate millions of source records.
- Rows show a type icon and name; selection synchronizes both ways with scene
  picking. Selecting a datum identifies it as `Datum point`, not a source point.
  Source records remain contextual selections beneath their owning cloud rather
  than permanent rows. Derived instances load lazily with bounded/paged lists.
- Distinguish pending rows/markers from committed objects in text as well as color.
  Pending changes remain backed by the separate proposal ledger. Clicking one
  focuses its existing per-change review card; the tree is not an approval bypass.
- Model object tools alongside the tree: a small Create menu initially offers
  Point, with existing CAD creation capabilities exposed only where supported.
  A point editor accepts explicit coordinates or a selected reference plus offset,
  displays the coordinate frame/units and produces a preview before publication.
  Manual previews use the same checked candidate/approval path as model proposals.
- Keep contextual actions small: select/focus, hide/show as view-only state, and
  supported inspect/create actions. Do not display dead rename/delete/group tools
  until their authoritative operations exist. UUIDs, revisions and provenance go
  in expandable Details, not tree row badges.
- Support keyboard tree navigation, accessible expand/selection states and labeled
  controls. On mobile the same top-left entry opens a bounded overlay, not a
  second permanent side panel. It must not cover approval controls or conflict
  with existing scene controls; resolve actual placement during implementation.
- Specify and browser-check empty, collapsed, expanded, selected, pending, stale
  and error states. Preserve the scene as the primary surface.

## Contract direction

Use a versioned discriminated union with a small common envelope. The following
is a target vocabulary, **not a claim that these TypeScript contracts exist**:

```ts
type ObjectHeader = {
  id: ObjectId;                  // authority allocated, stable across rename
  name: string;                  // display text, never identity
  parentId: ObjectId | null;
  frameId: FrameId;              // registered explicit coordinates, units m
  objectRevision: number;
};

type DocumentObject = ObjectHeader & (
  | { kind: 'group' }
  | { kind: 'datum-point'; position: Vec3; provenance?: CreationEvidence }
  | { kind: 'cad-body'; geometry: CadGeometryRef; featureId: FeatureId }
  | { kind: 'point-cloud'; source: DatasetArtifactRef }
  | { kind: 'derived-layer'; source: DerivedArtifactRef }
);
```

First slice implements only authored datum points and their bindings/references;
other kinds describe the extension direction, not mandatory empty infrastructure.
Body geometry references go through adapters; no OpenCascade or Three.js types
cross the contracts boundary. Meshes and GPU indices are disposable caches.
Document object IDs must not be conflated with kernel worker body handles.

References must distinguish:

- **authored object:** authority/session + object ID + expected revision;
- **source record:** dataset/artifact revision + original `PointKey` + explicit
  original/effective position domain and override binding where applicable;
- **derived entity:** derivation artifact revision + derived ID + source binding.

`Point 1` in chat remains a presentation alias for a typed reference. An authored
point must not acquire a fictitious source row or an inferred semantic class.
Position, frame and units are checked by authority, not inferred from the viewer.

### Spatial and dependency rules

- Begin in `toronto3d-local-v1`, meters, right-handed Z-up, using existing origin
  metadata. No synthetic-to-Toronto mapping and no nested transforms.
- A copied source position becomes an independent datum with provenance. Moving
  the source later does **not** move that datum.
- Associative constraints, sketches, feature regeneration and topology naming
  are later milestones. Provenance alone is not a live dependency.
- Future live feature dependencies need cycle checks, explicit recomputation and
  failure handling. Removal of referenced objects should reject until a deliberate
  dependency policy exists; never silently cascade-delete.
- Selection, visibility and camera remain disposable UI state. Renaming/grouping
  must not change geometry; implementation must still version metadata changes
  sufficiently to reject stale metadata edits.

## Approval and authority

A generic change envelope should carry operation kind, exact retained candidate,
proposal ID, target authority/session, base revision, spatial binding and any
referenced-authority preconditions. Use typed operation-specific payloads, not
unrestricted JSON patches. Verification is operation-specific: a finite datum
position is not a kernel-verified solid.

Lifecycle:

```text
validate request → retain exact candidate → show ghost → human decision
  accept: recheck bindings/postconditions → publish atomically → receipt
  decline: discard candidate, no committed geometry change
  stale/expired: invalidate, never represent as a human decline
```

A candidate's reserved object ID is not resolvable as a committed reference.
Acceptance publishes that same ID and exact candidate; Undo removes it through a
checked inverse. Old-revision proposals invalidate, never silently rebase.
Do not expose approval to the model. Reuse the existing per-change review and
agent decision-receipt loop.

**Migration:** a unified schema is not permission to merge authorities immediately.
Keep existing source overrides and CAD sessions authoritative. A shared inspection
facade can identify each owning authority and advertise only supported operations.
Keep separate session/revision bindings until a real document coordinator exists;
never invent one global revision or claim cross-authority atomicity. Read and
recheck dependency bindings when creating points from other authorities.

## First implementation checkpoint: authored point proposals

1. Add strict versioned datum-point contracts, typed references, bounded names and
   finite positions. Reserve IDs server-side. Keep source overrides unchanged.
2. Add a small volatile Toronto authored-object authority with bounded objects,
   proposals and history; snapshot/propose/human accept/decline/Undo. Bind to the
   current dataset artifact and coordinate frame. It is not a second copy of CAD
   or source geometry. Document restart loss explicitly in Details.
3. Expose `scene.propose_point_create` through an additive facade. Initially accept
   one explicit local-meter position or a checked existing reference plus offset;
   normalize it to a retained absolute position. No batch auto-accept, source
   insertion, associative points, persistence or general object CRUD.
4. Render a distinct pending point marker; accepted points become selectable
   `Datum point` objects and attach to chat as typed references. Use the existing
   approval review surface. Implement the compact top-left hierarchy and initial
   Create Point UI described above, backed by the same authority as model tools.
5. Expose bounded list/get/capability inspection for authored objects so subsequent
   turns can discover and reference the accepted point without screen guessing.
   Adapter facade remains honest about which existing tools accept each reference
   kind; generalize those consumers incrementally, not by treating datums as source
   points. Existing nearest-label/source-edit tools must reject unsupported refs.

Acceptance criteria:

- User requests a point; exactly one ghost appears, not a source-cloud record.
- Decline changes no committed object/revision; Accept publishes exactly the
  retained point once, with a stable ID and authority decision receipt.
- Top-left hierarchy and scene selection stay synchronized; Create Point UI and
  model proposals share the same checks, ghosts and per-change approval. Tree
  expansion/visibility never mutates geometry, and mobile collapse preserves room
  for scene interaction and approval.
- Accepted point can be selected, inspected and attached to a later model turn;
  moving the camera cannot change its stored coordinates.
- Wrong frame/artifact/session, stale revisions, nonfinite coordinates, unknown
  fields, duplicate approval and exhausted budgets fail without publication.
- A reference-derived candidate rejects acceptance when a required source/override
  binding changed. After acceptance it stays independent of that source.
- Undo removes only the accepted datum; source bytes, overrides and CAD bodies
  remain unchanged. Existing proposal tools and synthetic fixture still work.
- Contract/authority/tool/client tests cover those cases; real browser checks cover
  idle, pending, selected, decline, accepted, Undo and actionable failure states
  on desktop and mobile. Fresh-session diff review remains a separate gate.

Execution should be sequential through contracts and authority, then parallelize
isolated tool integration and viewer/client work after those APIs stabilize.
Use an independent agent for focused regression review. Each symbol edit requires
fresh impact analysis; refresh the graph when implementation starts.

## Investigation limits and review status

Design verified against the current source contracts and Toronto CAD publication
path. GitNexus repository `cad-agent` was two commits behind HEAD and did not
include all dirty work; graph results are navigation hints, not current coverage.
Its upstream impact for `bindModelScene` reported **HIGH** risk (29 impacted nodes,
7 direct, including model chat handling and server startup). This argues for
additive integration and focused regressions, not a broad replacement.

Task052 implements the bounded datum authority, typed model tools, scene hierarchy,
Create Point editor, ghosts, human decisions and view-only datum visibility. Source
and derived sections are virtual; derived inventory integration and other object
kinds remain future work. Authorities remain separate and volatile. Task052 owns
current test/browser evidence, known baseline failures and graph coverage limits;
fresh-session review remains pending.
