<script lang="ts">
  import type { BoxEdit, Vec3 } from '@spatial/contracts';
  import type { ProjectController, ProjectView } from './project-client';
  let { view, controller }: { view: ProjectView; controller: ProjectController } = $props();
  let kind = $state<BoxEdit['kind']>('update-box');
  let entityId = $state('proposal-box');
  let center = $state('0, 0, 0.75');
  let dimensions = $state('1.8, 1.2, 1.5');
  let inputError = $state('');
  function change() { inputError = ''; controller.clearProposal(); }
  function vector(text: string): Vec3 {
    const parts = text.split(',').map(s => s.trim());
    if (parts.length !== 3 || parts.some(s => !s || !Number.isFinite(Number(s)))) throw new Error('Use three finite comma-separated numbers.');
    return parts.map(Number) as unknown as Vec3;
  }
  function preview() {
    inputError = '';
    try { void controller.propose({ kind, entityId, center: vector(center), dimensions: vector(dimensions) }); }
    catch (cause) { controller.clearProposal(); inputError = String(cause); }
  }
</script>

<section aria-label="Approved box parameter edits" data-testid="box-controls">
  <h3>Box parameter proposal</h3>
  <p>Deterministic controls · meters · {view.snapshot?.frameId}. Parameter postconditions only, <strong>not CAD solids</strong>.</p>
  <form onsubmit={event => { event.preventDefault(); preview(); }}>
    <fieldset disabled={!!view.pending || view.needsRefresh}>
      <label for="box-kind">Operation</label><select id="box-kind" bind:value={kind} onchange={change}><option value="update-box">Update existing box</option><option value="create-box">Create new box</option></select>
      <label for="box-id">Exact entity ID</label><input id="box-id" data-testid="box-id" bind:value={entityId} oninput={change} maxlength="64" />
      <label for="box-center">Local center X, Y, Z (m)</label><input id="box-center" data-testid="box-center" bind:value={center} oninput={change} maxlength="120" />
      <label for="box-dimensions">Dimensions X, Y, Z (m)</label><input id="box-dimensions" data-testid="box-dimensions" bind:value={dimensions} oninput={change} maxlength="120" />
      <button type="submit" data-testid="box-preview">Preview exact proposal</button>
    </fieldset>
  </form>
  {#if inputError}<p role="alert">{inputError}</p>{/if}
  {#if view.proposal}
    <div data-testid="box-proposal">
      <strong>Non-authoritative wireframe preview — no commit</strong>
      <p>Exact immutable proposal {view.proposal.proposalId}<br />Digest <code data-testid="proposal-digest">{view.proposal.digest}</code><br />Expires {new Date(view.proposal.expiresAt).toISOString()}</p>
      <pre data-testid="proposal-parameters">{JSON.stringify({ binding: { sessionId: view.proposal.sessionId, projectRevision: view.proposal.projectRevision, frameId: view.proposal.frameId, units: view.proposal.units }, edit: view.proposal.edit, before: view.proposal.before, after: view.proposal.after, coordinates: view.proposal.coordinates }, null, 2)}</pre>
      <button data-testid="box-approve" disabled={!!view.pending || view.needsRefresh} onclick={() => void controller.approve()}>Approve exact proposal</button>
      <button onclick={() => controller.clearProposal()} disabled={!!view.pending}>Cancel preview</button>
    </div>
  {/if}
  <p>Next undo transaction: <code>{view.session?.nextUndoTransactionId ?? 'none'}</code></p>
  {#if view.session?.nextUndoTransactionId && !view.undoAvailable}<p>Undo receipt not held by this page. Undo is blocked rather than accepting an unverifiable inverse; retained server transaction is shown above.</p>{/if}
  <button data-testid="project-undo" disabled={!view.undoAvailable || !!view.pending || view.needsRefresh} onclick={() => { if (confirm('Undo the latest retained transaction? This is a new geometry revision, not a revision rollback.')) void controller.undo(); }}>Undo latest edit</button>
  <button data-testid="project-cancel" disabled={!view.pending} onclick={() => controller.cancel()}>Cancel project request</button>
</section>

<style>
  section { border-top: 1px solid #344660; margin-top: 16px; padding-top: 14px; }
  p { color: #a1b3ca; font-size: 12px; } fieldset { margin: 0; border: 0; padding: 0; }
  label { display: block; font-size: 12px; margin-top: 10px; } input, select { width: 100%; background: #0b1220; color: #e4ecf7; border: 1px solid #52657e; padding: 8px; }
  button { margin: 10px 8px 0 0; background: #1c2a40; color: #e4ecf7; border: 1px solid #52657e; border-radius: 7px; padding: 8px; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; } pre { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; } code { overflow-wrap: anywhere; }
</style>
