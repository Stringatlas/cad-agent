import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchAgentToolsInspection, filterAgentTools, validateAgentToolsInspection } from '../apps/web/src/agent-tools-client';

const fixture = {
  kind: 'agent-tools-inspection', availability: 'unknown-unbound',
  instructions: { kind: 'unbound-preview', text: 'Shared preview' },
  tools: [{ namespace: 'scene', name: 'inspect', description: 'Observe the scene', parameters: { type: 'object', properties: {} }, strict: true, requirements: ['loaded scene'], skillId: null }],
  skills: [{ id: 'observe', name: 'Observation', description: 'Explore', instructions: 'Full skill body', tools: ['inspect'], modes: ['toronto'], dependencies: [] }],
};

test('tools client validates full inspection and preserves full instruction/schema bodies', () => {
  const result = validateAgentToolsInspection(fixture);
  assert.equal(result.instructions.text, 'Shared preview');
  assert.equal(result.skills[0]?.instructions, 'Full skill body');
  assert.deepEqual(result.tools[0]?.parameters, fixture.tools[0]?.parameters);
  for (const value of [null, {}, { ...fixture, availability: 'live' }, { ...fixture, instructions: { kind: 'actual-request', text: '' } }, { ...fixture, tools: [{ ...fixture.tools[0], parameters: [] }] }, { ...fixture, skills: [{ ...fixture.skills[0], modes: ['unknown'] }] }]) {
    assert.throws(() => validateAgentToolsInspection(value));
  }
});

test('tools search covers names, descriptions and requirements without mutating catalog', () => {
  const catalog = validateAgentToolsInspection(fixture).tools;
  for (const search of ['', ' INSPECT ', 'observe', 'loaded']) assert.equal(filterAgentTools(catalog, search).length, 1);
  assert.equal(filterAgentTools(catalog, 'missing').length, 0);
  assert.equal(catalog.length, 1);
});

test('tools fetch is read-only, same origin and redirect denied', async () => {
  const controller = new AbortController();
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, '/chat/tools');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.body, undefined);
    return Response.json(fixture);
  };
  assert.equal((await fetchAgentToolsInspection(controller.signal, fetcher)).tools.length, 1);
  await assert.rejects(fetchAgentToolsInspection(controller.signal, async () => new Response('private failure', { status: 500 })), /Tools inspection unavailable/);
  await assert.rejects(fetchAgentToolsInspection(controller.signal, async () => Response.json({})), /Invalid tools/);
});

test('/tools uses an isolated lazy route and accessible disclosures', () => {
  const main = readFileSync('apps/web/src/main.ts', 'utf8');
  assert.match(main, /=== '\/tools'/);
  assert.match(main, /await import\('\.\/ToolsInspector.svelte'\)/);
  assert.doesNotMatch(main, /import App from/);
  const ui = readFileSync('apps/web/src/ToolsInspector.svelte', 'utf8');
  for (const expected of ['Back to workspace', 'Search tools', 'Full parameter schema', 'Full instruction preview', 'Full skill instructions', 'not live availability', 'not an actual provider request', 'request inspector', 'role="alert"', '>Retry</button>']) assert.ok(ui.includes(expected), expected);
  assert.match(ui, /<details/);
  assert.match(ui, /<label for="tool-search">/);
  assert.match(ui, /<input id="tool-search" type="search"/);
});
