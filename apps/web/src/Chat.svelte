<script lang="ts">
  import type { AuthoredObjectReference, DatumPoint } from '@spatial/contracts';
  import { type PointOverrideSnapshot, type ModelReferenceSelection } from '@spatial/contracts';
  import type { TorontoDraftPoint, PointName } from './draft-context';
  import ModelChat from './ModelChat.svelte';
  import { effectivePosition } from './point-override-client';
  import { pointSemanticName, semanticName } from './point-presentation';
  import { onDestroy, tick, untrack } from 'svelte';
  import { createPointTypeChannel, pointTypeKey, type PointTypeState } from './point-type-client';
  import type { VisualModelSource } from './visual-model-source';
  import type { AreaOfInterestInput } from './area-of-interest';
  import { modelScene } from './model-chat-client';
  let { objectReferences = [], selectedObject, onclearobject = () => {}, objectBlocked = true, onobjectproposal = () => {}, areaInput, sceneMode, points, pointStatus, onclearpoint, visualSource, pointOverrides, onverifiedresult, onplacementsearch, onareacandidates, onscenemarks, pointBlocked = true, onpointproposal = () => {}, oncadproposal = () => {}, ontorontostreaming = () => {}, onselectreference, onauthorityrefresh, torontoCadBlocked = true }: {
    objectReferences?: readonly AuthoredObjectReference[]; selectedObject?: DatumPoint; onclearobject?: () => void; objectBlocked?: boolean; onobjectproposal?: () => void;
    areaInput?: AreaOfInterestInput;
    onselectreference: (reference: ModelReferenceSelection, isCurrent: () => boolean) => Promise<void>;
    onauthorityrefresh: () => Promise<void>;
    torontoCadBlocked?: boolean;
    oncadproposal?: () => void; ontorontostreaming?: (streaming: boolean) => void;
    pointBlocked?: boolean; onpointproposal?: () => void;
    pointOverrides?: PointOverrideSnapshot;
    onverifiedresult: (context: unknown) => void;
    onplacementsearch: (result: unknown, current: () => boolean) => Promise<void>;
    onareacandidates: (result: unknown, current: () => boolean) => Promise<void>;
    onscenemarks: (snapshot: unknown) => void;
    visualSource?: VisualModelSource;
    sceneMode: string;
    points: readonly TorontoDraftPoint[]; pointStatus: string; onclearpoint: (name: PointName) => void;
  } = $props();
  const activePoints = $derived(sceneMode === 'toronto' ? points : []);
  let pointTypes = $state<PointTypeState>(new Map());
  const pointTypeChannel = createPointTypeChannel(value => pointTypes = value);
  $effect(() => { const references = activePoints; untrack(() => pointTypeChannel.bind(references)); });
  onDestroy(() => pointTypeChannel.dispose());
  function selectedType(point: TorontoDraftPoint) {
    const known = pointSemanticName(point); if (known !== 'Unknown') return known;
    const label = pointTypes.get(pointTypeKey(point));
    return label === 'loading' ? 'Loading type…' : semanticName(label);
  }
  // Query lineage stays attached locally; the strict model-reference protocol carries only original source fields.
  const scene = $derived(modelScene(sceneMode, activePoints.map(({ evidence: _evidence, semanticLabel: _label, ...original }) => original), areaInput?.area, objectReferences));
  const listedPoints = $derived(activePoints);
  const referencePreview = $derived([...listedPoints.map(point => `${point.name} · ${selectedType(point)}`), ...(sceneMode === 'toronto' && selectedObject ? [`${selectedObject.name} · Datum point`] : [])].join(', ') || 'None');
  function effectiveCoordinates(point: TorontoDraftPoint) { try { return effectivePosition(point, pointOverrides).join(', '); } catch { return 'Source mismatch — refresh and reselect'; } }
</script>

