import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCameraFlight } from '../../apps/web/src/viewer/camera-flight';
import { updateStableOrbitControls } from '../../apps/web/src/viewer/orbit-stability';

class DocumentMock extends EventTarget {
  defaultView = new EventTarget();
  activeElement: unknown = null;
  hidden = false;
}
class CanvasMock extends EventTarget {
  attributes = new Map<string, string>();
  lastFocusOptions: FocusOptions | undefined;
  constructor(readonly ownerDocument: DocumentMock) { super(); }
  // Node's EventTarget does not consistently match boolean capture on removal;
  // normalize both sides to DOM-equivalent option objects for this DOM mock.
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions) {
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1); }
  set tabIndex(value: number) { this.setAttribute('tabindex', String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus(options?: FocusOptions) { this.lastFocusOptions = options; this.ownerDocument.activeElement = this; }
}
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string,
  extras: Partial<KeyboardEvent> = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: code.replace('Key', '').toLowerCase(), ...extras });
  target.dispatchEvent(event);
  return event;
}
function fixture(options: { speed?: number; tabIndex?: string; pitched?: boolean } = {}) {
  const doc = new DocumentMock(), canvas = new CanvasMock(doc);
  if (options.tabIndex !== undefined) canvas.setAttribute('tabindex', options.tabIndex);
  const camera = new PerspectiveCamera(45, 1, 0.1, 10_000);
  camera.up.set(0, 0, 1);
  camera.position.set(6, -8, options.pitched === false ? 0 : 6);
  const controls = new OrbitControls(camera, null);
  controls.enableDamping = true;
  controls.update();
  let invalidations = 0, available = true;
  const flight = createCameraFlight(canvas as unknown as HTMLCanvasElement, camera, controls,
    options.speed ?? 10, () => invalidations++, () => available);
  canvas.focus();
  return { doc, canvas, camera, controls, flight,
    get invalidations() { return invalidations; },
    setAvailable(value: boolean) { available = value; },
    down(code: string, extras: Partial<KeyboardEvent> = {}) { return key(canvas, 'keydown', code, extras); },
    up(code: string) { return key(doc.defaultView, 'keyup', code); },
  };
}
function close(actual: Vector3, expected: Vector3, message?: string) {
  assert.ok(actual.distanceTo(expected) < 1e-10,
    `${message ?? 'vector mismatch'}: ${actual.toArray()} vs ${expected.toArray()}`);
}
function advance(f: ReturnType<typeof fixture>, start = 0, end = 50) {
  assert.equal(f.flight.update(start), false, 'first frame only establishes time');
  assert.equal(f.flight.update(end), true);
}

for (const [code, local] of [
  ['KeyW', new Vector3(0, 1, 0)], ['KeyS', new Vector3(0, -1, 0)],
  ['KeyA', new Vector3(-1, 0, 0)], ['KeyD', new Vector3(1, 0, 0)],
] as const) {
  test(`${code} uses camera yaw without changing elevation and translates the target equally`, () => {
    const f = fixture(), before = f.camera.position.clone(), target = f.controls.target.clone();
    const quaternion = f.camera.quaternion.clone();
    assert.equal(f.down(code).defaultPrevented, true);
    advance(f);
    const right = new Vector3(0.8, 0.6, 0), forward = new Vector3(-0.6, 0.8, 0);
    const delta = right.multiplyScalar(local.x).addScaledVector(forward, local.y).multiplyScalar(0.5);
    close(f.camera.position.clone().sub(before), delta);
    close(f.controls.target.clone().sub(target), delta);
    assert.ok(f.camera.quaternion.angleTo(quaternion) < 1e-7);
    close(new Vector3().setFromMatrixPosition(f.camera.matrixWorld), f.camera.position);
    assert.equal(delta.z, 0, 'world XY movement preserves elevation');
    assert.equal(f.invalidations, 1);
    f.flight.dispose();
  });
}

test('yaw follows rotated views at varied pitches, including straight down', () => {
  for (const pitch of [0, 0.7, Math.PI / 2]) {
    const f = fixture();
    f.camera.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1.1)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2 - pitch));
    const before = f.camera.position.clone();
    f.down('KeyW'); advance(f);
    close(f.camera.position.clone().sub(before), new Vector3(-Math.sin(1.1), Math.cos(1.1), 0).multiplyScalar(0.5));
    assert.equal(f.camera.position.z, before.z);
    f.flight.dispose();
  }
});

