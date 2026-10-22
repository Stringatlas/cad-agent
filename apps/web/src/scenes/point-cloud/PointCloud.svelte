<script lang="ts">
  import type { ElevationInfo, ElevationQuery } from '@spatial/contracts';
  import { loadElevationInfo, loadElevationGrid, queryElevation } from './elevation-client';
  import { elevationColor } from '../../viewer/elevation-surface';
  import type { AdaptiveStats } from '../../viewer/adaptive-plan';
  import { onMount, untrack } from 'svelte';
  import type { VisualModelSource } from '../../chat/visual/visual-model-source';
  import { instanceColor, semanticColor, UNASSIGNED_COLOR, type CloudColorMode } from '../../viewer/cloud-colors';
  import { createPreparedCloudViewer } from './prepared-cloud-viewer';
  import { loadPreparedScenes, loadPreparedSample, type PreparedSample, type PreparedPoint } from './prepared-cloud-client';
  let { onscene = () => {}, onpoint = () => {}, onvisualsource = () => {}, selection }: {
    onscene?: (sample: PreparedSample | undefined) => void;
    onpoint?: (point: PreparedPoint | undefined) => void;
    onvisualsource?: (source: VisualModelSource | undefined) => void;
    selection?: PreparedPoint;
  } = $props();
  let host: HTMLDivElement;
  let scenes = $state<{ id: string; name: string }[]>([]), sceneId = $state('stpls3d-1');
  let quality = $state('fine'), colorMode = $state<CloudColorMode>('rgb');
  let sample = $state<PreparedSample>(), selected = $state<PreparedPoint>();
  let loading = $state(true), error = $state('');
  let detail = $state<AdaptiveStats>();
  let elevationInfo = $state<ElevationInfo>(), elevationResult = $state<ElevationQuery>();
  let surfaceLayer = $state<'points' | 'dtm' | 'dsm'>('points'), surfaceLoading = $state(false), surfaceError = $state(''), surfaceNonce = $state(0);
  let queryController: AbortController | undefined;
  let controller: AbortController | undefined, disposed = false;
  let viewer = $state<ReturnType<typeof createPreparedCloudViewer>>();
  const classes = $derived(Object.entries(sample?.cloud.descriptor.semantics?.classes ?? {}));
  const unassigned = $derived(sample?.cloud.descriptor.instances?.unassigned ?? -100);
  async function load() {
    controller?.abort(); controller = new AbortController();
    const current = controller, id = sceneId;
    elevationInfo = undefined; elevationResult = undefined; surfaceLayer = 'points'; surfaceError = ''; queryController?.abort(); detail = undefined; sample = undefined; selected = undefined; error = ''; loading = true;
    onscene(undefined); onpoint(undefined); onvisualsource(undefined);
    try {
      const budget = quality === 'light' ? 20000 : quality === 'balanced' ? 60000 : 100000;
      const result = await loadPreparedSample(id, budget, quality === 'light' ? 0 : 1, current.signal);
      if (disposed || current !== controller || current.signal.aborted) return;
      if (colorMode === 'instance' && !result.instances || colorMode === 'semantic' && !result.labels) colorMode = 'rgb';
      sample = result; onscene(result);
      try {
        const model = await loadElevationInfo(result.cloud, current.signal);
        if (!disposed && current === controller && !current.signal.aborted) elevationInfo = model;
      } catch { if (!disposed && current === controller && !current.signal.aborted) surfaceError = 'Elevation model unavailable.'; }
    } catch (cause) {
      if (disposed || current !== controller || current.signal.aborted) return;
      error = cause instanceof Error ? cause.message : 'Scene unavailable. Retry loading.';
    } finally { if (!disposed && current === controller) loading = false; }
  }
  onMount(() => {
    const inventory = new AbortController();
    void (async () => {
      try {
        scenes = await loadPreparedScenes(inventory.signal);
        if (disposed) return;
        if (!scenes.some(s => s.id === sceneId)) sceneId = scenes[0]?.id ?? '';
        if (!sceneId) throw new Error('No prepared scenes registered.');
        await load();
      } catch { if (!disposed && !inventory.signal.aborted) { loading = false; error = 'Scene inventory unavailable. Reload workspace.'; } }
    })();
    return () => { disposed = true; inventory.abort(); controller?.abort(); queryController?.abort(); onvisualsource(undefined); };
  });
  $effect(() => {
    const current = sample;
    if (!current || !host) return;
    try {
      const instance = createPreparedCloudViewer(host, current, {
        pointBudget: quality === 'light' ? 500000 : quality === 'balanced' ? 1500000 : 3000000,
        ondetail: stats => detail = stats,
        onelevationpick: (x, y) => void inspectElevation(x, y),
        onpick: point => { selected = point; onpoint(point); }, onerror: message => error = message,
      });
      viewer = instance; onvisualsource(instance.visual);
      untrack(() => instance.setColorMode(colorMode));
      return () => { instance.dispose(); if (viewer === instance) viewer = undefined; onvisualsource(undefined); };
    } catch { error = '3D display unavailable. Check WebGL and retry.'; }
  });
  async function inspectElevation(x: number, y: number) {
    if (!sample || !elevationInfo) return;
    queryController?.abort(); const abort = new AbortController(); queryController = abort;
    const current = sample, model = elevationInfo;
    try {
      const result = await queryElevation(current.cloud, model, x, y, abort.signal);
      if (!disposed && !abort.signal.aborted && sample === current) elevationResult = result;
    } catch { if (!disposed && !abort.signal.aborted && sample === current) surfaceError = 'Elevation inspection unavailable. Select a cell again.'; }
  }
  $effect(() => {
    const current = sample, model = elevationInfo, instance = viewer, layer = surfaceLayer, nonce = surfaceNonce;
    void nonce;
    elevationResult = undefined; surfaceError = ''; surfaceLoading = false;
    if (!instance) return;
    if (layer === 'points') { instance.setElevation(); return; }
    if (!current || !model) return;
    const abort = new AbortController(); surfaceLoading = true;
    void (async () => {
      try {
        const grid = await loadElevationGrid(current.cloud, model, layer, abort.signal);
        if (!disposed && !abort.signal.aborted) instance.setElevation(grid);
      } catch { if (!disposed && !abort.signal.aborted) surfaceError = 'Elevation layer unavailable.'; }
      finally { if (!disposed && !abort.signal.aborted) surfaceLoading = false; }
    })();
    return () => abort.abort();
  });
  $effect(() => { viewer?.setColorMode(colorMode); });
  $effect(() => { selected = selection; viewer?.setSelection(selection); });
