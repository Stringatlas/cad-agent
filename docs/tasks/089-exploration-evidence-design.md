# Task089 Phase4b — conversation regions and evidence links

Status: source-verified design only; no Phase4b runtime implementation or acceptance.
Parent [Task089](089-agentic-scene-exploration.md), following accepted Phase4a marks.
Reuse the shared region vocabulary from [Phase3b](089-agent-view-3b.md); its independent
review/owner acceptance is a separate gate. This design does not accept that slice.

## Outcome and first boundary

The model can retain a checked investigation region, retrieve a receipt from an actual
tool operation, and link its hypotheses to that receipt. The model still chooses what
to investigate, what the result means and what remains uncertain. A declared polygon,
view, count or annotation never proves occupied/free space, suitability or completeness.

Implement **4b1 evidence issuance/lookup plus existing hypothesis links first**, without
region handles. Then **4b2 retained regions and a capture consumer**. Each is independently
reviewable. Existing inline SceneRegion values remain reusable throughout; no new
polygon/query engine, geometry registry, persistence database or generic agent framework.
Only add `evidenceIds` to marks in4b1. Existing rationale/uncertainty express judgement
and unresolved questions; no extra status/questions schema or mandatory workflow.

## Source findings and ownership

Graph query/context for exploration/checkpoint flows was verified against these sources:

- `apps/server/src/agent/scene-exploration.ts`: SceneExploration currently owns one frozen
  SceneMarkSnapshot. replace validates known IDs and expected annotationRevision, issues
  UUIDs only for new marks, and attaches the latest eligible observationId as a delivery
  association. This is not a semantic evidence link or proof of inspection.
- `packages/contracts/src/scene-marks.ts`: <=20 marks,400-character rationale and
  uncertainty, exact cloud/Toronto binding union, frozen copies. Its copy budget currently
  assumes arrays<=20/nodes512; extending rich links requires explicitly bounded revised
  budgets, not an arbitrary passthrough. Do not put64-vertex polygons inside each mark.
- `apps/server/src/agent/provider-model.ts`: Conversation retains input and marks;
  each turn clones from the previous committed checkpoint. The committed map entry is
  replaced only after complete turn/publication succeeds. Credential changes/close clear
  all conversations. Defaults:8 conversations,16 turns,30-minute idle TTL,512KiB text
  history and12MiB retained image text per conversation. Tool work is sequential within
  one serialized provider operation. Existing scene binding includes complete cloud
  identity, but Toronto admission is mode-only; new state must check actual bound source
  metadata independently, not assume conversationBinding proves Toronto revision.
- `apps/web/src/chat/model-chat-client.ts`: display messages are not replay authority.
  Confirmed server failure retains the previous conversation checkpoint; ambiguous
  disconnect/cancel drops the client handle. Failed draft marks clear. New chat/model/
  account/source changes clear scene feedback/continuation. New chat does not currently
  delete the old server entry immediately; it becomes unreachable from this client and
  remains bounded by server TTL/cap/account teardown. Do not claim immediate deletion.
- `apps/server/src/agent/model-agent-runtime.ts`: source and human-approval rebinding,
  current-turn view base, nonce broker and independent pixel source-record verification
  are already separate. Evidence lookup must not recreate a view/pick base or select.
- `packages/contracts/src/spatial-region.ts`, `agent-view.ts`: use exact SceneSourceBinding
  and canonical SceneRegion box/polygon-prism values. A polygon capture fits its enclosing
  box and preserves actual ring/Z in agentView. Never silently translate a polygon into
  a box point query.
- `apps/server/src/agent/cloud-model-scene.ts`, `model-scene.ts`, `model-perception.ts`:
  original-point nearest/radius/box queries are available on prepared/Toronto; metadata,
  taxonomy and optional elevation/terrain capabilities differ. Toronto query results
  explicitly say independentVerification:false; wrapping them must not promote that.
  Prepared IDs are generic tokens; adapter/reference kind comes from bound scene mode,
  not a magic source name. Authored objects/accepted edits/ghosts are separate authorities.