test('diagonals normalize, opposing keys cancel, repeats do not accelerate, and keyup releases independently', () => {
  const f = fixture(), before = f.camera.position.clone();
  f.down('KeyW'); f.down('KeyW', { repeat: true }); f.down('KeyD');
  advance(f);
  const expected = new Vector3(0.2, 1.4, 0).normalize().multiplyScalar(0.5);
  close(f.camera.position.clone().sub(before), expected);
  assert.ok(Math.abs(f.camera.position.distanceTo(before) - 0.5) < 1e-10);
  f.down('KeyS'); f.down('KeyA');
  const stopped = f.camera.position.clone();
  assert.equal(f.flight.update(100), false);
  close(f.camera.position, stopped);
  assert.equal(f.invalidations, 1);
  f.up('KeyW'); f.up('KeyS'); f.up('KeyA');
  assert.equal(f.flight.update(150), true, 'D is still held');
  f.up('KeyD');
  assert.equal(f.flight.update(200), false);
  f.down('KeyW');
  assert.equal(f.flight.update(10_000), false, 'all-key release resets clock');
  assert.equal(f.invalidations, 2);
  f.flight.dispose();
});

test('equal wall-clock duration produces equal displacement at 30, 60 and 120 fps', () => {
  for (const fps of [30, 60, 120]) {
    const f = fixture(), before = f.camera.position.clone();
    f.down('KeyW');
    assert.equal(f.flight.update(0), false);
    for (let frame = 1; frame <= fps; frame++) assert.equal(f.flight.update(frame * 1000 / fps), true);
    close(f.camera.position.clone().sub(before), new Vector3(-6, 8, 0));
    assert.equal(f.invalidations, fps);
    f.flight.dispose();
  }
});

test('long frames clamp to 50 ms and zero/backwards timestamps never move or invalidate', () => {
  const f = fixture(), before = f.camera.position.clone();
  f.down('KeyW');
  assert.equal(f.flight.update(100), false);
  assert.equal(f.flight.update(100), false);
  assert.equal(f.flight.update(90), false);
  assert.equal(f.invalidations, 0);
  assert.equal(f.flight.update(10_000), true);
  assert.ok(Math.abs(f.camera.position.distanceTo(before) - 0.5) < 1e-10);
  assert.equal(f.flight.update(10_010), true);
  assert.ok(Math.abs(f.camera.position.distanceTo(before) - 0.6) < 1e-10);
  assert.equal(f.invalidations, 2);
  f.flight.dispose();
});

test('flight preserves orbit distance, idle stability, and subsequent installed orbit behavior', () => {
  const f = fixture(), offset = f.camera.position.clone().sub(f.controls.target);
  f.down('KeyW'); advance(f); f.up('KeyW');
  close(f.camera.position.clone().sub(f.controls.target), offset);
  // The first controls update acknowledges flight's real movement (its change
  // event is true), and may round-trip the pose at floating-point precision.
  const translated = f.camera.position.clone();
  updateStableOrbitControls(f.camera, f.controls);
  close(f.camera.position, translated, 'first orbit update preserves flight pose');
  const before = f.camera.position.clone(), target = f.controls.target.clone();
  for (let frame = 0; frame < 120; frame++) {
    updateStableOrbitControls(f.camera, f.controls);
    assert.equal(f.flight.update(100 + frame * 16), false);
  }
  assert.deepEqual(f.camera.position.toArray(), before.toArray());
  assert.deepEqual(f.controls.target.toArray(), target.toArray());
  assert.equal(f.invalidations, 1);
  const referenceCamera = f.camera.clone(), reference = new OrbitControls(referenceCamera, null);
  reference.target.copy(f.controls.target); reference.enableDamping = true; reference.update();
  for (const controls of [f.controls, reference]) {
    (controls as unknown as { _sphericalDelta: Spherical })._sphericalDelta.theta = 0.1;
  }
  for (let frame = 0; frame < 10; frame++) {
    updateStableOrbitControls(f.camera, f.controls); reference.update();
    close(f.camera.position, referenceCamera.position);
    close(f.controls.target, reference.target);
  }
  assert.ok(f.camera.position.distanceTo(before) > 0.1, 'orbit remains functional');
  f.flight.dispose();
});

