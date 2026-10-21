import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (file: string) => readFileSync(new URL(`../apps/web/src/${file}`, import.meta.url), 'utf8');

// Complement behavioral renderer/transport/authority tests with Svelte/viewer wiring
// checks; these do not claim browser rendering or interaction verification.
test('Toronto capture paths admit mixed scenes and truthfully describe capture-time layers', () => {
  const toronto = source('toronto-viewer.ts');
  for (const text of [toronto]) {
    const capture = text.slice(text.indexOf('    capture: (request?: ModelCaptureRequest) => {'), text.indexOf('    isCaptureCurrent:'));
    assert.ok(capture.includes('visual.capture(request)'), 'requested camera must reach mixed-scene capture');
    assert.ok(!capture.includes('throw new Error'));
    assert.ok(text.includes("observation: 'capture-time-rendered-scene-not-current-geometry'"));
  }
  assert.ok(toronto.includes('cadSolidsOrGhosts: cad.captureBlocked'));
  assert.ok(toronto.includes('pointEditsOrPreview: pointOverrides.captureBlocked'));
  assert.ok(toronto.includes('derivedOverlays: preprocessing.count'));
  assert.ok(toronto.includes('authoredDatumsOrGhosts: authoredObjects.count'));
  assert.match(toronto, /pointProvenance: pointOverrides\.captureBlocked \|\| authoredObjects\.count \? 'unavailable-for-edited-imagery'/);
  assert.match(toronto, /resolve: \(object, index\) => \{[\s\S]*?if \(pointOverrides\.captureBlocked \|\| authoredObjects\.count\) return;/);
});

test('chat attachment lifetime excludes camera, live capture currency and geometry comparisons', () => {
  const chat = source('ModelChat.svelte');
  assert.ok(!chat.includes('captureStale'));
  const script = chat.slice(0, chat.indexOf('</script>'));
  assert.ok(!script.includes('controller.cancel()'), 'no automatic cancellation from capture/view lifecycle');
  assert.ok(chat.includes('onclick={() => controller.cancel()}'), 'explicit user Cancel remains available');
  assert.ok(!chat.includes('setInterval'));
  assert.match(chat, /const current = \(\) => alive && ticket === captureTicket && mode === scene\.mode;/);
  assert.ok(!chat.includes('source === visualSource'));
  assert.ok(!chat.includes('binding === JSON.stringify(scene)'));
  const crop = source('ScreenshotCrop.svelte');
  assert.ok(!crop.includes('stale'));
  assert.ok(!crop.includes('setInterval'));
  assert.match(chat, /cropCurrent = current;/, 'crop preparation checks lifecycle only, never live capture currency');
  assert.match(chat, /\$effect\(\(\) => controller\.bind\(scene\)\)/, 'current scene safety binding is retained');
  assert.match(chat, /const captureMode = \$derived\(scene\.mode\)/, 'primitive derived mode avoids scene-object identity retriggering image cleanup');
  assert.match(chat, /\$effect\(\(\) => \{ captureMode; untrack\(\(\) => removeAttachment\(\)\); \}\)/, 'explicit scene-mode switches still clear image input');
});

test('local observation export remains available when only live pixel grounding expires', () => {
  const panel = source('VisualObservationPanel.svelte');
  const download = panel.slice(panel.indexOf('  function download()'), panel.indexOf('  onMount('));
  assert.ok(download.includes('JSON.stringify(observation)'));
  assert.ok(!download.includes('stale'));
  assert.ok(!panel.includes('data-testid="download-visual" disabled'));
});
