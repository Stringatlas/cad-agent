import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createDemoProject } from '../packages/project-state/src/index';
import { PROJECT_FRAME_ID, type ProjectSnapshot, type ScenePointReference } from '../packages/contracts/src/index';
import { modelScene, ModelChatController } from '../apps/web/src/model-chat-client';
import type { TorontoDraftPoint } from '../apps/web/src/draft-context';

const snapshot: ProjectSnapshot = { sessionId: 'scene-session', frameId: PROJECT_FRAME_ID, project: createDemoProject() };
const cloud = snapshot.project.entities.find(e => e.kind === 'point-cloud')!;
const pin: ScenePointReference = { name: 'Point 1', entityId: cloud.id, pointIndex: 0, position: cloud.points[0]! };
const view = { selectedId: 'proposal-box', points: [pin], needsRefresh: false };
const toronto: TorontoDraftPoint = { name: 'Point 2', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 123 },
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

test('active scene retains more than two precise references and removals are reflected without leaking inactive references', () => {
  const synthetic = Array.from({ length: 4 }, (_, index): ScenePointReference => ({ ...pin, name: `Point ${index + 3}` }));
  const originals = Array.from({ length: 4 }, (_, index): TorontoDraftPoint => ({ ...toronto, name: `Point ${index + 7}` }));
  const fullView = { ...view, points: synthetic };
  const demo = modelScene('demo', snapshot, fullView, originals);
  assert.deepEqual(demo.project!.points, synthetic); assert.deepEqual(demo.toronto, []);
  const dataset = modelScene('toronto', snapshot, fullView, originals);
  assert.deepEqual(dataset.toronto, originals); assert.deepEqual(dataset.project!.points, []);
  assert.deepEqual(dataset.project!.entityIds, []);
  assert.equal(dataset.toronto[3]!.position[0], 1.2345678912345);
  assert.notEqual(dataset.toronto[3]!.position[0], Math.fround(dataset.toronto[3]!.position[0]));
  const remainingSynthetic = synthetic.filter(point => point.name !== 'Point 4');
  const remainingToronto = originals.filter(point => point.name !== 'Point 8');
  assert.deepEqual(modelScene('demo', snapshot, { ...fullView, points: remainingSynthetic }, originals).project!.points, remainingSynthetic);
  assert.deepEqual(modelScene('toronto', snapshot, fullView, remainingToronto).toronto, remainingToronto);
  assert.equal(demo.project!.points.length, 4); assert.equal(dataset.toronto.length, 4);
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

test('scene/selection/session/revision/provenance changes retain display history but start a new server conversation', async () => {
  const handles: (string | null)[] = [];
  const client = new ModelChatController(() => {}, async (path, init) => path === '/chat/models'
    ? new Response(JSON.stringify({ mode: 'api-key', ready: true, generation: 'generation-fixture', code: 'ready', models: [{ id: 'fixture-model', label: 'Fixture' }] }))
    : (() => { const r = JSON.parse(init!.body as string); handles.push(r.conversationId); return new Response([
      { kind: 'start', requestId: r.requestId, conversationId: 'fixture-conversation', model: r.model },
      { kind: 'delta', requestId: r.requestId, text: 'Complete' }, { kind: 'done', requestId: r.requestId, conversationId: 'fixture-conversation' },
    ].map(e => JSON.stringify(e) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson' } }); })());
  client.bind(modelScene('demo', snapshot, view, [])); await client.refreshModels(); client.selectModel('fixture-model');
  const extraPins: ScenePointReference[] = [pin, { ...pin, name: 'Point 3' }, { ...pin, name: 'Point 4' }];
  const alternatives = [modelScene('demo', snapshot, { ...view, points: extraPins }, []),
    modelScene('demo', snapshot, { ...view, points: extraPins.filter(point => point.name !== 'Point 3') }, []),
    modelScene('demo', snapshot, { ...view, selectedId: null }, []),
    modelScene('demo', { ...snapshot, sessionId: 'new-session' }, view, []),
    modelScene('demo', { ...snapshot, project: { ...snapshot.project, revision: snapshot.project.revision + 1 } }, view, []),
    modelScene('demo', snapshot, { ...view, points: [] }, []),
    modelScene('toronto', undefined, view, [toronto]),
    modelScene('toronto', undefined, view, [{ ...toronto, artifactRevision: 'b'.repeat(64) }])];
  try {
    let turns = 0;
    for (const [index, next] of alternatives.entries()) {
      await client.send('hello'); turns++;
      assert.equal(handles.at(-1), null); assert.equal(client.view.messages.length, turns * 2);
      // Prove continuation before append/removal, while staying within the per-chat turn budget.
      if (index < 2) {
        await client.send('same-context'); turns++;
        assert.equal(handles.at(-1), 'fixture-conversation');
        assert.equal(client.view.messages.length, turns * 2);
      }
      const messages = client.view.messages;
      client.bind(next); assert.deepEqual(client.view.messages, messages);
      const bound = client.view; client.bind(JSON.parse(JSON.stringify(next))); assert.equal(client.view, bound);
      assert.ok(client.view.messages.every(message => message.state === 'complete'));
      assert.match(client.view.historyNotice!, /Scene context changed/); assert.match(client.view.historyNotice!, /reference only, not sent to the model/);
    }
    await client.send('latest-context'); assert.equal(handles.at(-1), null);
    client.newChat(); assert.deepEqual(client.view.messages, []); assert.equal(client.view.historyNotice, undefined);
  } finally { client.dispose(); }
});

test('model UI renders plain text, keeps local draft IDs and exposes explicit catalog/model/cancel/reset controls', () => {
  const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  for (const id of ['local-draft', 'send-local-draft', 'local-draft-form', 'local-draft-status', 'model-refresh', 'model-select', 'model-cancel', 'model-new-chat', 'model-history', 'model-scene-context']) assert.ok(source.includes(`data-testid="${id}"`));
  assert.ok(source.includes('{message.text ||')); assert.ok(!source.includes('{@html')); assert.ok(!/localStorage|sessionStorage|indexedDB/.test(source));
  assert.ok(source.includes("window.addEventListener('spatial-provider-change'")); assert.ok(source.includes('void controller.refreshModels()'));
  assert.ok(source.includes("window.addEventListener('focus', revalidate)")); assert.ok(source.includes("window.removeEventListener('focus', revalidate)"));
  assert.ok(source.includes("document.addEventListener('visibilitychange', visibility)")); assert.ok(source.includes("document.removeEventListener('visibilitychange', visibility)"));
  assert.match(source, /const revalidate = \(\) => \{ void controller\.refreshModels\(\); \}/);
  assert.match(source, /const changed = \(\) => \{ removeAttachment\(\); controller\.accountChanged\(\); revalidate\(\); \}/);
  assert.match(source, /if \(document\.visibilityState === 'visible'\) revalidate\(\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', visibility\);\s*revalidate\(\);/);
  assert.match(source, /view\.catalogPhase === 'ready' && view\.catalog\?\.ready/);
  assert.ok(source.includes('data-testid="model-history-notice"')); assert.ok(source.includes('{view.historyNotice}'));
  assert.ok(!/draft\s*=\s*''/.test(source.replace("let draft = $state('');", '')));
  const integration = readFileSync(new URL('../apps/web/src/Chat.svelte', import.meta.url), 'utf8');
  assert.ok(integration.includes('<ModelChat {scene} {visualSource} points={activePoints} {onverifiedresult} />'));
  assert.ok(integration.includes('activePoints.map(({ evidence: _evidence, ...original }) => original)'));
  assert.ok(integration.includes('<PointEdits {artifactRevision} points={activePoints}'));
  assert.ok(source.includes('data-testid="model-select-nearest"'));
  const crop = readFileSync(new URL('../apps/web/src/ScreenshotCrop.svelte', import.meta.url), 'utf8');
  for (const id of ['model-attach-screenshot', 'model-remove-screenshot', 'model-image-preview', 'model-image-status']) assert.ok(source.includes(`data-testid="${id}"`));
  for (const id of ['model-crop-dialog', 'model-crop-attach', 'model-image-capability-notice']) assert.ok(crop.includes(`data-testid="${id}"`));
  assert.ok(!source.includes('supported vision-model list')); assert.ok(!source.includes('modelSupportsVisualInput'));
  assert.ok(crop.includes('the provider catalog does not verify image capability')); assert.ok(crop.includes('the provider may reject it'));
  assert.ok(source.includes('!catalogModelSelected')); assert.ok(crop.includes('Images are never silently removed or retried as text-only.'));
  assert.ok(source.includes('controller.send(draft, current)')); assert.ok(integration.includes('<BoxControls {view} controller={projectController} />'));
  assert.ok(integration.includes('void projectController.context()')); assert.ok(integration.includes('void controller?.submit(command)'));
});
