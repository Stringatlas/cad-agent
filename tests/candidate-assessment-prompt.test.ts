import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ProviderModel, type BoundModelScene } from '../apps/server/src/provider-model';
import { ProviderAuth } from '../apps/server/src/provider-auth';
import { type ModelChatEvent, type ModelScene, type ModelTurnRequest, type ModelVisualObservation } from '@spatial/contracts';

const readback = readFileSync(new URL('../docs/model-candidate-prompt.md', import.meta.url), 'utf8');
const sections = Object.fromEntries([...readback.matchAll(/## (\w+)\n\n```text\n([^]*?)\n```/gu)].map(m => [m[1], m[2]]));
const common = ['INSTRUCTIONS', 'LOOP_INSTRUCTIONS', 'CANDIDATE_INSTRUCTIONS'];
const expected = (...extra: string[]) => [...common, ...extra].map(name => sections[name]).join('\n\n');
const signal = new AbortController().signal;
const tool = (name: string, id: number) => ({ type: 'function_call', namespace: 'scene', name, call_id: `c${id}`, arguments: JSON.stringify({ kind: 'top-down' }) });
const unavailable = async (): Promise<never> => { throw new Error('advertised capability must not be invoked by this fixture'); };
function image(): ModelVisualObservation {
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { schemaVersion: 1, observationId: 'capture-one', viewGeneration: 1,
    image: { mimeType: 'image/png', dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
    viewport: { width: 1, height: 1, pixelRatio: 1, pixelOrigin: 'top-left' },
    camera: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], up: [0, 0, 1], near: .1, far: 100, fov: 50, aspect: 1, zoom: 1, matrixWorld: identity, matrixWorldInverse: identity, projectionMatrix: identity },
    binding: { sourceId: 'fixture', sourceRevision: 0, frameId: 'toronto3d-local-v1', units: 'm', origin: [0, 0, 0] },
    coverage: { kind: 'displayed-sample', complete: false, displayedPointCount: 1 } };
}
async function request(t: { after(fn: () => unknown): void }, scene: ModelScene, capabilities: Partial<BoundModelScene> = {}, outputs: unknown[][] = [[]]) {
  const auth = new ProviderAuth({ mode: 'api-key', apiKey: 'fixture-only' });
  const bodies: Record<string, any>[] = [], events: ModelChatEvent[] = [];
  const model = new ProviderModel(auth, async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] });
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: outputs.shift() ?? [] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  });
  t.after(() => { model.close(); auth.close(); });
  const catalog = await model.models(signal);
  const call: ModelTurnRequest = { requestId: 'r', conversationId: null, generation: catalog.generation, model: 'fixture', text: 'Compare candidate locations in this area.', scene };
  await model.turn(call, { context: { scene, frameId: 'toronto3d-local-v1', units: 'm' }, async check() {}, async close() {}, ...capabilities }, async e => { events.push(e); }, signal);
  for (const [index, body] of bodies.entries()) {
    const inspection = events.filter(e => e.kind === 'request-inspection')[index];
    assert.equal(JSON.parse(inspection.inspection.bodyJson).instructions, body.instructions, 'readback is the actual inspected and transmitted prompt');
    assert.equal(body.tool_choice, undefined, 'do not force arbitrary tool calls');
    assert.ok(!body.tools[0].tools.some((v: { name: string }) => /approve|decline|publish|save|undo/.test(v.name)));
  }
  return bodies;
}
const demo: ModelScene = { mode: 'demo', project: null, toronto: [] };
const toronto: ModelScene = { mode: 'toronto', project: null, toronto: [{ name: 'Point 1', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 0 }, position: [1, 2, 3], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] }] };

test('read-only request includes exact common workflow and honest evidence limits, not unavailable capability sections', async t => {
  const [body] = await request(t, demo);
  assert.equal(body.instructions, expected());
  assert.match(body.instructions, /Before recommending or ranking locations, call scene.capture_scene when advertised/u);
  assert.match(body.instructions, /If capture or geometric assessment is unavailable\/incomplete/u);
  assert.match(body.instructions, /not a prerequisite for unrelated exact-coordinate edits or respective nearest-label moves/u);
  assert.match(body.instructions, /Only an explicit authority humanDecision accepted result/u);
  assert.deepEqual(body.tools[0].tools.map((v: { name: string }) => v.name), ['inspect_scene']);
});
test('synthetic instructions are advertised only with synthetic box tools', async t => {
  const [body] = await request(t, { ...demo, project: { sessionId: 'fixture', projectRevision: 0, frameId: 'demo-local-v1', units: 'm', entityIds: [], points: [] } }, { proposeBox: unavailable });
  assert.equal(body.instructions, expected('SYNTHETIC_INSTRUCTIONS'));
  assert.match(body.instructions, /parameter proposals do not create kernel geometry/u);
});
test('Toronto AOI/object/placement request exactly matches full capability readback and descriptive tools', async t => {
  const [body] = await request(t, toronto, { captureScene: unavailable, selectReference: unavailable, queryAoiPoints: unavailable,
    listObjects: unavailable, getObject: unavailable, proposePointCreate: unavailable, assessUtilityBox: unavailable, proposeUtilityBox: unavailable });
  assert.equal(body.instructions, expected('OBJECT_INSTRUCTIONS', 'TORONTO_INSTRUCTIONS', 'PLACEMENT_INSTRUCTIONS', 'AOI_POINTS_INSTRUCTIONS'));
  const tools = body.tools[0].tools as { name: string; description: string }[];
  assert.match(tools.find(v => v.name === 'capture_scene')!.description, /Before recommending candidate locations/u);
  assert.match(tools.find(v => v.name === 'query_aoi_points')!.description, /not as ranked\/best\/closest recommendations/u);
  assert.match(body.instructions, /do not bypass assessment via generic CAD tools/u);
  assert.match(body.instructions, /NOT the best, closest or recommended spots/u);
});
test('missing point or partial capabilities do not advertise placement/object instructions', async t => {
  const [body] = await request(t, { ...toronto, toronto: [] }, { assessUtilityBox: unavailable, proposeUtilityBox: unavailable, listObjects: unavailable });
  assert.equal(body.instructions, expected('TORONTO_INSTRUCTIONS'));
});
for (const captured of [false, true]) test(`capture ${captured ? 'available' : 'unavailable'}: subsequent round gains visual instructions only with actual image`, async t => {
  let calls = 0;
  const bodies = await request(t, toronto, { async captureScene(request) { calls++; assert.deepEqual(request, { kind: 'top-down' }); return captured ? image() : undefined; } }, [[tool('capture_scene', 1)], []]);
  assert.equal(calls, 1);
  assert.equal(bodies[0].instructions, expected('TORONTO_INSTRUCTIONS'));
  assert.equal(bodies[1].instructions, expected('TORONTO_INSTRUCTIONS', ...(captured ? ['VISUAL_INSTRUCTIONS'] : [])));
  assert.equal(JSON.stringify(bodies[1].input).includes('input_image'), captured);
});
