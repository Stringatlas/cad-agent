import {
  assertCoordinateMetadata,
  assertVec3,
  type CoordinateMetadata,
  type Entity,
  type ProjectState,
  type Vec3,
} from '@spatial/contracts';

/** Translation only: local and world frames share meter units and orientation. */
export function localToWorld(point: Vec3, coordinates: CoordinateMetadata): Vec3 {
  assertVec3(point);
  assertCoordinateMetadata(coordinates);
  return [
    point[0] + coordinates.localOrigin[0],
    point[1] + coordinates.localOrigin[1],
    point[2] + coordinates.localOrigin[2],
  ];
}

export function worldToLocal(point: Vec3, coordinates: CoordinateMetadata): Vec3 {
  assertVec3(point);
  assertCoordinateMetadata(coordinates);
  return [
    point[0] - coordinates.localOrigin[0],
    point[1] - coordinates.localOrigin[1],
    point[2] - coordinates.localOrigin[2],
  ];
}

export function resolveEntity(state: ProjectState, id: string): Entity | undefined {
  return state.entities.find((entity) => entity.id === id);
}

/** UI selection is not a geometry edit and deliberately preserves revision. */
export function selectEntity(state: ProjectState, id: string | null): ProjectState {
  if (id !== null && !resolveEntity(state, id)) throw new RangeError(`Unknown entity ID: ${id}`);
  return { ...state, selectedEntityId: id };
}
