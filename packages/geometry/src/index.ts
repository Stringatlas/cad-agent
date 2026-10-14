export type { CadAdapter } from './cad';
import { assertBoxEntity, type BoxEntity, type Entity, type Vec3 } from '@spatial/contracts';

/** Axis-aligned bounds in the same local frame and meter units as the entity. */
export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Geometry access boundary; concrete adapters must not leak viewer or kernel types. */
export interface GeometryAdapter {
  bounds(entity: Entity): Bounds3;
}

/** Analytic proposal bounds only. This does not create or verify a CAD solid. */
export function boxBounds(box: BoxEntity): Bounds3 {
  assertBoxEntity(box);
  return {
    min: [
      box.center[0] - box.dimensions[0] / 2,
      box.center[1] - box.dimensions[1] / 2,
      box.center[2] - box.dimensions[2] / 2,
    ],
    max: [
      box.center[0] + box.dimensions[0] / 2,
      box.center[1] + box.dimensions[1] / 2,
      box.center[2] + box.dimensions[2] / 2,
    ],
  };
}
