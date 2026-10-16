import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createDemoProject } from '../packages/project-state/src/index';
import { PROJECT_FRAME_ID, type ProjectSnapshot, type ScenePointReference } from '../packages/contracts/src/index';
import { modelScene, ModelChatController } from '../apps/web/src/model-chat-client';
import type { TorontoDraftPoint } from '../apps/web/src/draft-context';

const snapshot: ProjectSnapshot = { sessionId: 'scene-session', frameId: PROJECT_FRAME_ID, project: createDemoProject() };
const cloud = snapshot.project.entities.find(e => e.kind === 'point-cloud')!;
const pin: ScenePointReference = { name: 'A', entityId: cloud.id, pointIndex: 0, position: cloud.points[0]! };
const view = { selectedId: 'proposal-box', points: [pin], needsRefresh: false };
const toronto: TorontoDraftPoint = { name: 'B', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 123 },
  position: [1.2345678912345, 2.3456789123456, 3.4567891234567], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };

test('demo model context carries exact current snapshot selection and original synthetic points only', () => {
  const result = modelScene('demo', snapshot, view, [toronto]);
  assert.deepEqual(result, { mode: 'demo', project: { sessionId: snapshot.sessionId, projectRevision: snapshot.project.revision, frameId: snapshot.frameId,
    units: 'm', entityIds: ['proposal-box'], points: [pin] }, toronto: [] });
  assert.equal(result.project!.points[0]!.position[0], cloud.points[0]![0]); assert.ok(!JSON.stringify(result).includes('toronto3d'));
});

test('Toronto includes only explicit original dataset references plus empty-selection project binding, never retained demo refs', () => {
  const result = modelScene('toronto', snapshot, view, [toronto]);
  assert.deepEqual(result.toronto, [toronto]); assert.deepEqual(result.project, { sessionId: snapshot.sessionId, projectRevision: snapshot.project.revision,
    frameId: snapshot.frameId, units: 'm', entityIds: [], points: [] });
  assert.equal(result.toronto[0]!.position[0], toronto.position[0]); assert.equal(result.toronto[0]!.key.sourceRow, 123);
  assert.ok(!JSON.stringify(result).includes(cloud.id)); assert.ok(!JSON.stringify(result).includes('proposal-box'));
});

test('closest-label mode has no hidden Toronto or synthetic refs', () => {
  const result = modelScene('pole', snapshot, view, [toronto]);
  assert.deepEqual(result.toronto, []); assert.deepEqual(result.project!.entityIds, []); assert.deepEqual(result.project!.points, []);
});

test('unavailable or ambiguous authority never fabricates snapshot/project selection; Toronto draft remains usable', () => {
  for (const current of [undefined, snapshot]) {
    const result = modelScene('toronto', current, { ...view, needsRefresh: true }, [toronto]);
    assert.equal(result.project, null); assert.deepEqual(result.toronto, [toronto]);
  }
  const result = modelScene('demo', undefined, view, [toronto]); assert.equal(result.project, null); assert.deepEqual(result.toronto, []);
});

test('scene/selection/session/revision/provenance changes reset completed history, while unchanged binding is stable', async () => {
  const client = new ModelChatController(() => {}, async (path, init) => path === '/chat/models'
    ? new Response(JSON.stringify({ mode: 'api-key', ready: true, generation: 'generation-fixture', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture' }] }))
    : (() => { const r = JSON.parse(init!.body as string); return new Response([
      { kind: 'start', requestId: r.requestId, conversationId: 'fixture-conversation', model: r.model },
      { kind: 'delta', requestId: r.requestId, text: 'Complete' }, { kind: 'done', requestId: r.requestId, conversationId: 'fixture-conversation' },
    ].map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson' } }); })());
  client.bind(modelScene('demo', snapshot, view, [])); await client.refreshModels(); client.selectModel('fixture-model');
  const alternatives = [modelScene('demo', snapshot, { ...view, selectedId: null }, []),
    modelScene('demo', { ...snapshot, sessionId: 'new-session' }, view, []),
    modelScene('demo', { ...snapshot, project: { ...snapshot.project, revision: snapshot.project.revision + 1 } }, view, []),
    modelScene('demo', snapshot, { ...view, points: [] }, []),
    modelScene('toronto', undefined, view, [toronto]),
    modelScene('toronto', undefined, view, [{ ...toronto, artifactRevision: 'b'.repeat(64) }])];
  for (const next of alternatives) { await client.send('hello'); assert.equal(client.view.messages.length, 2); client.bind(next); assert.equal(client.view.messages.length, 0); }
  client.dispose();
});

test('model UI renders plain text, keeps local draft IDs and exposes explicit catalog/model/cancel/reset controls', () => {
  const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  for (const id of ['local-draft', 'send-local-draft', 'local-draft-form', 'local-draft-status', 'model-refresh', 'model-select', 'model-cancel', 'model-new-chat', 'model-history', 'model-scene-context']) assert.ok(source.includes(`data-testid="${id}"`));
  assert.ok(source.includes('{message.text ||')); assert.ok(!source.includes('{@html')); assert.ok(!/localStorage|sessionStorage|indexedDB/.test(source));
  assert.ok(source.includes("window.addEventListener('spatial-provider-change'")); assert.ok(source.includes('void controller.refreshModels()'));
  const integration = readFileSync(new URL('../apps/web/src/Chat.svelte', import.meta.url), 'utf8');
  assert.ok(integration.includes('<ModelChat {scene} />')); assert.ok(integration.includes('<BoxControls {view} controller={projectController} />'));
  assert.ok(integration.includes('void projectController.context()')); assert.ok(integration.includes('void controller?.submit(command)'));
});