- `apps/server/src/agent/tool-evidence.ts`: RunEvidenceStore is persisted operator/legacy
  run evidence. Do not use it as a model conversation repository. Standard canonical
  JSON/hash utilities may be reused; do not acquire its filesystem/kernel lifecycle.

Suggested files: extend `scene-exploration.ts` as the sole conversation state owner;
new framework-free `packages/contracts/src/exploration-evidence.ts` for the closed
receipt union and canonicalizers; small server `exploration-evidence.ts` for explicit
adapter projections. Reuse existing marks/region/reference types, never redefine them.
Provider dispatch/commit and existing event/client allowlists are integration seams.
All runtime symbols still require fresh graph impact/warnings before implementation.

## 4b1 — actually issued evidence and optional mark links

A receipt is immutable, source-bound historical evidence from a completed, checked
operation. A random server UUID is issued only after closed projection validation and
retention admission. Source identity comes from bound adapter metadata, never tool
arguments, arbitrary browser fields or model-supplied evidence IDs. Check authority
before/after asynchronous operation and before issuance/publication. No receipt for
hard errors, cancelled/late RPCs, proposals, arbitrary text or merely requested work.
A successful tool returning unavailable observations can have an unavailable receipt
only when the original request was valid canonical input admitted to an actual checked
operation. Pre-admission invalid topology/span/relative adjustments and unresolvable
relative bases have no admitted/effective request; preserve their existing unavailable
result unchanged and issue no receipt (optional unsupported-result retention metadata).
Never retain raw malformed args or fabricate a normalized request. An unavailable
receipt records an attempted admitted measurement, not an observed absence.

Every receipt has schemaVersion1, evidenceId, sourceBinding, adapterKind derived from
scene mode, issuing tool enum, successful-turn ordinal, operation status, exact bounded
canonical request projection, typed result projection and SHA256 of that projection.
The hash provides receipt consistency only, not a fresh source audit. Capture authority scope is mandatory: retain the complete server-bound points/CAD/
objects fingerprint (including pending proposal IDs when those layers may be present)
when available, otherwise an explicit unknown/unavailable variant. An omitted authority
field must never be interpreted as current/empty. The fingerprint is derived from
server state at capture admission and checked again after completion; source-only measurements explicitly exclude those layers.
Timestamps are informational and do not grant freshness. Coordinates remain binary64
numbers in local meters; no decimal formatting/reparse.

Initial whitelist (no generic raw-context storage):

| Issuing tool | Retained fields and evidence limits |
| --- | --- |
| query_points, both supported adapters | Canonical operation, position/radius or inclusive bounds, label filter and maxResults. Prepared projection keeps complete,count,checkedPoints. Toronto projection keeps returned complete,totalCount,countsByLabel,distanceMeters,truncated,selection and independentVerification only when actually present; absent fields remain absent, never synthesized zero/true. At most16 original witnesses: exact source key,position,numeric label/instanceId when supplied, plus a closed source-bound reference derived from the checked adapter result. Record returnedWitnessCount,retainedWitnessCount and projectionTruncated separately from adapter complete/truncated. Nearest count semantics stay adapter-specific. No automatic independentVerification upgrade. |
| capture_scene, supported source-bound image | Observation ID; image MIME/hash/byteLength and crop/viewport transform; validated camera and closed agentView; coverage kind/complete/displayedPointCount; closed captureDetail status,pointBudget,budgetLimited,targetPointCount,targetNodeCount when supplied; grounding status/method/bytes/expiry metadata. Do not copy unknown coverage JSON, raw diagnostics or image/data URLs. Browser camera/visibility remain browser-observed. Unavailable captures retain only canonical request and the closed reason. |
| resolve_visual_pixel, source-bound observation | Observation ID,image hash,sent pixel XY; closed result status. Resolved projection retains original key/Float64 coordinate/frame/origin/revision and source reference only after existing runtime verification; preserve server-verified-original-record separately from browser-observed visibility. No-hit/ambiguous/unavailable retain status and sanitized closed reason category, never become occupancy/clearance evidence. |

