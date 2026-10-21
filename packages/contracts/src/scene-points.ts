/** Retained source references per scene; names are not reused after removal. */
export const SCENE_POINT_LIMIT = 32;
export type ScenePointName = `Point ${number}`;
/** Exact positive safe-integer decimal spelling, without leading zeros. */
export function canonicalScenePointName(value: unknown): ScenePointName {
  if (typeof value !== 'string' || !/^Point [1-9][0-9]{0,15}$/u.test(value) || !Number.isSafeInteger(Number(value.slice(6)))) {
    throw new TypeError('Expected Point followed by a positive safe integer');
  }
  return value as ScenePointName;
}
