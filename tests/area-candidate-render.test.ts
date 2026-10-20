import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { AreaCandidateResult } from '@spatial/contracts';
import { createAreaCandidateRender, layoutCandidateLabels } from '../apps/web/src/area-candidate-render';

for (const count of [5, 7, 20]) {
  test(`mobile shortlist exclusion leaves all ${count} labels visible above the panel`, () => {
    const boxes = layoutCandidateLabels(Array.from({ length: count }, (_, i) => ({ rank: i + 1, x: 25 + i, y: 410, selected: false })), 390, 786, [{ x: 18, y: 420, width: 360, height: 366 }]);
    assert.equal(boxes.length, count);
    assert.ok(boxes.every(box => box.y + box.height <= 412));
  });
}

for (const count of [5, 7, 20]) test(`render-only decluttering preserves ${count} exact point dots and leader origins for live/capture cameras`, () => {
  const originalDocument = globalThis.document;
  const context = { beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {}, arc() {} };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } as unknown as Document;
  try {
    const scene = new THREE.Scene(), renderer = createAreaCandidateRender(scene);
    const positions = Array.from({ length: count }, (_, i) => [(i + 1) * 2, 0, 0]);
    const result = { candidates: positions.map((position, i) => ({ id: `candidate-${i + 1}`, rank: i + 1, position })) } as unknown as AreaCandidateResult;
    const before = JSON.stringify(result);
    renderer.set(result, 'candidate-3');
    assert.equal(renderer.count, count, 'count is candidates, not lines/dots/sprites');
    for (const cameraPosition of [[10, -100, 60], [10, 0, 100]]) {
      const camera = new THREE.PerspectiveCamera(45, 390 / 786, .1, 1000);
      camera.position.set(...cameraPosition as [number, number, number]); camera.lookAt(10, 0, 0);
      renderer.update(camera, 390, 786);
      assert.equal(renderer.layout.length, count);
      const lines = scene.children[0].children.filter(child => child instanceof THREE.Line) as THREE.Line[];
      const dots = scene.children[0].children.filter(child => child instanceof THREE.Sprite && child.renderOrder === 8);
      for (let i = 0; i < count; i++) {
        assert.deepEqual(dots[i].position.toArray(), positions[i]);
        const attribute = lines[i].geometry.getAttribute('position');
        assert.deepEqual([attribute.getX(0), attribute.getY(0), attribute.getZ(0)], positions[i], 'leader origin stays at true candidate coordinate');
      }
    }
    assert.equal(JSON.stringify(result), before);
    renderer.dispose(); assert.equal(scene.children.length, 0);
  } finally { globalThis.document = originalDocument; }
});

for (const count of [5, 7, 20]) for (const [width, height] of [[1440, 900], [390, 520]]) {
  for (const [x, y] of [[0, 0], [width / 2, height / 2], [width, height]]) {
    test(`${count} coincident labels stay readable at ${x},${y} in ${width}×${height}`, () => {
      const anchors = Array.from({ length: count }, (_, i) => ({ rank: i + 1, x, y, selected: i === 2 }));
      const boxes = layoutCandidateLabels(anchors, width, height);
      assert.deepEqual(boxes.map(box => box.text), anchors.map(anchor => `C${anchor.rank}`));
      assert.equal(boxes.filter(box => box.selected).length, 1);
      for (const box of boxes) {
        assert.deepEqual(box.anchor, { x, y }, 'screen annotation does not move evidence anchor');
        assert.ok(box.x >= 12 && box.y >= 12 && box.x + box.width <= width - 12 && box.y + box.height <= height - 12);
        for (const other of boxes.filter(other => other.rank !== box.rank)) {
          assert.ok(box.x + box.width <= other.x || other.x + other.width <= box.x || box.y + box.height <= other.y || other.y + other.height <= box.y, 'label rectangles must not overlap');
        }
      }
      assert.deepEqual(layoutCandidateLabels(anchors, width, height), boxes, 'layout is deterministic');
    });
  }
}