Capture receipts additionally retain both the original canonical model request and
the effective validated browser scope: source binding, resolved reference/declared
region, fitted bounds/method, active layer/color, camera and sent-image viewport/crop.
Hash these closed projections separately as requestedScopeHash/effectiveScopeHash;
never imply the polygon itself was raster-masked or independently visible. Hashes do
not add geometric authority. Store normalized numeric payloads, not arbitrary raw args.

All three variants carry explicit evidentiary limitations. A projection over its byte cap
cannot be retained; never truncate hashes, coordinates or a polygon. Witness lists may
be deliberately capped as declared above. Unexpected adapter fields are omitted, not
accepted by a broad JSON slot. Implementers must validate these concrete variants and
fixtures; an unknown result variant returns retention-unavailable, not an invented
receipt or guessed complete count. Existing operation result remains unchanged.

Ground/elevation/terrain/entity/CAD tools are **not issuance capabilities in4b1**. Their
current tools remain available under existing gates; add specific receipt variants later
with their adapters/tests. In particular prepared query_elevation is not equivalent to
Toronto ground_elevation. inspect_scene reports exact evidence-issuing tool names.

Attach a small `explorationEvidence` field to the existing supported tool result:
`{status:'retained',evidenceId}` or `{status:'unavailable',reason}`. Closed retention
reasons: unsupported-result,record-too-large,retention-limit. The underlying successful
measurement/image must still be delivered when retention fails. No ID is issued if it
cannot be stored. This new metadata is not CAD/source authority.

New small read tool: `get_scene_evidence({evidenceId})`. Return exactly one retained
closed receipt, or bounded unavailable for unknown/unissued/other-conversation/evicted/
expired/source-mismatched handles. Do not echo untrusted fields or enumerate another
conversation. A historical receipt carries its capture-time/source/authority binding,
not a statement of current visibility. It returns no image bytes and does not attach
an image, rerun a tool, repopulate a browser snapshot or select/rebind the scene.

Existing get/set_scene_marks gain optional `evidenceIds` (0..8 unique issued IDs per
mark). A supplied ID must exist in the current turn draft or committed checkpoint,
match the current original source binding and pass retention checks. Mark coordinates
remain model-authored hypotheses; linking a source point does not snap/verify them.
Presence of a link means model-declared relevance, never automatically support,
suitability or a verified assessment. Retain rationale/uncertainty and rank/ID/revision
semantics. A missing optional field on replacement deliberately clears old links;
never silently preserve omitted evidence. Reject dangling IDs atomically, with nothing
changed. Unknown mark IDs/revisions keep the current conflict behavior.

Keep legacy observationId readable as a delivery association. Do not convert it into
an evidence ID, retroactively pin it, or call it verified. Old marks without evidenceIds
canonicalize unchanged. Do not change existing renderer/C1–Cn meaning or add panels.
The initial receipt catalogue is offered as compact bounded IDs/tool/status summaries
(max16 recent entries, <=4KiB) in current turn scene context; linked older IDs remain
available via marks. Full receipts are fetched explicitly, not reinserted every turn.

## 4b2 — retained checked region values

Add16 conversation region slots, each with server-issued ID, short label<=200 chars,
canonical SceneRegion, and optional0..8 evidenceIds. Label and existing hypothesis
uncertainty supply purpose/questions; no generic task/status schema. Region evidence
links are model-declared investigations, not a machine assertion that the whole region
was covered. Actual receipt request/coverage remains independently inspectable. No
field called understood,clear or complete is derived from linking evidence. A capture
of a polygon's enclosing box is a view attempt and never polygon point coverage.

Two narrow tools mirror existing mark revision replacement:

- `get_scene_regions({offset,limit})`, offset0..15,limit1..4; returns current regionRevision,
  totalCount and a byte-bounded page (<=32KiB). No nondeterministic reranking.
- `set_scene_regions({expectedRevision,regions})`: replace<=16 entries, preserve known
  IDs only, omit ID for new values, empty list clears. New UUIDs only after all validation
  succeeds. Existing ID's region value is immutable; revise by removing/replacing with
  a new ID. Label/evidence links may change under regionRevision. No silent dedup or
  aliasing; each retained handle resolves to exactly the value it originally identified.

