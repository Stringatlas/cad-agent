import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const source = (file: string) => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));

async function renderReview(items: unknown[]) {
  const { compile } = webRequire('svelte/compiler');
  const compiled = compile(source('ApprovalReview.svelte'), { filename: 'ApprovalReview.svelte', generate: 'server' });
  const code = compiled.js.code.replace(/from ['"](svelte[^'"]*)['"]/g, (_: string, name: string) => `from ${JSON.stringify(new URL(`file://${webRequire.resolve(name)}`).href)}`);
  const component = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const { render } = await import(new URL(`file://${webRequire.resolve('svelte/server')}`).href);
  return render(component.default, { props: { items } }).body as string;
}
const candidate = (id: string, title = id, disabled = false) => ({ id, title, summary: 'Size 1 × 2 × 3 m', details: '<exact retained candidate>', disabled, onaccept() {}, ondecline() {}, testId: 'fixture-proposal', acceptTestId: 'fixture-accept', declineTestId: 'fixture-decline' });

test('approval card is absent when idle and renders only one candidate with counter and explicit actions', async () => {
  assert.doesNotMatch(await renderReview([]), /data-testid="approval-review"/);
  const html = await renderReview([candidate('one', 'Create box'), candidate('two', 'Move point'), candidate('three', 'Create cylinder')]);
  assert.match(html, /1\/3/); assert.match(html, /Create box/);
  assert.doesNotMatch(html, /Move point|Create cylinder/);
  assert.match(html, />Accept<\/button>/); assert.match(html, />Decline<\/button>/);
  assert.match(html, /&lt;exact retained candidate(?:&gt;|>)/);
  assert.doesNotMatch(html, /<exact retained candidate>/);
  assert.match(html, /<details[^>]*><summary[^>]*>Details<\/summary>/);
  assert.match(html, /aria-label="Previous change"[^>]*disabled/);
  assert.doesNotMatch(html, /aria-label="Next change"[^>]*disabled/);
  assert.equal((html.match(/data-testid="fixture-proposal"/g) ?? []).length, 1);
});

test('approval card respects authority busy/stale disabled state for both actions', async () => {
  const html = await renderReview([candidate('one', 'Create box', true)]);
  assert.match(html, /data-testid="fixture-accept"[^>]*disabled/);
  assert.match(html, /data-testid="fixture-decline"[^>]*disabled/);
});

test('actual navigation handler chooses adjacent candidate and retains current candidate at bounds', () => {
  const script = source('ApprovalReview.svelte');
  const handler = script.match(/function navigate\(offset: number\) \{[^\n]+\}/)![0];
  const js = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });
  const navigate = new Function('items', 'index', 'item', 'offset', `let selectedId; ${js}; navigate(offset); return selectedId;`);
  const items = [candidate('point'), candidate('cad'), candidate('other')];
  assert.equal(navigate(items, 0, items[0], 1), 'cad');
  assert.equal(navigate(items, 1, items[1], -1), 'point');
  assert.equal(navigate(items, 2, items[2], 1), 'other');
  assert.equal(navigate(items, 0, items[0], -1), 'point');
});

test('awaited Toronto refresh waits in-flight approval and flushes all three refreshed authorities', async () => {
  const toronto = source('Toronto.svelte');
  const handler = toronto.slice(toronto.indexOf('  export async function refreshAgentAuthorities'), toronto.indexOf('  $effect(() => { const token = cadRefresh'));
  const js = ts.transpile(handler.replace('export ', ''), { target: ts.ScriptTarget.ES2022 });
  const view = { busy: true, needsRefresh: false, status: 'Ready' }, calls: string[] = [];
  const refresh = new Function('tick', 'cadView', 'alive', 'cadArtifact', 'pointEditor', 'cadController', 'objectView', 'objectController', `${js}; return refreshAgentAuthorities;`)(
    async () => { calls.push('tick'); }, view, true, 'artifact',
    { async refreshAuthority() { calls.push('points'); await new Promise(resolve => setTimeout(resolve, 5)); calls.push('points-done'); } },
    { async refresh() { assert.equal(view.busy, false); calls.push('cad'); } },
    { busy: false, needsRefresh: false }, { async refresh() { calls.push('objects'); } },
  );
  setTimeout(() => { view.busy = false; calls.push('approval-done'); }, 5);
  await refresh();
  assert.ok(calls.indexOf('approval-done') < calls.indexOf('cad'));
  assert.ok(calls.includes('objects')); assert.ok(calls.includes('points-done')); assert.equal(calls.at(-1), 'tick');
  view.needsRefresh = true; view.status = 'Explicit recovery required';
  await assert.rejects(refresh(), /Explicit recovery required/);
});

test('Toronto combines point and CAD review outside tools and leaves approval independent of model streaming', () => {
  const toronto = source('Toronto.svelte'), points = source('PointEdits.svelte'), cad = source('TorontoCad.svelte');
  assert.equal((toronto.match(/<ApprovalReview /g) ?? []).length, 1);
  assert.ok(toronto.includes('$derived([...pointReviewItems, ...cadReviewItems, ...objectReviewItems])'));
  const toolsAside = toronto.search(/<aside(?:\s|>)/);
  assert.ok(toolsAside >= 0, 'Scene tools aside remains present');
  assert.ok(toronto.indexOf('<ApprovalReview ') < toolsAside);
  assert.doesNotMatch(cad, /toronto-cad-accept|toronto-cad-decline/);
  assert.match(toronto, /disabled: cadView\.busy \|\| cadView\.needsRefresh,/);
  assert.match(points, /disabled: view\.busy \|\| view\.needsRefresh,/);
  assert.match(points, /selectProposal\(proposal\.proposalId\); return controller\.approve\(\)/);
  assert.match(points, /selectProposal\(proposal\.proposalId\); return controller\.decline\(\)/);
  assert.match(cad, /const blocked = \$derived\(view\.busy \|\| view\.needsRefresh \|\| streaming\)/);
  assert.match(points, /data-testid="point-edit-undo" disabled=\{view\.busy \|\| view\.needsRefresh \|\| streaming/);
  assert.match(points, /data-testid="point-edit-refresh" disabled=\{view\.busy\}/);
  assert.match(cad, /data-testid="toronto-cad-refresh" disabled=\{view\.busy\}/);
  assert.match(toronto, /export async function refreshAgentAuthorities\(\): Promise<void>/);
  assert.match(toronto, /await Promise\.all\(\[cadController\.refresh\(\), pointEditor\.refreshAuthority\(\), objectController\.refresh\(\)\]\)/);
  assert.match(points, /await controller\.refresh\(\); await tick\(\)/);
});