for (const [label, extras] of [
  ['control', { ctrlKey: true }], ['command', { metaKey: true }], ['alt', { altKey: true }],
  ['shift', { shiftKey: true }], ['composition', { isComposing: true }], ['escape', { key: 'Escape' }],
] as const) {
  test(`${label} is not intercepted and resets held navigation`, () => {
    const f = fixture(); f.down('KeyW'); advance(f);
    const before = f.camera.position.clone();
    assert.equal(f.down('KeyD', extras).defaultPrevented, false);
    assert.equal(f.flight.update(100), false);
    close(f.camera.position, before);
    f.down('KeyW');
    assert.equal(f.flight.update(200), false);
    assert.equal(f.flight.update(250), true);
    f.flight.dispose();
  });
}

test('text-input/non-canvas focus is safe, unrelated keys are not intercepted, pointerdown focuses without scrolling', () => {
  const f = fixture();
  f.doc.activeElement = { tagName: 'INPUT' };
  assert.equal(f.down('KeyW').defaultPrevented, false);
  assert.equal(f.flight.update(0), false);
  assert.equal(f.flight.update(50), false);
  assert.equal(f.invalidations, 0);
  f.canvas.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.doc.activeElement, f.canvas);
  assert.deepEqual(f.canvas.lastFocusOptions, { preventScroll: true });
  assert.equal(f.down('KeyQ').defaultPrevented, false);
  assert.equal(f.flight.update(100), false);
  f.down('KeyW'); advance(f, 150, 200);
  f.flight.dispose();
});

for (const reason of ['canvas blur', 'window blur', 'visibility', 'hidden', 'disabled', 'unavailable', 'focus loss', 'explicit'] as const) {
  test(`${reason} resets held keys and timing until a fresh keydown`, () => {
    const f = fixture(); f.down('KeyW'); advance(f);
    const before = f.camera.position.clone();
    switch (reason) {
      case 'canvas blur': f.canvas.dispatchEvent(new Event('blur')); break;
      case 'window blur': f.doc.defaultView.dispatchEvent(new Event('blur')); break;
      case 'visibility': f.doc.dispatchEvent(new Event('visibilitychange')); break;
      case 'hidden': f.doc.hidden = true; break;
      case 'disabled': f.controls.enabled = false; break;
      case 'unavailable': f.setAvailable(false); break;
      case 'focus loss': f.doc.activeElement = null; break;
      case 'explicit': f.flight.reset(); break;
    }
    assert.equal(f.flight.update(100), false);
    f.doc.hidden = false; f.controls.enabled = true; f.setAvailable(true); f.canvas.focus();
    assert.equal(f.flight.update(10_000), false, 'restoring eligibility must not resume a stale key');
    close(f.camera.position, before);
    assert.equal(f.invalidations, 1);
    f.down('KeyW');
    assert.equal(f.flight.update(20_000), false, 'fresh input must not reuse old timestamp');
    assert.equal(f.flight.update(20_050), true);
    f.flight.dispose();
  });
}

for (const tabIndex of [undefined, '-1', '5']) {
  test(`dispose removes all event listeners, stops movement and restores tabindex ${tabIndex ?? '(absent)'}`, () => {
    const f = fixture({ tabIndex });
    const removed: Array<[string, EventListenerOrEventListenerObject | null, boolean | EventListenerOptions | undefined]> = [];
    for (const target of [f.canvas, f.doc, f.doc.defaultView]) {
      const original = target.removeEventListener.bind(target);
      target.removeEventListener = (type, listener, options) => {
        removed.push([type, listener, options]); original(type, listener, options);
      };
    }
    assert.equal(f.canvas.tabIndex, 0);
    f.down('KeyW'); advance(f);
    const before = f.camera.position.clone();
    f.flight.dispose();
    assert.equal(f.canvas.getAttribute('tabindex'), tabIndex ?? null);
    assert.deepEqual(removed.map(([type]) => type).sort(),
      ['pointerdown', 'keydown', 'blur', 'keyup', 'blur', 'visibilitychange'].sort());
    assert.equal(removed.find(([type]) => type === 'pointerdown')?.[2], true, 'capture listener is removed in capture phase');
    f.doc.activeElement = null;
    f.canvas.dispatchEvent(new Event('pointerdown'));
    assert.equal(f.doc.activeElement, null, 'disposed pointer listener does not steal focus');
    f.canvas.focus();
    assert.equal(f.down('KeyW').defaultPrevented, false, 'disposed key handler no longer intercepts');
    assert.equal(f.flight.update(100), false);
    close(f.camera.position, before);
    assert.equal(f.invalidations, 1);
    f.flight.dispose();
  });
}