Every input is canonicalized/detached and complete source binding compared before
safe geometry/limit errors, preserving Phase3b identity-first rules. Unknown IDs,
wrong revision/source, unsupported shape, invalid topology or overflow change nothing.
Removing a region still linked from a mark fails region-in-use; first revise marks to
remove that association. Add optional single regionId to marks only in this slice;
regions are not authored bodies or occupancy bounds.

First consumer: capture frame target may accept `{kind:'region-handle',regionId}` only
when conversation regions are available. Resolve server-side to the canonical existing
inline SceneRegion before the accepted capture/LOD/browser path. Compare binding again
before dispatch and after async work. Receipt includes actual resolved region and its
optional issued regionId association, not a browser-authoritative ID. An old observation
is still not a view base; current-turn relative handling remains unchanged. No Phase7
camera/image resume work is included.

Later query/entity/measurement tools can take the same region value or resolve its ID
through this one owner. query_points currently supports nearest/radius/box only: no
polygon request, automatic bounding-box substitution or claim of polygon statistics.
If a future box consumer accepts a stored polygon, it must reject unsupported-shape
unless the model explicitly requests a separately declared bounding box. Source keys
stay existing ModelReferenceSelection values and require independent lookup when used;
no parallel generic reference IDs are needed in4b.

## Bounded state, commit and lifecycle

Extend SceneExploration with one immutable checkpoint containing existing marks,
regionRevision/records and typed evidence records, plus complete source binding. Retain
this checkpoint in Conversation; read legacy previous.marks as migration input only.
Do not retain a second authoritative mark copy. Keep annotationRevision for existing
marks and separate regionRevision for region replacement; immutable evidence issuance
has no model-controlled revision. Cross-record references are validated against the
same sequential draft and changed atomically. Actual UTF8 byte accounting (TextEncoder in framework-free validation; Buffer.byteLength
at server admission) includes metadata/IDs/strings, not only result arrays. Check the
complete closed receipt before installation and again at aggregate checkpoint commit;
character-count estimates are not sufficient for multilingual text. Every receipt
variant has an explicit typed schema with exact keys; no generic JSON payload field.

Proposed hard limits, enforced before installation:

| Item | Bound |
| --- | --- |
| Marks / links | Existing20;4KiB each including existing text and <=8 evidence IDs |
| Regions | <=16;<=8KiB each, <=64KiB replacement request |
| Evidence | <=128 retained receipts;<=16KiB each;<=16 retained point witnesses |
| Entire checkpoint | <=256KiB canonical UTF8, including marks/regions/evidence/index |
| Model-facing lookup/context | One receipt<=16KiB; catalogue<=4KiB; regions page<=32KiB |

These are simultaneous caps:128 records does not promise128 full16KiB results. Before
retaining a new receipt, evict oldest **unlinked** receipts until count/bytes fit. Mark
and region links pin records. Never evict linked records or silently remove links.
If pins/caps prevent admission, issue no receipt ID and return retention-limit alongside
the successful operation. Explicit mark/region replacement can release pins; retrying
lookup does not rerun measurements. Evicted IDs return unavailable, not fresh results;
no unbounded tombstone ledger. Retention is a window, not a durable audit log.

At8 server conversations the extra retained serialized state is <=2MiB, plus one
<=256KiB active draft under the existing single-operation lock; JS object/clone overhead
is additional and must be measured. Reuse immutable receipt/value references internally
rather than copying source clouds/images. No point buffer, image bytes, renderer object,
snapshot or source reader is stored here. Existing browser grounding cap/TTL and
3M default/50M custom LOD setting stay independent and unchanged.

Draft records/IDs can be used by subsequent tools in the same turn, but are provisional
until the existing whole-turn success/checked publication boundary commits checkpoint
and history together. Failed/provider-rejected/cancelled/disconnected/late turns never
replace the prior checkpoint, pin records or leave client overlays. Replayed display
messages, supplied IDs and function output text cannot import receipts/regions. On an
explicit retry after confirmed failure use the last successful checkpoint; client loses
continuation after ambiguous interruption as today. Existing tool events display draft
marks; clear them on failure and reconstruct only from the committed next-turn state.

