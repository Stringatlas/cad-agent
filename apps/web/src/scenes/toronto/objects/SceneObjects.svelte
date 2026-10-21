<script lang="ts">
  import type { SceneObjectReference, PointOverrideSnapshot } from '@spatial/contracts';
  import type { TorontoDraftPoint } from '../../../chat/draft-context';
  import type { AreaOfInterestInput } from '../placement/area-of-interest';
  import { authoredReference, type SceneObjectController, type SceneObjectView } from './scene-object-client';
  let { view, controller, points, overrides, selectedId, selectedSource, hiddenIds = [], onvisibility, areaInput, streaming = false, onselect, onsource, onpending, onfocus }: {
    view: SceneObjectView; controller: SceneObjectController; points: readonly TorontoDraftPoint[]; overrides?: PointOverrideSnapshot;
    areaInput?: Pick<AreaOfInterestInput, 'pending' | 'clear'>;
    selectedId?: string; selectedSource?: string; hiddenIds?: readonly string[]; onvisibility: (id: string, visible: boolean) => void; streaming?: boolean;
    onselect: (id?: string) => void; onsource: (name: string) => void; onpending: (id: string) => void; onfocus: (position: readonly [number, number, number]) => void;
  } = $props();
  let navigator: HTMLDivElement;
  let open = $state(false), create = $state(false), referenceMode = $state(false);
  let name = $state('Point'), values = $state([0, 0, 0]);
  const selected = $derived(view.snapshot?.objects.find(object => object.id === selectedId));
  const source = $derived(points.find(point => point.name === selectedSource));
  const reference = $derived.by<SceneObjectReference | undefined>(() => {
    if (selected && view.snapshot) return authoredReference(view.snapshot, selected);
    if (source && overrides && source.artifactRevision === overrides.artifactRevision) return {
      kind: 'source-record', datasetId: 'toronto3d', artifactRevision: source.artifactRevision, key: source.key,
      domain: 'effective', overrideSessionId: overrides.sessionId, overrideRevision: overrides.revision, frameId: 'toronto3d-local-v1', units: 'm',
    };
    return undefined;
  });
  const blocked = $derived(view.busy || view.needsRefresh || streaming);
  async function preview(event: SubmitEvent) {
    event.preventDefault();
    if (blocked || values.some(n => !Number.isFinite(n)) || !name.trim() || (referenceMode && !reference)) return;
    const vector = [values[0]!, values[1]!, values[2]!] as const;
    const count = view.snapshot?.proposals.length ?? 0;
    await controller.propose(name.trim(), referenceMode && reference ? { kind: 'reference', reference, offset: vector } : { kind: 'position', position: vector });
    if ((view.snapshot?.proposals.length ?? 0) > count) { create = false; open = false; }
  }
  function navigate(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (!navigator?.contains(target) || target.matches('input, select, textarea')) return;
    if (target.tagName === 'SUMMARY' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      (target.parentElement as HTMLDetailsElement).open = event.key === 'ArrowRight'; event.preventDefault(); return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const host = navigator;
    const items = [...host.querySelectorAll<HTMLElement>('summary, button:not(:disabled), input:not(:disabled), select')].filter(node => node.getClientRects().length);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault(); items[next]?.focus();
  }
</script>

<svelte:window onkeydown={navigate} />
<div class="navigator" data-testid="scene-hierarchy" bind:this={navigator} role="group" aria-label="Scene hierarchy">
  <button class="heading" aria-expanded={open} onclick={() => open = !open}>Scene <span aria-hidden="true">{open ? '−' : '+'}</span></button>
  {#if selected}
    <section class="selection" aria-label="Selected datum point" data-testid="selected-datum">
      <strong>{selected.name} · Datum point</strong>
      <div class="selection-actions"><button onclick={() => onfocus(selected!.position)}>Focus</button><button onclick={() => onselect(undefined)}>Clear selection</button></div>
      <details><summary>Details</summary><p>[{selected.position.join(', ')}] m · Toronto local · Z-up</p><pre>{JSON.stringify(reference, null, 2)}</pre></details>
    </section>
  {/if}
  {#if open}
    <div class="contents">
      {#if areaInput}
        <div class="area-row" data-testid="area-of-interest">
          <span role="status">Area of interest <small>All heights{areaInput.pending ? ' · Capturing…' : ''}</small></span>
          <button type="button" data-testid="clear-area" aria-label="Clear area of interest" onclick={() => areaInput?.clear()}>Clear</button>
        </div>
      {/if}
      <details><summary>Sources</summary><button class="row" onclick={() => { onselect(undefined); }}>▧ Toronto3D cloud</button>
        {#each points as point (point.name)}<button class="row nested" aria-pressed={selectedSource === point.name && !selectedId} onclick={() => onsource(point.name)}>{point.name} · Source point</button>{/each}
      </details>
      <details open><summary>Design</summary>
        {#each view.snapshot?.objects ?? [] as object (object.id)}
          <div class="object-row">
            <button class="row" data-testid="datum-row" aria-pressed={selectedId === object.id} disabled={hiddenIds.includes(object.id)} onclick={() => onselect(object.id)}>◇ {object.name} <span>Datum point</span></button>
            <button class="visibility" data-testid="datum-visibility" aria-label={`${hiddenIds.includes(object.id) ? 'Show' : 'Hide'} ${object.name}`} aria-pressed={!hiddenIds.includes(object.id)} title="View only" onclick={() => onvisibility(object.id, hiddenIds.includes(object.id))}>{hiddenIds.includes(object.id) ? 'Show' : 'Hide'}</button>
          </div>
        {:else}<p class="quiet">No datum points</p>{/each}
      </details>
      {#if view.snapshot?.proposals.length}<details open><summary>Pending changes</summary>{#each view.snapshot.proposals as proposal (proposal.proposalId)}<button class="row" onclick={() => onpending(proposal.proposalId)}>◇ {proposal.object.name} <span>Pending point</span></button>{/each}</details>{/if}
      <button aria-expanded={create} data-testid="create-point-tool" disabled={blocked} onclick={() => create = !create}>Create Point</button>
      {#if create}<form onsubmit={preview} data-testid="create-point-form">
        <label>Name<input maxlength="80" required bind:value={name} /></label>
        <label>Position<select bind:value={referenceMode} disabled={blocked}><option value={false}>Coordinates</option><option value={true}>Selected reference + offset</option></select></label>
        {#if referenceMode}<p class="quiet">{reference ? `${selected?.name ?? source?.name} · checked ${selected ? 'datum' : 'effective source'}` : 'Select a datum or pin and select a source point.'}</p>{/if}
        <p class="quiet">Toronto local · meters · Z-up</p>
        <div class="axes">{#each ['X', 'Y', 'Z'] as axis, index}<label>{referenceMode ? 'Δ' : ''}{axis}<input aria-label={`${referenceMode ? 'Offset ' : ''}${axis} (m)`} data-testid={`datum-${axis.toLowerCase()}`} type="number" step="any" required bind:value={values[index]} /></label>{/each}</div>
        <button data-testid="datum-preview" disabled={blocked || !name.trim() || values.some(n => !Number.isFinite(n)) || (referenceMode && !reference)}>Preview point</button>
      </form>{/if}
      <button data-testid="datum-undo" disabled={blocked || !view.snapshot?.nextUndoTransactionId} onclick={() => void controller.undo()}>Undo point</button>
      <details><summary>Details</summary><p class="quiet">Datum points and history are session-only; server restart clears them.</p><button disabled={view.busy || streaming} onclick={() => void controller.refresh()}>Refresh objects</button></details>
    </div>
  {/if}
  {#if view.error}<div class="recovery" role="alert"><p>{view.error}</p><button disabled={view.busy} onclick={() => void controller.refresh()}>Refresh objects</button></div>{/if}
</div>

<style>
  .navigator { position: absolute; left: 16px; top: 70px; z-index: 4; max-width: calc(100% - 32px); width: 248px; color: #eeeef2; font-size: 12px; }
  .area-row { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; color: #8be6d4; } .area-row span { flex: 1; } .area-row small { display: block; margin-top: 3px; font-size: 11px; color: #a8a9b0; }
  .object-row { display: flex; gap: 4px; align-items: stretch; } .object-row .row { flex: 1; min-width: 0; overflow-wrap: anywhere; } .visibility { flex-shrink: 0; }
  .heading { display: flex; gap: 24px; justify-content: space-between; width: auto; padding: 9px 12px; }
  .contents, .recovery { margin-top: 6px; padding: 10px; border: 1px solid #ffffff24; border-radius: 12px; background: #202124f5; max-height: min(55dvh, 480px); overflow: auto; overscroll-behavior: contain; box-shadow: 0 8px 24px #0004; }
  details { margin: 5px 0; } summary { cursor: pointer; padding: 7px 0; } .quiet { font-size: 11px; color: #a8a9b0; margin: 6px 0; }
  button, input, select { font: inherit; color: inherit; background: #292a2e; border: 1px solid #ffffff20; border-radius: 7px; padding: 8px; box-sizing: border-box; }
  button { cursor: pointer; margin: 3px 0; } button:disabled { opacity: .45; cursor: default; } button[aria-pressed="true"] { border-color: #82e3e0; background: #334448; } .row { display: block; width: 100%; text-align: left; } .row span { display: block; font-size: 10px; color: #b8b9c1; padding-left: 15px; } .nested { padding-left: 18px; } label { display: block; margin: 7px 0; } input, select { display: block; width: 100%; margin-top: 4px; min-width: 0; } .axes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; } .selection { margin: 6px 0; padding: 10px; border: 1px solid #ffffff24; border-radius: 10px; background: #202124f5; max-height: 25dvh; overflow: auto; } .selection-actions { display: flex; gap: 6px; } .selection strong { display: block; } pre { font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; } .recovery { color: #ffd187; }
  @media(pointer: coarse) { button { min-height: 44px; } }
  @media(max-width: 600px) { .navigator { left: 12px; top: 112px; width: 224px; } .contents { max-height: 35dvh; } }
</style>
