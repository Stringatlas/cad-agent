import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../apps/web/src/ModelChat.svelte', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  async function attachScreenshot()'), source.indexOf('  async function send('));
const javascript = ts.transpile(handler, { target: ts.ScriptTarget.ES2022 });
function fixture(options: { unavailable?: boolean; cropOpen?: boolean; captureBusy?: boolean; fail?: boolean; oversized?: boolean } = {}) {
  let captures = 0;
  const observation = { observationId: 'observation-one', image: { byteLength: options.oversized ? 101 : 10 } };
  const scope = { visualSource: options.unavailable ? undefined : {
    capture: async () => { captures++; if (options.fail) throw new Error('Viewer lost; capture again'); return observation; },
    isCurrent: () => true, resolvePixel: () => undefined,
  }, scene: { mode: 'demo' }, alive: true, captureTicket: 0, captureBusy: !!options.captureBusy,
    cropOpen: !!options.cropOpen, cropObservation: undefined as unknown, captureError: '', attachment: undefined as unknown,
    cropCurrent: () => false, cropAttach: (_image: unknown) => {},
    MODEL_VISUAL_LIMITS: { sourcePngBytes: 100 }, removeAttachment: () => {
      scope.captureTicket++; scope.captureBusy = false; scope.cropOpen = false; scope.attachment = undefined;
      scope.cropObservation = undefined; scope.captureError = '';
    } };
  const attach = runInNewContext(`${javascript}; attachScreenshot`, scope) as () => Promise<void>;
  return { scope, attach, captures: () => captures, observation };
}

test('manual capture requires only a viewer and no duplicate crop, not provider/model/streaming/AOI state', async () => {
  // Deliberately omit all catalog, model, turn and AOI variables from the actual handler scope.
  const f = fixture(); await f.attach();
  assert.equal(f.captures(), 1); assert.equal(f.scope.cropOpen, true);
  assert.equal(f.scope.captureBusy, false); assert.equal(f.scope.cropObservation, f.observation);
  assert.equal(f.scope.cropCurrent(), true);
  const image = { image: { dataUrl: 'captured-pixels' } }; f.scope.cropAttach(image);
  assert.equal((f.scope.attachment as { observation: unknown }).observation, image);
  assert.equal(f.scope.cropOpen, false);
  const button = source.match(/<button bind:this=\{cameraButton\}[^>]+>/)?.[0];
  assert.ok(button?.includes('disabled={!visualSource || cropOpen || captureBusy}'));
});

test('missing viewer and duplicate capture are guarded even when handler is called directly', async () => {
  for (const options of [{ unavailable: true }, { cropOpen: true }, { captureBusy: true }]) {
    const f = fixture(options); await f.attach(); assert.equal(f.captures(), 0);
  }
});

test('capture errors and oversized images leave a recoverable crop error without an attachment', async () => {
  for (const options of [{ fail: true }, { oversized: true }]) {
    const f = fixture(options); await f.attach();
    assert.ok(f.scope.captureError); assert.equal(f.scope.captureBusy, false);
    assert.equal(f.scope.attachment, undefined); assert.equal(f.scope.cropObservation, undefined);
  }
});

test('cancelled or mode-switched capture cannot install late pixels', async () => {
  for (const invalidate of [(scope: ReturnType<typeof fixture>['scope']) => scope.removeAttachment(),
    (scope: ReturnType<typeof fixture>['scope']) => { scope.scene.mode = 'toronto'; },
    (scope: ReturnType<typeof fixture>['scope']) => { scope.alive = false; }]) {
    const f = fixture(); const pending = f.attach(); invalidate(f.scope); await pending;
    assert.equal(f.scope.cropObservation, undefined); assert.equal(f.scope.attachment, undefined);
  }
});

test('local screenshot takes precedence without clearing area context, provider/model changes retain draft pixels', () => {
  assert.ok(source.includes('const effectiveAttachment = $derived(attachment ?? areaInput?.attachment)'));
  assert.ok(source.includes('const showingAreaSnapshot = $derived(!attachment && !!areaInput?.attachment)'));
  assert.ok(source.includes('onclick={() => showingAreaSnapshot ? areaInput?.clear() : removeAttachment()}'));
  assert.ok(source.includes('disabled={showingAreaSnapshot && view.phase === \'streaming\'}'));
  assert.ok(source.includes('onchange={event => controller.selectModel(event.currentTarget.value)}'));
  assert.ok(source.includes('const changed = () => { controller.accountChanged(); revalidate(); }'));
  // Source and area identity changes still invalidate local captures, never rewrite old pixels.
  assert.ok(source.includes('$effect(() => { captureMode; untrack(() => removeAttachment()); })'));
  assert.ok(source.includes('$effect(() => { areaIdentity; untrack(() => removeAttachment()); })'));
});
