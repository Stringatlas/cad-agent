import * as THREE from 'three';
import type { AreaCandidateResult } from '@spatial/contracts';

const LABEL_WIDTH = 52, LABEL_HEIGHT = 30, GAP = 8, MARGIN = 12;
export interface CandidateLabelBounds { x: number; y: number; width: number; height: number }
export interface CandidateLabelLayout {
  rank: number; text: string; selected: boolean;
  anchor: { x: number; y: number };
  x: number; y: number; width: number; height: number;
}

/** Screen-space annotation only. Never changes candidate/source coordinates. */
export function layoutCandidateLabels(anchors: { rank: number; x: number; y: number; selected: boolean }[], width: number, height: number, excluded: CandidateLabelBounds[] = []): CandidateLabelLayout[] {
  const placed: CandidateLabelLayout[] = [];
  for (const anchor of anchors) {
    const clampX = (x: number) => Math.max(MARGIN + LABEL_WIDTH / 2, Math.min(width - MARGIN - LABEL_WIDTH / 2, x));
    const clampY = (y: number) => Math.max(MARGIN + LABEL_HEIGHT / 2, Math.min(height - MARGIN - LABEL_HEIGHT / 2, y));
    const options: { x: number; y: number; distance: number }[] = [];
    // A bounded local grid gives deterministic placement even for coincident points
    // at viewport edges. Leaders preserve the true evidence location underneath.
    for (let dy = -anchors.length; dy <= anchors.length; dy++) for (let dx = -anchors.length; dx <= anchors.length; dx++) {
      const x = clampX(anchor.x + dx * (LABEL_WIDTH + GAP));
      const y = clampY(anchor.y - LABEL_HEIGHT - GAP + dy * (LABEL_HEIGHT + GAP));
      if (placed.some(p => Math.abs(p.x + p.width / 2 - x) < LABEL_WIDTH + GAP && Math.abs(p.y + p.height / 2 - y) < LABEL_HEIGHT + GAP)) continue;
      if (excluded.some(rect => x + LABEL_WIDTH / 2 + GAP > rect.x && x - LABEL_WIDTH / 2 - GAP < rect.x + rect.width && y + LABEL_HEIGHT / 2 + GAP > rect.y && y - LABEL_HEIGHT / 2 - GAP < rect.y + rect.height)) continue;
      options.push({ x, y, distance: Math.hypot(x - anchor.x, y - anchor.y) });
    }
    options.sort((a, b) => a.distance - b.distance);
    const best = options[0];
    if (!best) continue; // No room in a degenerate viewport; do not overlap labels.
    placed.push({ rank: anchor.rank, text: `C${anchor.rank}`, selected: anchor.selected, anchor: { x: anchor.x, y: anchor.y }, x: best.x - LABEL_WIDTH / 2, y: best.y - LABEL_HEIGHT / 2, width: LABEL_WIDTH, height: LABEL_HEIGHT });
  }
  return placed;
}

