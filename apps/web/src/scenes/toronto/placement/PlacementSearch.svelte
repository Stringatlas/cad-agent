<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { TORONTO_SEMANTIC_LABELS, type ModelAreaOfInterest, type Vec3 } from '@spatial/contracts';
  import { illustrationSettings, searchPlacementSites, proposePlacementSite, type PlacementShortlist } from './placement-search-client';
  import type { PlacementPreview } from './placement-search-render';
  let { area, authorityKey, blocked = false, invalidated = false, onpreview, onproposed, onfocus = () => {} }: {
    area: ModelAreaOfInterest; authorityKey: string; blocked?: boolean; invalidated?: boolean;
    onpreview: (preview?: PlacementPreview) => void; onproposed: () => Promise<void>; onfocus?: (position: Vec3) => void;
  } = $props();
  let settings = $state(illustrationSettings());
  let result = $state<PlacementShortlist>();
  let selectedId = $state<string>();
  let busy = $state<'search' | 'propose'>();
  let error = $state(''), notice = $state('');
  let open = $state(false);
  let errorMessage = $state<HTMLParagraphElement>();
  $effect(() => {
    if (error && errorMessage) errorMessage.scrollIntoView({ block: 'nearest' });
  });
  let active: AbortController | undefined, generation = 0, alive = true;
  const selected = $derived(result?.candidates.find(c => c.id === selectedId));
  function clear(message = '') {
    generation++; active?.abort(); active = undefined; result = undefined; selectedId = undefined; busy = undefined; error = ''; notice = message; onpreview();
  }
  $effect(() => {
    const key = JSON.stringify([area, authorityKey, invalidated]);
    untrack(() => { if (key) clear(); });
  });
  $effect(() => {
    const preview = result?.status === 'complete' ? { candidates: result.candidates, selectedId, frontAccessDepth: result.specification.parameters.frontAccessDepth } : undefined;
    untrack(() => onpreview(preview));
  });
  /** Publish the retained server result directly; never rerun a model search. */
  export async function receivePlacementSearch(value: PlacementShortlist, current: () => boolean): Promise<void> {
    if (!alive || !current() || invalidated) throw new Error('Placement context changed. Search again.');
    clear();
    const p = value.specification.parameters;
    settings = { ...settings, dimensions: [...p.dimensions], frontAccessDepth: p.frontAccessDepth, poleSeparation: p.poleSeparation,
      maxGroundSlopeDegrees: p.maxGroundSlopeDegrees, maxGroundRelief: p.maxGroundRelief, allowedYawDegrees: [...p.allowedYawDegrees] };
    result = value; selectedId = value.candidates[0]?.id; open = true;
    if (value.status !== 'complete') notice = `Search incomplete (${value.reason ?? 'resource limit'}). No usable sites retained.`;
    else if (!value.candidates.length) notice = 'No evaluated sites met these settings.';
    const ticket = generation;
    await tick();
    if (!alive || !current() || ticket !== generation) {
      if (alive && ticket === generation) clear();
      throw new Error('Placement context changed. Search again.');
    }
  }
  async function find() {
    if (blocked || busy) return;
    clear(); const ticket = generation, controller = new AbortController(); active = controller; busy = 'search';
    try {
      const value = await searchPlacementSites($state.snapshot(area), $state.snapshot(settings), controller.signal);
      if (!alive || ticket !== generation || blocked) return;
      if (value.status !== 'complete') throw new Error(`Search incomplete (${value.reason ?? 'resource limit'}). Use a smaller area or larger spacing and retry.`);
      result = value; selectedId = value.candidates[0]?.id;
      if (!value.candidates.length) notice = 'No evaluated sites met these settings. Adjust settings or select a different area.';
    } catch (cause) { if (alive && ticket === generation && !controller.signal.aborted) error = cause instanceof Error ? cause.message : 'Search failed. Retry.'; }
    finally { if (alive && ticket === generation) { busy = undefined; active = undefined; } }
  }
  async function propose() {
    if (blocked || busy || !result || !selected) return;
    const ticket = generation, controller = new AbortController(); active = controller; busy = 'propose'; error = '';
    try {
      await proposePlacementSite(result.searchId, selected.id, controller.signal);
      if (!alive || ticket !== generation) return;
      clear('Site sent to review. Accept or Decline the pending change.');
    } catch (cause) {
      if (alive && ticket === generation) error = `${cause instanceof Error ? cause.message : 'Proposal failed'}. Refresh CAD authority before retrying; no automatic retry.`;
    } finally {
      // A cancelled/lost response may still have retained a ghost. Always reconcile through existing authority.
      if (alive) await onproposed();
      if (alive && ticket === generation) { busy = undefined; active = undefined; }
    }
  }
  onDestroy(() => { alive = false; generation++; active?.abort(); onpreview(); });
