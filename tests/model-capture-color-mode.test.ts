import test from 'node:test';
import { withProductSkills } from './helpers/product-skill-transport';
import assert from 'node:assert/strict';
import { canonicalModelBrowserAction, canonicalModelCaptureRequest, canonicalModelChatEvent, type ModelCaptureColorMode, type ModelCaptureRequest } from '../packages/contracts/src/model-chat';
import { type ModelChatEvent, type ModelScene, type ModelTurnRequest } from '@spatial/contracts';
import { ProviderModel, ModelError, type BoundModelScene } from '../apps/server/src/provider-model';
import { ProviderAuth } from '../apps/server/src/provider-auth';

const views: ModelCaptureRequest[] = [
  { kind: 'current' }, { kind: 'top-down' },
  { kind: 'camera', position: [1, 2, 3], target: [0, 0, 0] },
  { kind: 'camera', position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1] },
];
for (const [index, view] of views.entries()) {
  for (const colorMode of [undefined, 'rgb', 'type'] as const) test(`capture variant ${index}, color ${colorMode ?? 'omitted'} round-trips through browser action/event`, () => {
    const request: ModelCaptureRequest = { ...view, ...(colorMode === undefined ? {} : { colorMode: colorMode satisfies ModelCaptureColorMode }) };
    assert.deepEqual(canonicalModelCaptureRequest(request), request);
    const action = { kind: 'capture', request };
    assert.deepEqual(canonicalModelBrowserAction(JSON.parse(JSON.stringify(action))), action);
    const event = { kind: 'browser-request', requestId: 'r', toolCallId: 'capture-1', nonce: 'nonce', action };
    assert.deepEqual(canonicalModelChatEvent(JSON.parse(JSON.stringify(event))), event);
    if (colorMode === undefined) assert.equal(Object.hasOwn(canonicalModelCaptureRequest(view), 'colorMode'), false);
  });
  test(`capture variant ${index} rejects invalid modes and extra fields`, () => {
    for (const colorMode of [null, '', 'RGB', 'semantic', 'height', 0, false, [], {}]) {
      assert.throws(() => canonicalModelCaptureRequest({ ...view, colorMode }), TypeError);
      assert.throws(() => canonicalModelBrowserAction({ kind: 'capture', request: { ...view, colorMode } }), TypeError);
    }
    assert.throws(() => canonicalModelCaptureRequest({ ...view, colorMode: 'rgb', extra: true }), TypeError);
  });
}

const scene: ModelScene = { mode: 'toronto', project: null, toronto: [] };
const signal = new AbortController().signal;
async function fixture(t: { after(fn: () => unknown): void }, args?: unknown, capabilities: Partial<BoundModelScene> = {}) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' });
  const bodies: Record<string, any>[] = [], events: ModelChatEvent[] = [];
  const model = new ProviderModel(auth, withProductSkills(async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
    bodies.push(JSON.parse(String(init?.body)));
    const output = bodies.length === 1 && args !== undefined ? [{ type: 'function_call', namespace: 'scene', name: 'capture_scene', call_id: 'capture-1', arguments: JSON.stringify(args) }] : [];
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }, ['visual-inspection']));
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal);
  const call: ModelTurnRequest = { requestId: 'r', conversationId: null, generation: catalog.generation, model: 'fixture', text: 'Inspect the scene.', scene };
  const run = () => model.turn(call, { context: { scene, frameId: 'toronto3d-local-v1', units: 'm' }, async check() {}, async close() {}, ...capabilities }, async event => { events.push(event); }, signal);
  return { bodies, events, run };
}

test('provider advertises optional color enum with truthful display/availability behavior', async t => {
  const f = await fixture(t, undefined, { async captureScene() { return undefined; } });
  await f.run();
  const capture = f.bodies[0].tools[0].tools.find((tool: { name: string }) => tool.name === 'capture_scene');
  assert.deepEqual(capture.parameters.properties.colorMode, { type: 'string', enum: ['rgb', 'type'] });
  assert.deepEqual(capture.parameters.required, ['kind']);
  assert.equal(capture.parameters.additionalProperties, false);
  assert.equal(capture.strict, false, 'optional arguments remain optional at the provider');
  assert.match(capture.description, /rgb for natural RGB/u);
  assert.match(capture.description, /type for semantic point-type colors \(Toronto source layers\)/u);
  assert.match(capture.description, /omit to use the user’s current mode/u);
  assert.match(capture.description, /preserves the user’s viewport and display mode/u);
  assert.match(capture.description, /unsupported viewers return unavailable/u);
});

for (const view of views.slice(0, 3)) for (const colorMode of [undefined, 'rgb', 'type'] as const) test(`provider forwards ${view.kind}/${colorMode ?? 'omitted'} and returns unavailable honestly`, async t => {
  const request = { ...view, ...(colorMode === undefined ? {} : { colorMode }) };
  const received: ModelCaptureRequest[] = [];
  const f = await fixture(t, request, { async captureScene(value, toolCallId) { assert.equal(toolCallId, 'capture-1'); received.push(value); return undefined; } });
  await f.run();
  assert.deepEqual(received, [request]);
  const event = f.events.find(e => e.kind === 'tool' && e.name === 'capture_scene');
  assert.ok(event?.kind === 'tool');
  assert.deepEqual(event.context, { status: 'unavailable' });
  const output = f.bodies[1].input.find((item: { type: string }) => item.type === 'function_call_output' && (item as { call_id?: string }).call_id === 'capture-1');
  assert.deepEqual(JSON.parse(output.output), { status: 'unavailable' });
});

for (const args of [{ kind: 'current', colorMode: null }, { kind: 'top-down', colorMode: 'semantic' }, { kind: 'current', colorMode: 'rgb', extra: true }]) test(`provider rejects invalid capture args ${JSON.stringify(args)}`, async t => {
  let invoked = false;
  const f = await fixture(t, args, { async captureScene() { invoked = true; return undefined; } });
  await assert.rejects(f.run(), (error: unknown) => error instanceof ModelError && error.code === 'unsupported-tool');
  assert.equal(invoked, false);
});

test('provider does not advertise capture without browser capability', async t => {
  const f = await fixture(t);
  await f.run();
  assert.equal(f.bodies[0].tools[0].tools.some((tool: { name: string }) => tool.name === 'capture_scene'), false);
});
