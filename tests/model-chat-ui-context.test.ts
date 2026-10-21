import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { modelScene, ModelChatController } from '../apps/web/src/model-chat-client';
import type { TorontoDraftPoint } from '../apps/web/src/draft-context';

const toronto: TorontoDraftPoint = { name: 'Point 2', datasetId: 'toronto3d', artifactRevision: 'a'.repeat(64), key: { sourceFileId: 1, sourceRow: 123 },
  position: [1.2345678912345, 2.3456789123456, 3.4567891234567], frameId: 'toronto3d-local-v1', units: 'm', handedness: 'right', upAxis: 'Z', localOrigin: [627285, 4841948, 0] };

test('Toronto model context includes precise explicit original references without synthetic project bindings', () => {
  const result = modelScene('toronto', [toronto]);
  assert.deepEqual(result, { mode: 'toronto', toronto: [toronto] });
  assert.equal(result.toronto[0].position[0], toronto.position[0]);
  assert.equal(result.toronto[0].key.sourceRow, 123);
  assert.equal('project' in result, false);
  assert.throws(() => modelScene('demo', []));
});

test('active Toronto context retains more than two references and removals without leaking into pole mode', () => {
  const points = Array.from({ length: 4 }, (_, index): TorontoDraftPoint => ({ ...toronto, name: `Point ${index + 1}` }));
  assert.deepEqual(modelScene('toronto', points).toronto, points);
  assert.deepEqual(modelScene('toronto', points.slice(1)).toronto, points.slice(1));
  assert.deepEqual(modelScene('pole', points), { mode: 'pole', toronto: [] });
});

test('context changes retain display history, precise-reference changes continue, mode switches reset server continuation', async () => {
  const handles: (string | null)[] = [];
  const fetcher: typeof fetch = async (path, init) => {
    if (String(path) === '/chat/models') return Response.json({ mode: 'api-key', ready: true, code: 'ready', generation: 'fixture-generation', models: [{ id: 'fixture', label: 'Fixture' }] });
    const request = JSON.parse(String(init?.body)); handles.push(request.conversationId);
    return new Response([
      { kind: 'start', requestId: request.requestId, conversationId: 'fixture-conversation', model: 'fixture' },
      { kind: 'delta', requestId: request.requestId, text: 'Context retained.' },
      { kind: 'done', requestId: request.requestId, conversationId: 'fixture-conversation' },
    ].map(event => JSON.stringify(event) + '\n').join(''), { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const client = new ModelChatController(() => {}, fetcher);
  try {
    client.bind(modelScene('toronto', [toronto])); await client.refreshModels();
    await client.send('first'); assert.equal(handles.at(-1), null);
    client.bind(modelScene('toronto', [{ ...toronto, position: [2, 3, 4] }]));
    const messages = client.view.messages;
    assert.equal(client.view.continuationActive, true);
    await client.send('followup'); assert.equal(handles.at(-1), 'fixture-conversation');
    client.bind(modelScene('pole', [])); assert.equal(client.view.continuationActive, false);
    assert.deepEqual(client.view.messages.slice(0, 2), messages);
    assert.match(client.view.historyNotice!, /reference only, not sent to the model/);
    await client.send('new scene'); assert.equal(handles.at(-1), null);
    client.newChat(); assert.deepEqual(client.view.messages, []);
  } finally { client.dispose(); }
});

test('model UI renders safe content and explicit catalog, history and screenshot controls without synthetic editing', () => {
  const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  for (const id of ['local-draft', 'send-local-draft', 'local-draft-form', 'local-draft-status', 'model-refresh', 'model-select', 'model-cancel', 'model-new-chat', 'model-history', 'model-scene-context', 'model-edit-message', 'model-retry-message']) assert.ok(source.includes(`data-testid="${id}"`));
  assert.ok(source.includes('<SafeMarkdown text={message.text ||')); assert.ok(!source.includes('{@html'));
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(source));
  assert.ok(source.includes("window.addEventListener('spatial-provider-change'"));
  assert.ok(source.includes("window.addEventListener('focus', revalidate)"));
  assert.ok(source.includes("document.addEventListener('visibilitychange', visibility)"));
  assert.ok(source.includes('role="status" data-testid="model-history-notice"'));
  assert.ok(source.includes('Edit in composer · sends as a new message'));
  assert.ok(source.includes('Send again using the current scene'));
  const integration = readFileSync(new URL('../apps/web/src/Chat.svelte', import.meta.url), 'utf8');
  assert.match(integration, /<ModelChat\s+\{scene\}\s+\{visualSource\}\s+points=\{activePoints\}\s+\{onverifiedresult\}/);
  assert.ok(!integration.includes('projectController'));
  assert.ok(!integration.includes('<BoxControls'));
  const crop = readFileSync(new URL('../apps/web/src/ScreenshotCrop.svelte', import.meta.url), 'utf8');
  for (const id of ['model-attach-screenshot', 'model-remove-screenshot', 'model-image-preview', 'model-image-status']) assert.ok(source.includes(`data-testid="${id}"`));
  for (const id of ['model-crop-dialog', 'model-crop-attach', 'model-image-capability-notice']) assert.ok(crop.includes(`data-testid="${id}"`));
  assert.ok(crop.includes('the provider catalog does not verify image capability'));
  assert.ok(crop.includes('Images are never silently removed or retried as text-only.'));
});

test('composer clears admitted sends immediately, preserves rejected drafts and never clears newer typing', async () => {
  const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('  async function send(submitted = draft) {'), source.indexOf('  async function editMessage('));
  for (const scenario of ['completed', 'rejected', 'error', 'cancelled', 'changed', 'changed-back', 'blocked']) {
    let finish!: (sent: boolean) => void;
    let calls = 0, removals = 0;
    const attachment = {};
    const scope = { readyToSend: scenario !== 'blocked', draft: 'Submitted message', attachment, effectiveAttachment: attachment,
      view: { phase: 'idle' }, removeAttachment: () => { removals++; },
      controller: { send: (text: string, image: unknown) => {
        calls++; assert.equal(text, 'Submitted message'); assert.equal(image, attachment);
        scope.view.phase = scenario === 'rejected' ? 'idle' : 'streaming';
        return new Promise<boolean>(resolve => { finish = resolve; });
      } } };
    const send = runInNewContext(`${handler}; send`, scope) as () => Promise<void>;
    const pending = send();
    if (scenario === 'blocked') { await pending; assert.equal(calls, 0); assert.equal(scope.draft, 'Submitted message'); continue; }
    assert.equal(scope.draft, scenario === 'rejected' ? 'Submitted message' : '', `before response: ${scenario}`);
    if (scenario === 'changed' || scenario === 'changed-back') scope.draft = scenario === 'changed' ? 'Next message' : 'Submitted message';
    scope.view.phase = ['error', 'cancelled'].includes(scenario) ? scenario : 'completed';
    finish(scenario !== 'rejected'); await pending;
    assert.equal(scope.draft, scenario === 'rejected' || scenario === 'changed-back' ? 'Submitted message' : scenario === 'changed' ? 'Next message' : '', scenario);
    assert.equal(removals, scenario === 'rejected' ? 0 : 1, scenario);
  }
});