/** Disposable numbered POINT annotations; exact-position dots and leader endpoints stay at source coordinates. */
export function createAreaCandidateRender(scene: THREE.Scene) {
  const group = new THREE.Group(); group.name = 'area-candidate-points'; scene.add(group);
  const entries: { rank: number; selected: boolean; position: THREE.Vector3; label: THREE.Sprite; dot: THREE.Sprite; line: THREE.Line }[] = [];
  let layout: CandidateLabelLayout[] = [];
  const clear = () => {
    for (const child of [...group.children]) {
      if (child instanceof THREE.Sprite) { child.material.map?.dispose(); child.material.dispose(); }
      if (child instanceof THREE.Line) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); }
      group.remove(child);
    }
    entries.length = 0; layout = [];
  };
  return {
    get count() { return entries.length; },
    get layout() { return layout; },
    set(result?: Pick<AreaCandidateResult, 'candidates'> | { readonly marks: readonly { readonly id: string; readonly rank: number; readonly position: readonly [number, number, number] }[] }, selected?: string) {
      clear();
      for (const candidate of (result && 'marks' in result ? result.marks : result?.candidates) ?? []) {
        const isSelected = candidate.id === selected;
        const canvas = document.createElement('canvas'); canvas.width = 156; canvas.height = 90;
        const ctx = canvas.getContext('2d')!;
        ctx.beginPath(); ctx.roundRect(4, 4, 148, 82, 32); ctx.fillStyle = isSelected ? '#ffe5a3' : '#d9e5ff'; ctx.fill();
        ctx.strokeStyle = isSelected ? '#f5b63d' : '#ffffff'; ctx.lineWidth = isSelected ? 7 : 4; ctx.stroke();
        ctx.fillStyle = '#14254a'; ctx.font = 'bold 48px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`C${candidate.rank}`, 78, 47);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, sizeAttenuation: false }));
        label.renderOrder = 9;
        const dotCanvas = document.createElement('canvas'); dotCanvas.width = dotCanvas.height = 32;
        const dotContext = dotCanvas.getContext('2d')!;
        dotContext.beginPath(); dotContext.arc(16, 16, 11, 0, Math.PI * 2); dotContext.fillStyle = isSelected ? '#ffc64a' : '#b9cdff'; dotContext.fill(); dotContext.strokeStyle = '#14254a'; dotContext.lineWidth = 3; dotContext.stroke();
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(dotCanvas), depthTest: false, depthWrite: false, sizeAttenuation: false }));
        dot.position.set(...candidate.position); dot.renderOrder = 8;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([dot.position, dot.position]), new THREE.LineBasicMaterial({ color: isSelected ? '#ffc64a' : '#c8d8ff', depthTest: false, depthWrite: false }));
        line.renderOrder = 7; line.frustumCulled = false;
        group.add(line, dot, label);
        entries.push({ rank: candidate.rank, selected: isSelected, position: new THREE.Vector3(...candidate.position), label, dot, line });
      }
    },
    update(camera: THREE.PerspectiveCamera, width: number, height: number, excluded: CandidateLabelBounds[] = []) {
      camera.updateMatrixWorld(true);
      const projections = entries.map(entry => ({ entry, ndc: entry.position.clone().project(camera) }));
      const visible = projections.filter(({ ndc }) => Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && ndc.z >= -1 && ndc.z <= 1);
      layout = layoutCandidateLabels(visible.map(({ entry, ndc }) => ({ rank: entry.rank, selected: entry.selected, x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2 })), width, height, excluded);
      const pixelScale = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom / height;
      for (const { entry, ndc } of projections) {
        const box = layout.find(value => value.rank === entry.rank);
        entry.label.visible = entry.dot.visible = entry.line.visible = !!box;
        if (!box) continue;
        const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        entry.label.position.set(center.x / width * 2 - 1, 1 - center.y / height * 2, ndc.z).unproject(camera);
        entry.label.scale.set(LABEL_WIDTH * pixelScale, LABEL_HEIGHT * pixelScale, 1);
        entry.dot.scale.set(10 * pixelScale, 10 * pixelScale, 1);
        // Stop at the nearest label edge, not beneath its text. First endpoint is
        // always the exact candidate position, independent of camera/decluttering.
        const edge = new THREE.Vector3(Math.max(box.x, Math.min(box.x + box.width, box.anchor.x)) / width * 2 - 1, 1 - Math.max(box.y, Math.min(box.y + box.height, box.anchor.y)) / height * 2, ndc.z).unproject(camera);
        const attribute = entry.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        attribute.setXYZ(0, entry.position.x, entry.position.y, entry.position.z); attribute.setXYZ(1, edge.x, edge.y, edge.z); attribute.needsUpdate = true;
        entry.label.updateMatrixWorld(true); entry.dot.updateMatrixWorld(true);
      }
    },
    dispose() { clear(); scene.remove(group); },
  };
}