</script>

<details class="placement" bind:open data-testid="placement-search">
  <summary>Find placement sites</summary>
  <div class="content">
    <p class="intro">Search the selected area · no AI inference</p>
    <details><summary>Settings · illustrative, not standards</summary>
      <p>Editable example values. Body and front access must fit inside the area. Zero observed conflicts required.</p>
      <fieldset disabled={!!busy || blocked} oninput={() => clear()} onchange={() => clear()}>
        <div class="fields">
          {#each ['Width', 'Depth', 'Height'] as axis, i}<label>{axis} (m)<input type="number" min="0.01" step="0.1" bind:value={settings.dimensions[i]} /></label>{/each}
          <label>Front access (m)<input type="number" min="0" step="0.1" bind:value={settings.frontAccessDepth} /></label>
          <label>Pole separation (m)<input type="number" min="0" step="0.1" bind:value={settings.poleSeparation} /></label>
          <label>Max slope (°)<input type="number" min="0" max="45" step="1" bind:value={settings.maxGroundSlopeDegrees} /></label>
          <label>Max relief (m)<input type="number" min="0" step="0.01" bind:value={settings.maxGroundRelief} /></label>
          <label>Search spacing (m)<input type="number" min="0.1" step="0.5" bind:value={settings.spacingMeters} /></label>
        </div>
        <div class="orientations" aria-label="Allowed front orientations">Front yaw:
          {#each [0, 90, 180, 270] as yaw}<label><input type="checkbox" bind:group={settings.allowedYawDegrees} value={yaw} />{yaw}°</label>{/each}
        </div>
      </fieldset>
      <p>0° faces +Y; 90° −X; 180° −Y; 270° +X. Pole separation is horizontal from the box boundary to observed Pole points. Slope is a fitted plane over five ground samples; relief is their height range.</p>
    </details>
    <div class="actions"><button data-testid="placement-find" disabled={blocked || !!busy} onclick={() => void find()}>{busy === 'search' ? 'Finding sites…' : 'Find sites'}</button>
      {#if busy === 'search'}<button onclick={() => clear('Search cancelled. Find sites to try again.')}>Cancel</button>{/if}
      {#if result}<button onclick={() => clear()}>Clear shortlist</button>{/if}
    </div>
    {#if blocked}<p role="status">Finish pending changes and wait for scene activity before searching.</p>{/if}
    {#if error}<p class="error" role="alert" bind:this={errorMessage}>{error}</p>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
    {#if result?.candidates.length}
      <p class="key">Cyan numbered boxes · search previews, not pending changes</p>
      <ol aria-label="Placement shortlist">
        {#each result.candidates as candidate}
          <li><button class:selected={selectedId === candidate.id} aria-pressed={selectedId === candidate.id} onclick={() => selectedId = candidate.id}>
            <strong>Site {candidate.rank}</strong><span>{candidate.groundSlopeDegrees.toFixed(1)}° slope · {candidate.groundRelief.toFixed(2)} m relief</span>
            <span>Pole: {candidate.poleSeparationMeters === null ? 'none observed' : `${candidate.poleSeparationMeters.toFixed(2)} m`} · {candidate.body.obstructionCount + (candidate.access?.obstructionCount ?? 0)} conflicts</span>
          </button></li>
        {/each}
      </ol>
      {#if selected}
        <div class="actions"><button onclick={() => onfocus(selected!.operation.center)}>Focus site {selected.rank}</button><button data-testid="placement-propose" disabled={blocked || !!busy} onclick={() => void propose()}>{busy === 'propose' ? 'Preparing review…' : 'Propose this site'}</button></div>
        <details><summary>Site {selected.rank} evidence</summary>
          <p>Center [{selected.operation.center.map(n => n.toFixed(3)).join(', ')}] m · yaw {selected.yawDegrees}° · Toronto local, Z-up</p>
          {#each [['Body', selected.body], ['Front access', selected.access]] as [name, volume]}
            {#if volume && typeof volume !== 'string'}<p>{name}: {volume.totalCount} observations · {volume.supportingGroundCount} support · {volume.obstructionCount} conflicts</p>
              <p>Counts: {volume.countsByLabel.map((count, label) => `${TORONTO_SEMANTIC_LABELS[label as keyof typeof TORONTO_SEMANTIC_LABELS] ?? 'Unknown'} ${count}`).join(' · ')}</p>
              {#each volume.points as point}<button class="witness" onclick={() => onfocus(point.position)}>Witness [{point.position.map(n => n.toFixed(2)).join(', ')}] · {TORONTO_SEMANTIC_LABELS[point.label as keyof typeof TORONTO_SEMANTIC_LABELS] ?? 'Unknown'} · file {point.source.sourceFileId}, row {point.source.sourceRow}</button>{/each}
              {#if volume.truncated}<p>Witnesses capped; counts cover the full queried volume.</p>{/if}
            {/if}
          {/each}
        </details>
      {/if}
    {/if}
    <details><summary>Search limits &amp; ranking</summary>
      <p>Best evaluated at the chosen spacing, not a global optimum. Sparse scan observations cannot certify clearance, foundations, safety or regulatory compliance. Edited scenes are unsupported.</p>
      {#if result}<p>{result.evaluated} evaluated / {result.generated} generated poses.</p>
        <p>Ranking: {result.specification.parameters.ranking.map(r => `${r.metric} (${r.direction})`).join(' → ')}. Spatially diverse top five, with deterministic coordinate/yaw tie-breaking.</p>
        <ul>{#each result.limitations as limitation}<li>{limitation}</li>{/each}</ul>
      {:else}<p>Ground slope, relief and pole separation determine the retained ranking; exact policy is available after search.</p>{/if}
    </details>
  </div>
</details>

<style>
  .placement { width: 100%; box-sizing: border-box; margin-bottom: 8px; border: 1px solid #ffffff20; border-radius: 12px; background: #202124f5; color: #f5f5f7; }
  .placement > summary { padding: 13px 14px; } summary { cursor: pointer; font-size: 12px; } .content { padding: 0 14px 12px; max-height: 55dvh; overflow: auto; overscroll-behavior: contain; }
  @media (max-width: 600px) { .content { max-height: 32dvh; } button { min-height: 44px; } }
  p, li { font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; color: #b9bac1; } .intro { margin-top: 0; } .key { color: #9dece4; } .error { color: #ffb2aa; }
  details details { margin: 10px 0; } fieldset { padding: 0; border: 0; margin: 0; } .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } label { font-size: 11px; color: #b9bac1; } .fields input { display: block; width: 100%; box-sizing: border-box; margin-top: 3px; }
  button, input { color: #f5f5f7; background: #2b2c30; border: 1px solid #ffffff24; border-radius: 8px; padding: 8px; font-size: 12px; } button { cursor: pointer; } button:disabled, fieldset:disabled { opacity: .45; } button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #5b9cff; outline-offset: 2px; }
  .actions, .orientations { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; align-items: center; } .orientations { font-size: 11px; } .orientations label { display: flex; align-items: center; gap: 3px; }
  ol { padding: 0; list-style: none; } ol button { width: 100%; text-align: left; margin-bottom: 5px; } ol button span { display: block; font-size: 11px; color: #b9bac1; margin-top: 3px; } ol button.selected { border-color: #50d6cc; background: #25413f; } .witness { width: 100%; text-align: left; font-size: 10px; margin: 3px 0; }
</style>