</script>

<section class="cloud" aria-label="STPLS3D workspace" data-testid="point-cloud-workspace">
  <div class="scene-controls">
    <select aria-label="STPLS3D scene" bind:value={sceneId} onchange={load} disabled={!scenes.length}>
      {#each scenes as scene}<option value={scene.id}>{scene.name}</option>{/each}
    </select>
    <div class="color-modes" role="group" aria-label="Point colors">
      {#each [{ id: 'rgb', label: 'RGB' }, { id: 'instance', label: 'Instance' }, { id: 'semantic', label: 'Semantic' }] as mode}
        <button aria-pressed={colorMode === mode.id} disabled={surfaceLayer !== 'points' || !sample || (mode.id === 'instance' && !sample.instances) || (mode.id === 'semantic' && !sample.labels)} onclick={() => colorMode = mode.id as CloudColorMode}>{mode.label}</button>
      {/each}
    </div>
    {#if elevationInfo}<select aria-label="Surface layer" bind:value={surfaceLayer}>
      <option value="points">Points</option><option value="dtm">DTM · Ground</option><option value="dsm">DSM · Surface</option>
    </select>{/if}
    <button class="fit" onclick={() => viewer?.fit()} disabled={!sample || !!error}>Fit</button>
    <details class="quality"><summary>Display</summary><div class="quality-options">
      <label>Detail <select aria-label="Display quality" bind:value={quality} onchange={load} disabled={!scenes.length}>
        <option value="light">Light</option><option value="balanced">Balanced</option><option value="fine">Fine</option>
      </select></label>{#if detail}<p>{detail.loadedPoints.toLocaleString()} points loaded{detail.pending ? ' · Refining…' : ''}</p>{/if}
    </div></details>
  </div>
  <div class="viewport" bind:this={host}></div>
  {#if loading}<div class="notice" role="status">Loading scene…</div>{/if}
  {#if error}<div class="notice error" role="alert">{error} <button onclick={load} disabled={!scenes.length}>Retry</button></div>{/if}
  {#if detail?.error && !error}<div class="notice error" role="alert">Detail unavailable. <button onclick={() => viewer?.retryDetail()}>Retry detail</button></div>{/if}
  {#if surfaceLoading}<div class="notice" role="status">Loading elevation…</div>{/if}
  {#if surfaceError}<div class="notice error" role="alert">{surfaceError} <button onclick={() => elevationInfo ? surfaceNonce++ : load()}>Retry layer</button></div>{/if}
  <div class="inspection">
    {#if surfaceLayer !== 'points' && elevationInfo}
      {@const range = elevationInfo.layers[surfaceLayer]}
      <div class="selection" aria-label="Elevation color key"><strong>{surfaceLayer === 'dtm' ? 'Ground elevation' : 'Surface elevation'} · m</strong>
        <div class="elevation-ramp" style:background={`linear-gradient(to right, ${elevationColor(range.min ?? 0, range.min ?? 0, range.max ?? 0).getStyle()}, ${elevationColor(((range.min ?? 0) + (range.max ?? 0)) / 2, range.min ?? 0, range.max ?? 0).getStyle()}, ${elevationColor(range.max ?? 0, range.min ?? 0, range.max ?? 0).getStyle()})`}></div>
        <div class="elevation-range"><span>{range.min?.toFixed(1) ?? 'No data'}</span><span>{range.max?.toFixed(1) ?? 'No data'}</span></div>
        <details><summary>Details</summary><p>{elevationInfo.grid.resolution} m source cells · No interpolation</p><p>{surfaceLayer === 'dtm' ? 'Mean classified ground elevation' : 'Maximum observed surface elevation'}</p><p>Gaps have no supporting observations.</p></details>
      </div>
      {#if elevationResult}<div class="selection" aria-live="polite"><strong>Elevation cell</strong>
        <div>Ground: {elevationResult.dtm === null ? 'No data' : `${elevationResult.dtm.toFixed(3)} m`}</div>
        <div>Surface: {elevationResult.dsm === null ? 'No data' : `${elevationResult.dsm.toFixed(3)} m`}</div>
        <div>Above ground: {elevationResult.heightAboveGround === null ? 'No data' : `${elevationResult.heightAboveGround.toFixed(3)} m`}</div>
        <details><summary>Details</summary><p>XY {elevationResult.position.map(n => n.toFixed(3)).join(', ')} m</p><p>{elevationResult.support.groundPoints} ground / {elevationResult.support.surfacePoints} surface points</p><p>{elevationResult.frameId}</p></details>
      </div>{/if}
    {/if}
    {#if selected && surfaceLayer === 'points'}
      <div class="selection" aria-live="polite"><strong>Point · {selected.type}</strong>
        {#if selected.instanceId !== undefined}<span class="instance"><span class="swatch" style:background={instanceColor(selected.instanceId, unassigned)}></span>{selected.instanceId === unassigned ? 'Unassigned instance' : `Instance ${selected.instanceId}`}</span>{/if}
        <details><summary>Details</summary><dl><dt>Local position (m)</dt><dd>{selected.position.map(n => n.toFixed(3)).join(', ')}</dd>
          <dt>Frame</dt><dd>{selected.frameId}</dd><dt>Source / row</dt><dd>{selected.sourceId} / {selected.sourceRow}</dd></dl></details>
      </div>
    {/if}
    {#if surfaceLayer === 'points' && colorMode === 'semantic' && classes.length}
      <details class="key"><summary>Semantic classes</summary><ul aria-label="Semantic classes">
        {#each classes as [id, name]}<li><span class="swatch" style:background={semanticColor(Number(id))}></span>{name}</li>{/each}
      </ul></details>
    {:else if surfaceLayer === 'points' && colorMode === 'instance'}
      <details class="key"><summary>Instances</summary><div class="instance-key"><p>Each color identifies an instance. Select a point to inspect its ID and class.</p><span class="instance"><span class="swatch" style:background={UNASSIGNED_COLOR}></span>Unassigned ({unassigned})</span></div></details>
    {/if}
  </div>
</section>
<style>
  .elevation-ramp { height:8px; margin:8px 0 3px; border-radius:4px; }
  .elevation-range { display:flex; justify-content:space-between; gap:30px; font-size:12px; }
  .cloud { height:100%; min-height:0; display:flex; flex-direction:column; position:relative; }
  .scene-controls { display:flex; gap:8px; align-items:center; padding:10px 12px; border-bottom:1px solid #ffffff12; z-index:3; flex-wrap:wrap; }
  select,button,summary { color:#eeeef2; font:inherit; }
  select,button { border:1px solid #ffffff20; border-radius:7px; padding:7px 10px; background:#25262b; }
  button { cursor:pointer; } button:disabled { opacity:.4; }
  .scene-controls > select { min-width:0; max-width:240px; }
  .color-modes { display:flex; gap:2px; padding:3px; border:1px solid #ffffff16; border-radius:9px; }
  .color-modes button { border:0; background:transparent; padding:5px 10px; }
  .color-modes button[aria-pressed=true] { background:#525967; color:#fff; }
  summary { cursor:pointer; padding:8px; }
  .quality { position:relative; margin-left:auto; }
  .quality-options { position:absolute; top:100%; right:0; width:210px; padding:12px; border:1px solid #ffffff20; border-radius:10px; background:#25262b; }
  .quality-options label { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .quality-options p { color:#b6b7c0; font-size:11px; margin:10px 0 0; }
  .viewport { flex:1; min-height:0; }
  .notice { position:absolute; left:50%; top:40%; transform:translateX(-50%); padding:12px; border-radius:10px; background:#25262bf5; max-width:calc(100% - 24px); }
  .error { border:1px solid #d7a07b; }
  .inspection { position:absolute; left:12px; bottom:12px; max-width:min(340px,calc(100% - 24px)); display:flex; flex-direction:column; gap:6px; max-height:calc(100% - 120px); overflow-y:auto; }
  .selection,.key { border:1px solid #ffffff20; border-radius:10px; background:#202124f0; }
  .selection { padding:10px 12px; } .selection strong { display:block; }
  .selection summary { padding:5px 0; color:#b6b7c0; }
  .instance { display:flex; gap:6px; align-items:center; color:#c0c5cd; font-size:12px; margin-top:4px; }
  .instance-key { padding:0 12px 12px; font-size:12px; } .instance-key p { margin-top:0; }
  dl { margin:4px 0; font-size:11px; overflow-wrap:anywhere; } dt { color:#b6b7c0; } dd { margin:0 0 5px; }
  ul { list-style:none; margin:0; padding:0 12px 10px; display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; font-size:11px; }
  li { display:flex; align-items:center; gap:6px; } .swatch { width:9px; height:9px; border-radius:2px; flex-shrink:0; }
  @media(max-width:640px) { .scene-controls { padding:8px; gap:5px; } .scene-controls > select { flex:1; width:150px; max-width:none; } .color-modes { order:4; width:100%; } .color-modes button { flex:1; min-height:36px; } .quality { margin-left:0; } button,select { padding:7px; } }
</style>
