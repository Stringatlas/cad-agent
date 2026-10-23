<script lang="ts">
  import { tick, untrack, onDestroy } from 'svelte';
  import { canonicalModelScene, type ModelScene, type ModelReferenceSelection, type Vec3 } from '@spatial/contracts';
  import ModelChat from './ModelChat.svelte';
  import type { VisualModelSource } from './visual/visual-model-source';
  import type { PreparedPoint, PreparedSample } from '../scenes/point-cloud/prepared-cloud-client';
  let { sample, selected, visualSource, onselectpoint = () => {}, onscenemarks }: { sample: PreparedSample; selected?: PreparedPoint; visualSource?: VisualModelSource; onselectpoint?: (point: PreparedPoint) => void; onscenemarks?: (snapshot: unknown) => void } = $props();
  let references = $state<(PreparedPoint & { name: string })[]>([]), next = 1;
  let status = $state('');
  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());
  const scene = $derived<ModelScene>(canonicalModelScene({ mode: 'cloud', toronto: [], cloud: {
    id: sample.cloud.descriptor.id, revision: sample.cloud.revision, frameId: sample.cloud.descriptor.frameId,
    localOrigin: sample.cloud.descriptor.coordinates.localOrigin,
    points: references.map(p => ({ name: p.name, key: { sourceFileId: p.sourceId, sourceRow: p.sourceRow }, position: p.position })),
  } }));
  function attach(point: PreparedPoint, allowRepeat = false) {
    if (point.cloudId !== sample.cloud.descriptor.id || point.revision !== sample.cloud.revision || point.frameId !== sample.cloud.descriptor.frameId) throw new Error('Scene changed. Select a fresh point.');
    if (!allowRepeat && references.some(p => p.sourceId === point.sourceId && p.sourceRow === point.sourceRow)) return;
    if (references.length >= 32) throw new Error('Remove a reference before attaching another.');
    references = [...references, { ...point, name: `Point ${next++}` }]; status = '';
  }
  $effect(() => { const point = selected; if (point) untrack(() => { try { attach(point); } catch (error) { status = String(error); } }); });
  async function selectReference(reference: ModelReferenceSelection, current: () => boolean): Promise<ModelScene> {
    const cloud = sample.cloud, id = cloud.descriptor.id;
    if (!current() || reference.kind !== 'cloud-point' || reference.cloudId !== id || reference.revision !== cloud.revision) throw new Error('Wrong scene reference.');
    const params = new URLSearchParams({ revision: cloud.revision, sourceFileId: String(reference.key.sourceFileId), sourceRow: String(reference.key.sourceRow) });
    const response = await fetch(`/datasets/prepared/${encodeURIComponent(id)}/point?${params}`, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]), cache: 'no-store' });
    if (!response.ok) throw new Error('Source point unavailable.');
    const result = await response.json();
    const p = result.point;
    if (!current() || sample.cloud !== cloud || result.cloud?.revision !== cloud.revision || result.cloud?.descriptor.id !== id ||
      p?.key?.sourceFileId !== reference.key.sourceFileId || p?.key?.sourceRow !== reference.key.sourceRow ||
      !Array.isArray(p.position) || p.position.length !== 3 || !p.position.every(Number.isFinite)) throw new Error('Scene changed during source lookup.');
    const point: PreparedPoint = { cloudId: id, revision: cloud.revision, frameId: cloud.descriptor.frameId, units: 'm',
      localOrigin: cloud.descriptor.coordinates.localOrigin, sourceId: p.key.sourceFileId, sourceRow: p.key.sourceRow,
      position: [...p.position], label: p.label, instanceId: p.instanceId,
      type: cloud.descriptor.semantics?.classes[String(p.label)] ?? 'Unknown' };
    attach(point, true); onselectpoint(point);
    await tick(); return scene;
  }
</script>
<aside class="cloud-chat" aria-label="Scene chat" data-testid="chat">
  {#if status}<p role="status">{status}</p>{/if}
  <details class="references" data-testid="draft-attachments"><summary>Scene references <span>{references.length || 'None'}</span></summary>
    {#each references as point (point.name)}
      <div class="reference"><strong>{point.name} · {point.type}</strong><button aria-label={`Remove ${point.name}`} onclick={() => references = references.filter(p => p.name !== point.name)}>×</button>
        <details><summary>Details</summary><p>[{point.position.map(n => n.toFixed(3)).join(', ')}] m</p>{#if point.instanceId !== undefined}<p>{point.instanceId === sample.cloud.descriptor.instances?.unassigned ? 'Unassigned instance' : `Instance ${point.instanceId}`}</p>{/if}<p>Source {point.sourceId} · row {point.sourceRow}</p></details>
      </div>
    {:else}<p>Select a cloud point to attach a reference.</p>{/each}
  </details>
  <ModelChat {scene} {visualSource} {onscenemarks} onselectreference={selectReference} />
</aside>
<style>
  .cloud-chat { display:flex; flex-direction:column; gap:10px; height:100%; min-height:0; overflow:hidden; padding:12px; background:#202124; }
  .references { flex-shrink:0; max-height:30%; overflow:auto; font-size:11px; color:#b9b9c1; }
  summary { cursor:pointer; } .references > summary { display:flex; justify-content:space-between; gap:8px; padding:5px 0; }
  .reference { padding:10px; margin-top:8px; border:1px solid #ffffff18; border-radius:9px; background:#151619; }
  .reference button { float:right; color:#eee; border:0; background:transparent; font-size:18px; cursor:pointer; }
  .reference details { margin-top:5px; } p { margin:6px 0; }
</style>