Source admission remains unchanged: a cloud conversation ID with a different source,
revision, frame or origin is a hard stale-conversation rejection. An old conversation
ID never selects/rebinds a new source or grants authority. Only within an otherwise
valid/current admitted conversation or authorized runtime rebind, compare complete
actual metadata (including Toronto revision/frame/origin) before restoring exploration.
If that valid source transition changes the exploration binding, start empty exploration
state and publish an explicit reset reason; old evidence IDs cannot resolve into the
new source. Do not suppress an existing stale-scene/stale-conversation failure, silently
replace source-bound values or migrate coordinates. Normal source-key
values may be re-resolved later against the explicitly matching current source, but old
conversation IDs are not resurrected. Account/model policy changes and server restart
retain existing continuation invalidation; process-local evidence/region IDs disappear.
No localStorage import/persistence/resume database. New chat drops client access at once;
old server checkpoint remains bounded until current TTL/teardown eviction as noted above.

Human-approved accepted-state changes: existing authority-bound Toronto marks reset
under the existing SceneMarkSnapshot binding policy. Source-only declared regions and
original-source measurement receipts can remain if complete original binding matches;
old captured-layer receipts remain historical with their original authority fingerprint.
Never relabel them current after a CAD/point/object change. Runtime selection/rebind,
view-base revocation and human approval remain independently authoritative.

History limits stay512KiB text/12MiB image/16turns. Check actual combined effective body
with normal historyCheck; a new memory budget does not expand provider/image budgets.
Retain full tool messages already emitted under existing limits; receipts do not justify
silently pruning raw history or claiming retained images can be rehydrated. Phase7 owns
context compaction and cross-turn view resume. Byte/hash/lifecycle evidence retrieval is
not image perception or model judgement.

## Sequential implementation and acceptance

1. **4b1a typed receipt owner/issuance/lookup**: contracts, explicit query_points/capture/
   pixel projections, UUID admission and bounded eviction/pinning primitives in existing
   SceneExploration; provider stages/commits with history. Advertise get_scene_evidence
   only with actual source-bound exploration. Fake-provider tests must inspect effective
   schemas/results and successful-turn-only retained state; no browser UI required yet.
2. **4b1b marks evidenceIds**: closed optional field, issued/current-source validation,
   atomic replacement/conflicts/pins, compatibility with old observationId/renderer and
   browser stream rollback. Match static/runtime skills and allowlists. Built prepared/
   Toronto sequence: measure/capture -> link -> follow-up lookup -> revise after conflicting
   evidence; model questions remain rationale/uncertainty. Complete4b1 independently.
3. **4b2 regions/capture handle**: reuse SceneRegion canonicalizers, get/set revision
   values, optional mark regionId, one server resolver and capture consumer; no polygon
   query extension. Built boxes/concave polygons -> frame -> relative -> linked evidence,
   source replacement/mobile/reset; accept independently.

Acceptance includes closed malicious/oversized fields; Float64/key/frame preservation;
unknown/forged/cross-conversation IDs; incomplete/unavailable/no-hit results; no automatic
coverage or independentVerification upgrades; pin exhaustion that still returns the
successful measurement; bounded unlinked eviction and unavailable lookup; stale source
plus malformed geometry identity-first; committed checkpoint after failed late publish;
legacy mark replacement/observationId; same-source approved edit versus historical image;
account/model/New chat/restart/TTL; actual provider-body/history limits, prepared ID named
toronto3d and adapter capability truth. Run focused checks/typecheck/build/full appropriate
baseline and built desktop/mobile fixture checks. Inspect actual scoped diff. Fresh-session
independent review and coordinating owner acceptance remain separate gates for each slice.

## Deferred deliberately

Ground/elevation/terrain receipt variants, entity bounds and statistics require their own
explicit adapters/tests. Durable export/resume, image replay/compaction/camera handles are
Phase7. No generic storage API, arbitrary evidence JSON, geometry edits, approval bypass,
automatic ranking/snapping, hidden investigation loop or inferred whole-region completeness.