<aside class="chat" aria-label="Scene chat" data-testid="chat">
  {#if pointStatus}<p class="point-status" role="status" data-testid="point-status">{pointStatus}</p>{/if}
  <details class="attachments" data-testid="draft-attachments" aria-label="Scene point references">
    <summary><span>Scene references</span><span class="reference-preview" title={referencePreview}>{referencePreview}</span>{#if listedPoints.length}<span class="reference-count" aria-label={`${listedPoints.length} source references`}>{listedPoints.length}</span>{/if}</summary>

    {#if sceneMode === 'toronto' && selectedObject}<div class="attachment" data-testid="datum-chat-reference"><div class="attachment-heading"><strong>{selectedObject.name} · Datum point</strong><button type="button" aria-label={`Remove ${selectedObject.name} reference`} onclick={onclearobject}>×</button></div><details><summary>Details</summary><p>[{selectedObject.position.join(', ')}] m · Toronto local</p><pre>{JSON.stringify(objectReferences[0], null, 2)}</pre></details></div>{/if}
    {#if listedPoints.length}
      <div class="point-list" role="list" aria-label="Numbered scene points">
      {#each listedPoints as point (point.name)}
        <div class="attachment" role="listitem" data-testid={`draft-point-${point.name}`}>
          <div class="attachment-heading"><strong>{point.name}</strong><span data-testid={`point-type-${point.name}`}>{selectedType(point)}</span><button type="button" aria-label={`Remove ${point.name}`} data-testid={`remove-draft-point-${point.name}`} onclick={() => onclearpoint(point.name)}>×</button></div>
          <details><summary>Details</summary><p class="coordinates">Original [{point.position.join(', ')}] m</p>{#if pointOverrides}<p class="coordinates">Effective [{effectiveCoordinates(point)}] m · override revision {pointOverrides.revision}</p>{/if}<dl><dt>Prepared point key</dt><dd>File {point.key.sourceFileId} · row {point.key.sourceRow}</dd><dt>Artifact revision</dt><dd>{point.artifactRevision}</dd><dt>Frame / units</dt><dd>{point.frameId} · meters · right-handed Z-up</dd><dt>World origin (translation only)</dt><dd>[{point.localOrigin.join(', ')}]</dd></dl><pre data-testid={`draft-point-json-${point.name}`}>{JSON.stringify(point, null, 2)}</pre></details>
        </div>
      {/each}
      </div>

    {:else if !selectedObject || sceneMode !== 'toronto'}
      <p class="empty">{sceneMode === 'pole' ? 'Switch to Toronto3D to attach numbered points.' : 'Cmd/Ctrl-click any rendered cloud point to attach Point 1, Point 2, and more.'}</p>
    {/if}
  </details>
  <ModelChat {scene} {visualSource} points={activePoints} {onverifiedresult} areaInput={sceneMode === 'toronto' ? areaInput : undefined}
    onscenemarks={snapshot => { if (sceneMode !== 'toronto') throw new Error('Location annotations unavailable.'); onscenemarks(snapshot); }}
    onareacandidates={(result, current) => { if (sceneMode !== 'toronto' || !current()) throw new Error('Toronto candidates unavailable.'); return onareacandidates(result, () => sceneMode === 'toronto' && current()); }}
    onplacementsearch={(result, current) => { if (sceneMode !== 'toronto' || !current()) throw new Error('Toronto placement unavailable.'); return onplacementsearch(result, () => sceneMode === 'toronto' && current()); }}
    onselectreference={async (reference, current) => { await onselectreference(reference, current); await tick(); return scene; }}
    onauthorityrefresh={async () => { await onauthorityrefresh(); await tick(); return scene; }}
    proposalsBlocked={sceneMode === 'toronto' && (torontoCadBlocked || pointBlocked || objectBlocked)}
    onstreamingchange={streaming => { ontorontostreaming(streaming); }}
    onauthorityproposal={kind => { if (sceneMode === 'toronto') { if (kind === 'cad') oncadproposal(); else if (kind === 'objects') onobjectproposal(); else onpointproposal(); } }} />
</aside>

<style>
  .chat { box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; height: 100%; min-height: 0; min-width: 0; overflow: hidden; background: #202124; color: #f1f1f3; padding: 12px; }
  .attachment-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .point-status { margin: 0; flex-shrink: 0; max-height: 52px; overflow: auto; color: #d7c697; }
  .attachments { flex-shrink: 0; min-height: 0; border-top: 1px solid #ffffff12; padding-top: 9px; font-size: 11px; }
  .attachments[open] { flex-shrink: 0; max-height: 30%; overflow: auto; overscroll-behavior: contain; }
  summary { cursor: pointer; color: #b9b9c1; } summary:focus-visible, button:focus-visible { outline: 2px solid #70a9ff; outline-offset: 3px; }
  .attachments > summary { display: flex; align-items: center; gap: 8px; }
  .attachments > summary::before { content: '▸'; color: #8e8e98; }
  .attachments[open] > summary::before { content: '▾'; }
  .reference-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a5a5af; }
  .reference-count { margin-left: auto; color: #8e8e98; font-variant-numeric: tabular-nums; }
  .empty { padding: 6px 0; color: #92929c; }
  @media(pointer: coarse) { .attachment-heading > button { min-width: 44px; min-height: 44px; } summary { min-height: 32px; } }
  .attachment { background: #151619; border: 1px solid #ffffff12; border-radius: 10px; margin: 8px 0; padding: 10px; }
  .attachment-heading { font-size: 11px; justify-content: start; } .attachment-heading > button { margin-left: auto; border: 0; padding: 0 5px; font-size: 18px; }
  .attachment-heading strong { overflow-wrap: anywhere; }
  .coordinates { color: #cdccd3; font-family: ui-monospace, monospace; font-size: 10px; overflow-wrap: anywhere; } .attachment summary { font-size: 10px; color: #92929c; }
  dt { color: #9898a3; font-size: 10px; } dt { margin-top: 8px; } dd { margin: 0; overflow-wrap: anywhere; font-size: 10px; }
</style>
