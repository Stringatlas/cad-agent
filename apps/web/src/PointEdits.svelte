<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { TORONTO_SEMANTIC_LABELS, type NearestPoleRequest, type PointMoveProposal, type PointOverrideSnapshot, type TorontoSemanticLabel, type Vec3 } from '@spatial/contracts';
  import type { TorontoDraftPoint } from './draft-context';
  import { fetchClosestPole } from './pole-client';
  import { PointOverrideController, effectivePosition, verifiedNearestSelection, type PointEditView } from './point-override-client';
  let { points, artifactRevision, onselect, onstate }: { points: readonly TorontoDraftPoint[]; artifactRevision?: string; onselect: (point: Omit<TorontoDraftPoint, 'name'>) => void; onstate: (snapshot?: PointOverrideSnapshot, proposal?: PointMoveProposal) => void } = $props();
  let view = $state<PointEditView>({ busy: false, needsRefresh: true, status: 'Loading volatile point authority…' });
  const controller = new PointOverrideController(value => { view = value; onstate(value.snapshot, value.proposal); });
  let selected = $state<string[]>([]), translation = $state<number[]>([0, 0, 1]);
  let activeName = $state(''), label = $state<TorontoSemanticLabel>(6), queryBusy = $state(false), queryStatus = $state('');
  let winner = $state<Omit<TorontoDraftPoint, 'name'>>();
  let queryGeneration = 0, queryAbort: AbortController | undefined, alive = true;
  function clearQuery() { queryGeneration++; queryAbort?.abort(); queryAbort = undefined; queryBusy = false; winner = undefined; queryStatus = ''; }
  $effect(() => {
    const references = points, revision = artifactRevision;
    JSON.stringify(references);
    untrack(() => {
      const names: readonly string[] = references.map(p => p.name); controller.bind(references, revision); clearQuery();
      selected = selected.filter(name => names.includes(name));
      if (!names.includes(activeName)) activeName = names[0] ?? '';
    });
  });
  async function query() {
    clearQuery(); const source = points.find(p => p.name === activeName); if (!source || queryBusy) return;
    const ticket = ++queryGeneration, captured = JSON.stringify(points), current = new AbortController(); queryAbort = current; queryBusy = true;
    const request: NearestPoleRequest = { requestId: crypto.randomUUID(), datasetId: 'toronto3d', expectedArtifactRevision: source.artifactRevision, units: 'm', frameId: 'toronto3d-local-v1', input: { kind: 'point-ref', key: { ...source.key } }, filter: { schema: 'toronto3d-scalar-label-v1', attribute: 'scalar_Label', value: label }, metric: 'euclidean-3d', domain: { kind: 'whole-dataset' } };
    try {
      const outcome = await fetchClosestPole(request, current.signal, progress => { if (alive && ticket === queryGeneration) queryStatus = `${progress.phase} · ${progress.scannedPoints} points`; });
      if (!alive || ticket !== queryGeneration || captured !== JSON.stringify(points)) return;
      if (outcome.status !== 'verified-found') { queryStatus = `No selectable winner: ${outcome.status}`; return; }
      const result = await verifiedNearestSelection({ searchGeometry: 'original-prepared-dataset', pointName: source.name, request, outcome }, points);
      if (!alive || ticket !== queryGeneration || captured !== JSON.stringify(points)) return;
      winner = result.point; queryStatus = `Verified ${TORONTO_SEMANTIC_LABELS[label]} · ${outcome.nearest?.distanceMeters} m from original source position.`;
    } catch (error) { if (alive && ticket === queryGeneration) queryStatus = String(error); }
    finally { if (alive && ticket === queryGeneration) queryBusy = false; }
  }
  function choose(name: string, checked: boolean) { controller.cancel(); selected = checked ? [...selected, name] : selected.filter(n => n !== name); }
  function position(point: TorontoDraftPoint) { try { return effectivePosition(point, view.snapshot).join(', '); } catch { return 'Source mismatch — refresh and reselect'; } }
  onMount(() => { controller.bind(points, artifactRevision); void controller.refresh(); return () => { alive = false; clearQuery(); controller.dispose(); onstate(undefined, undefined); }; });
</script>

