import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const web = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { compile, parse } = web('svelte/compiler');
const source = (file: string) => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');

for (const file of ['App.svelte', 'Chat.svelte', 'ModelChat.svelte', 'Toronto.svelte', 'SceneObjects.svelte', 'SceneMarks.svelte', 'PointEdits.svelte', 'ProviderAccount.svelte']) {
  test(`${file} compiles without accessibility or other Svelte warnings`, () => {
    assert.deepEqual(compile(source(file), { filename: file, generate: 'client' }).warnings, []);
  });
}

test('area of interest is contextual hierarchy content, not a floating panel', () => {
  const ui = source('SceneObjects.svelte');
  const divs = elements('SceneObjects.svelte', 'div');
  const contents = divs.find(node => ui.slice(node.start, node.start + 22) === '<div class="contents">');
  const area = divs.find(node => ui.slice(node.start, node.start + 90).includes('data-testid="area-of-interest"'));
  assert.ok(contents && area && contents.start < area.start && area.end < contents.end);
  assert.match(ui, /\{#if areaInput\}/);
  assert.match(ui, /All heights\{areaInput.pending/);
  assert.match(ui, /aria-label="Clear area of interest" onclick=\{\(\) => areaInput\?\.clear\(\)\}/);
  const toronto = source('Toronto.svelte');
  assert.match(toronto, /<SceneObjects \{areaInput\}/);
  assert.doesNotMatch(toronto, /area-selection|data-testid="area-of-interest"/);
  assert.match(toronto, /viewer\?\.setArea\(\); onarea\(undefined\)/);
  assert.match(toronto, /\{#if areaError\}<p class="area-error" role="alert"/);
});

// Inspect parsed template locations, not CSS screenshots: these are structural
// regressions only. Desktop/mobile visual acceptance remains a separate gate.
function elements(file: string, name: string) {
  const result: any[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'RegularElement' && node.name === name) result.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(parse(source(file), { modern: true }).fragment);
  return result;
}

test('one directly accessible model selector precedes settings, retaining context and request inspection', () => {
  const ui = source('ModelChat.svelte');
  const selects = elements('ModelChat.svelte', 'select');
  assert.equal(selects.length, 1);
  assert.ok(selects[0].end < ui.indexOf('<details class="model-settings"'));
  assert.match(ui, /for="chat-model"/);
  assert.match(ui, /removeAttachment\(\); controller.selectModel\(event.currentTarget.value\)/);
  assert.ok(ui.indexOf('data-testid="model-catalog-recovery"') < ui.indexOf('<details class="model-settings"'));
  for (const id of ['model-scene-context', 'model-continuation', 'model-request-body', 'model-tool-context']) assert.ok(ui.includes(`data-testid="${id}"`));
});

test('workspace selector retains Toronto and nearest search without synthetic controls', () => {
  const ui = source('App.svelte');
  assert.match(ui, /mode = \$state<'toronto' \| 'pole'>\('toronto'\)/);
  const selector = elements('App.svelte', 'select')[0];
  const markup = ui.slice(selector.start, selector.end);
  for (const mode of ['toronto', 'pole']) assert.ok(markup.includes(`value="${mode}"`));
  assert.match(markup, /switchSource\(event.currentTarget.value/);
  assert.doesNotMatch(ui, /Synthetic|value="demo"|project-controls|ProjectController/);
});

test('scene display quality is the only technical disclosure; manual and diagnostic scene tools stay removed', () => {
  const ui = source('Toronto.svelte');
  const disclosures = elements('Toronto.svelte', 'details').map(node => ui.slice(node.start, node.end));
  assert.equal(disclosures.length, 2, 'Only the contextual color key and display quality disclosure remain');
  assert.equal(disclosures.filter(markup => markup.includes('data-testid="display-quality"')).length, 1);
  assert.equal(disclosures.filter(markup => markup.includes('data-testid="point-type-key"')).length, 1);
  const quality = disclosures.find(markup => markup.includes('data-testid="display-quality"'))!;
  assert.match(quality, /<summary>Display quality<\/summary>/);
  for (const id of ['adaptive-display-toggle', 'display-near-radius', 'display-threshold', 'display-budget', 'display-point-size', 'display-depth', 'retry-display']) {
    assert.ok(quality.includes(`data-testid="${id}"`), `${id} remains within display quality`);
  }
  assert.doesNotMatch(ui, /<summary>(?:Scene tools|Dataset details|Model annotations|Harness observation|Full-resolution selection|Manual primitive proposal)<\/summary>/);
  const markup = ui.slice(ui.indexOf('</script>'), ui.indexOf('<style>'));
  assert.doesNotMatch(markup, /<TorontoCad\b|<PlacementSearch\b|data-testid="(?:crop-load|crop-cancel|crop-clear|crop-center-[^"]*|crop-size-[^"]*|harness-budget|harness-depth|harness-load|scene-mark-copy)"/);
  assert.doesNotMatch(ui, /navigator\.clipboard|Copy UUID|Copy coordinates/);
  assert.match(ui, /data-testid="quick-retry-display"/);
  assert.match(ui, /data-testid="quick-cancel-crop"/);
  assert.match(ui, /data-testid="quick-retry-crop"/);
  assert.match(ui, /\{#if viewerError\}<p role="alert">Viewer unavailable:/);
});

test('point type key remains contextual, named and outside display quality contents', () => {
  const ui = source('Toronto.svelte');
  const toolbar = elements('Toronto.svelte', 'div').find(node => ui.slice(node.start, node.start + 40).includes('class="toolbar"'));
  const details = elements('Toronto.svelte', 'details');
  const key = details.find(node => ui.slice(node.start, node.end).includes('data-testid="point-type-key"'));
  const quality = details.find(node => ui.slice(node.start, node.end).includes('data-testid="display-quality"'));
  assert.ok(toolbar && key && quality);
  assert.ok(toolbar.start < key.start && key.end < toolbar.end);
  assert.ok(key.end <= quality.start || quality.end <= key.start, 'Key must not be nested in quality settings');
  const markup = ui.slice(key.start, key.end);
  assert.match(ui, /\{#if colorMode === 'type'\}/);
  assert.match(markup, /<summary>Key<\/summary>/);
  assert.match(markup, /aria-label="Point type color key"/);
  assert.match(markup, /POINT_TYPE_KEY/);
  assert.match(markup, /name: 'Unknown', color: UNKNOWN_POINT_COLOR/);
  assert.match(markup, /aria-hidden="true"><\/span>\{entry\.name\}/);
  assert.match(ui, /\.color-key ul\s*\{[^}]*position:\s*absolute;/, 'Expanded key is a popover, not inline toolbar content');
});

test('model hypotheses expose reasoning and scene selection, not diagnostic coordinates or identifier copying', () => {
  const ui = source('SceneMarks.svelte');
  assert.match(ui, /aria-label="Agent location hypotheses"/);
  assert.match(ui, /C\{mark\.rank\} · Hypothesis/);
  assert.match(ui, /\{mark\.rationale\}/);
  assert.match(ui, /Unknowns: \{mark\.uncertainty\}/);
  assert.match(ui, /aria-pressed=\{selected === mark\.id\}/);
  assert.match(ui, /onclick=\{\(\) => onselect\(mark\.id, mark\.position\)\}/);
  const markup = ui.slice(ui.indexOf('</script>'), ui.indexOf('<style>'));
  assert.doesNotMatch(markup, /<details|<summary|Model annotations|annotationRevision|artifactRevision|sessionId|sourceFileId|frameId|UUID|[Cc]opy|\{mark\.position(?:\}|\.)/);
});

test('scene and account remove idle duplicate identity/status while retaining contextual evidence', () => {
  const toronto = source('Toronto.svelte'), account = source('ProviderAccount.svelte'), chat = source('Chat.svelte');
  assert.doesNotMatch(toronto, /<span>Toronto3D<\/span>/);
  assert.match(toronto, /data-testid="point-type-key"/);
  assert.doesNotMatch(toronto, /<summary>Dataset details<\/summary>/);
  assert.match(account, /<summary title=\{accountHeader\(view\)\}>Account<\/summary>/);
  assert.match(account, /data-testid="provider-status"/);
  assert.doesNotMatch(account, /Chat is read-only/);
  assert.match(chat, /class="reference-preview"/);
  assert.match(chat, /\{#if listedPoints.length\}<span class="reference-count"/);
  assert.match(chat, /data-testid=\{`point-type-\$\{point.name\}`\}/);
});
