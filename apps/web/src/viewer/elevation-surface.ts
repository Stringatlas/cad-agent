import * as THREE from 'three';
import type { ElevationGrid } from '@spatial/contracts';

export function elevationColor(value: number, minimum: number, maximum: number): THREE.Color {
  return new THREE.Color().setHSL(.65 * (1 - Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-9, maximum - minimum)))), .6, .55);
}
/** Library-rendered raster cells: holes remain absent; no inferred triangles across missing ground. */
export function createElevationSurface(grid: ElevationGrid) {
  if (grid.values.length !== grid.width * grid.height || grid.values.length > 65536) throw new Error('Invalid elevation mesh size');
  const range = grid.info.layers[grid.layer], low = range.min ?? 0, high = range.max ?? 0;
  const columns = Math.max(2, grid.width), rows = Math.max(2, grid.height);
  const [dx, dy] = grid.cellSize;
  const geometry = new THREE.PlaneGeometry(grid.width === 1 ? dx : (grid.width - 1) * dx,
    grid.height === 1 ? dy : (grid.height - 1) * dy, columns - 1, rows - 1);
  geometry.translate(grid.origin[0] + grid.width * dx / 2, grid.origin[1] - grid.height * dy / 2, 0);
  const position = geometry.getAttribute('position'), colors = new Float32Array(position.count * 3);
  const valid = new Uint8Array(position.count);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const at = row * columns + column, z = grid.values[Math.min(row, grid.height - 1) * grid.width + Math.min(column, grid.width - 1)];
    if (z === null) continue;
    if (!Number.isFinite(z)) throw new Error('Invalid raster elevation');
    valid[at] = 1; position.setZ(at, z); elevationColor(z, low, high).toArray(colors, at * 3);
  }
  // PlaneGeometry owns tessellation. Retain a quad only when all four observed centers exist.
  const source = geometry.getIndex()!, indices: number[] = [];
  for (let at = 0; at < source.count; at += 6) {
    let supported = true;
    for (let i = 0; i < 6; i++) if (!valid[source.getX(at + i)]) supported = false;
    if (supported) for (let i = 0; i < 6; i++) indices.push(source.getX(at + i));
  }
  geometry.setIndex(indices); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = `${grid.layer}-raster`;
  return { mesh, dispose() { geometry.dispose(); material.dispose(); } };
}