<section class="point-edits" data-testid="point-edits" aria-label="Toronto point edits">
  <h3>Toronto point edits</h3>
  <p>Session-scoped volatile overrides · meters · Toronto local Z-up. Server restart resets edits. Prepared files are never changed. No CAD or synthetic-project mapping.</p>
  <p data-testid="point-edit-status" role="status">{view.status}</p>
  <button data-testid="point-edit-refresh" disabled={view.busy} onclick={() => { clearQuery(); void controller.refresh(); }}>Refresh point authority</button>
  {#if view.needsRefresh}<p role="alert">Editing blocked until explicit Refresh succeeds. No automatic retry.</p>{/if}
  {#if view.snapshot}<p>Session {view.snapshot.sessionId} · revision {view.snapshot.revision} · {view.snapshot.entries.length} overridden points</p>{/if}
  <h4>1. Find nearest label (original dataset)</h4>
  <p>Whole-dataset indexed search uses original prepared coordinates, not approved edits. The result is only attached after you select it.</p>
  <label>Original query reference<select data-testid="point-query-reference" bind:value={activeName} onchange={() => { clearQuery(); controller.cancel(); }} disabled={queryBusy || view.busy}>{#each points as p (p.name)}<option value={p.name}>{p.name}</option>{/each}</select></label>
  <label>Nearest label<select data-testid="point-query-label" bind:value={label} onchange={() => { clearQuery(); controller.cancel(); }} disabled={queryBusy || view.busy}>{#each Object.entries(TORONTO_SEMANTIC_LABELS) as [value, name]}<option value={Number(value)}>{value} · {name}</option>{/each}</select></label>
  <button data-testid="point-query" disabled={!activeName || queryBusy || view.busy} onclick={() => void query()}>Find nearest label</button>
  {#if queryBusy}<button onclick={clearQuery}>Cancel query</button>{/if}
  <p data-testid="point-query-status" role="status">{queryStatus}</p>
  {#if winner}<p>Original winner [{winner.position.join(', ')}] m · file {winner.key.sourceFileId}, row {winner.key.sourceRow}</p><button data-testid="point-query-select" disabled={view.busy} onclick={() => { if (winner) onselect(winner); clearQuery(); }}>Add result selection</button>{/if}
  <h4>2. Translate selected references</h4>
  {#each points as point (point.name)}
    <label class="reference"><input type="checkbox" data-testid={`point-edit-select-${point.name}`} checked={selected.includes(point.name)} disabled={view.busy} onchange={event => choose(point.name, event.currentTarget.checked)} /> {point.name} · effective [{position(point)}] m</label>
  {/each}
  <div class="axes">{#each ['X', 'Y', 'Z'] as axis, i}<label>Δ{axis} (m)<input type="number" step="0.1" data-testid={`point-edit-d${axis.toLowerCase()}`} bind:value={translation[i]} disabled={view.busy} oninput={() => controller.cancel()} /></label>{/each}</div>
  <button data-testid="point-edit-preview" disabled={view.busy || view.needsRefresh || !selected.length || !translation.every(Number.isFinite) || translation.every(n => n === 0)} onclick={() => void controller.propose(selected, translation as unknown as Vec3)}>Preview exact translation</button>
  {#if view.proposal}
    <section data-testid="point-edit-review" aria-label="Exact point move review"><h4>3. Review retained server proposal</h4>
      <p>Proposal {view.proposal.proposalId} · revision {view.proposal.revision}. Orange ghosts are uncommitted.</p>
      {#each view.proposal.moves as move}<p>File {move.key.sourceFileId} · row {move.key.sourceRow}<br />Before [{move.before.join(', ')}] m<br />After [{move.after.join(', ')}] m</p>{/each}
      <button data-testid="point-edit-approve" disabled={view.busy || view.needsRefresh} onclick={() => void controller.approve()}>Approve exact point move</button>
      <button data-testid="point-edit-cancel" onclick={() => controller.cancel()}>Cancel preview</button>
    </section>
  {/if}
  <button data-testid="point-edit-undo" disabled={view.busy || view.needsRefresh || !view.snapshot?.nextUndoTransactionId} onclick={() => void controller.undo()}>Undo last point edit</button>
</section>
<style>
  .point-edits { border-top: 1px solid #344b61; margin-top: 20px; padding-top: 12px; }
  h3 { font-size: 15px; } h4 { font-size: 12px; color: #bdddd7; }
  p, label { font-size: 11px; overflow-wrap: anywhere; color: #9badc3; }
  label { display: block; margin: 8px 0; } .reference { display: flex; gap: 6px; align-items: start; }
  button, select, input { background: #1c2a40; color: #e4ecf7; border: 1px solid #3a4e66; border-radius: 5px; padding: 6px; font: inherit; }
  button { font-size: 11px; margin: 3px; cursor: pointer; } button:disabled { opacity: .4; }
  select { width: 100%; } .axes { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 5px; } .axes input { width: 100%; }
  [data-testid="point-edit-review"] { border: 1px solid #e9b765; padding: 8px; margin: 8px 0; }
  [role="alert"] { color: #ffd187; }
</style>
