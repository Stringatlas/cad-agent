import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const source = (name: string) => readFileSync(new URL(`../apps/web/src/${name}`, import.meta.url), 'utf8');

test('datum hierarchy compiles accessibly and remains a collapsed scene overlay', () => {
  const { compile } = web('svelte/compiler');
  const compiled = compile(source('SceneObjects.svelte'), { filename: 'SceneObjects.svelte', generate: 'client' });
  assert.deepEqual(compiled.warnings, []);
  const ui = source('SceneObjects.svelte');
  for (const section of ['Sources', 'Design', 'Pending changes']) assert.ok(ui.includes(section));
  assert.match(ui, /open = \$state\(false\)/);
  assert.match(ui, /aria-expanded=\{open\}/);
  assert.match(ui, /aria-pressed=\{selectedId === object.id\}/);
  assert.doesNotMatch(ui, /Derived layers are not listed here yet|No derived layers loaded|<summary>Derived observations/);
  assert.equal((ui.match(/data-testid="selected-datum"/g) ?? []).length, 1);
  assert.ok(ui.indexOf('data-testid="selected-datum"') < ui.indexOf('{#if open}'), 'selection actions do not require opening the hierarchy');
  assert.match(ui, /onfocus\(selected!\.position\)/);
  assert.match(ui, /onselect\(undefined\)/);
  assert.match(ui, /onpending\(proposal.proposalId\)/);
  assert.doesNotMatch(ui, /controller\.(approve|decline)\(/);
  assert.match(ui, /left: 16px; top: 70px/);
  assert.match(ui, /max-height: 35dvh/);
});

test('actual manual point preview handler sends coordinates or typed reference plus offset without publishing', async () => {
  const ui = source('SceneObjects.svelte');
  const handler = ui.slice(ui.indexOf('  async function preview('), ui.indexOf('  function navigate('));
  const js = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });
  const run = new Function('blocked', 'values', 'name', 'referenceMode', 'reference', 'controller', `const view = {}; ${js}; return (async () => { let prevented = false; await preview({preventDefault() {prevented = true;}}); return prevented; })();`);
  const calls: unknown[] = [], controller = { propose: (...args: unknown[]) => calls.push(args) };
  assert.equal(await run(false, [1, 2, 3], ' Point A ', false, undefined, controller), true);
  assert.deepEqual(calls.pop(), ['Point A', { kind: 'position', position: [1, 2, 3] }]);
  const reference = { kind: 'authored-object', sessionId: 'objects', revision: 2, objectId: 'datum', objectRevision: 1, frameId: 'toronto3d-local-v1', units: 'm' };
  await run(false, [0, 1, 0], 'Point B', true, reference, controller);
  assert.deepEqual(calls.pop(), ['Point B', { kind: 'reference', reference, offset: [0, 1, 0] }]);
  await run(true, [1, 2, 3], 'Point A', false, undefined, controller);
  await run(false, [NaN, 2, 3], 'Point A', false, undefined, controller);
  await run(false, [1, 2, Infinity], 'Point A', false, undefined, controller);
  await run(false, [1, 2, 3], ' ', false, undefined, controller);
  await run(false, [1, 2, 3], 'Point A', true, undefined, controller);
  assert.deepEqual(calls, []);
});

test('datum source references use the checked effective domain and remain separate from source pins in chat', () => {
  const ui = source('SceneObjects.svelte'), app = source('App.svelte'), toronto = source('Toronto.svelte'), chat = source('Chat.svelte');
  assert.match(ui, /kind: 'source-record'/); assert.match(ui, /domain: 'effective'/);
  assert.match(ui, /overrideSessionId: overrides.sessionId, overrideRevision: overrides.revision/);
  assert.match(ui, /authoredReference\(view.snapshot, selected\)/);
  assert.match(app, /authoredReference\(objectSnapshot, selectedObject\)/);
  assert.match(chat, /Datum point/); assert.match(chat, /areaInput\?\.area, objectReferences/);
  assert.match(toronto, /testId: 'scene-object-proposal'/);
  assert.match(toronto, /disabled: objectView.busy \|\| objectView.needsRefresh,/);
  assert.match(toronto, /onaccept: \(\) => objectController.approve\(proposal.proposalId\)/);
  assert.match(toronto, /ondecline: \(\) => objectController.decline\(proposal.proposalId\)/);
  assert.match(toronto, /viewer\?\.setObjects\(/);
  assert.match(toronto, /selectedObjectId, hiddenObjectIds\)/);
  assert.match(toronto, /if \(!visible && selectedObjectId === id\) selectObject\(\)/);
  assert.match(ui, /disabled=\{hiddenIds.includes\(object.id\)\}/);
  assert.match(ui, /onvisibility\(object.id, hiddenIds.includes\(object.id\)\)/);
  assert.match(ui, /aria-pressed=\{!hiddenIds.includes\(object.id\)\}/);
});
