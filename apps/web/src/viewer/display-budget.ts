import { DEFAULT_ADAPTIVE_POINTS, MAX_ADAPTIVE_POINTS } from './adaptive-plan';

export const MIN_DISPLAY_POINTS = 65_536;
export const DISPLAY_BUDGET_KEYS = { cloud: 'spatial.display.pointBudget.cloud.v1', toronto: 'spatial.display.pointBudget.toronto.v1' } as const;
export function validDisplayBudget(value: number): boolean {
  return Number.isSafeInteger(value) && value >= MIN_DISPLAY_POINTS && value <= MAX_ADAPTIVE_POINTS;
}
export function readDisplayBudget(key: string, storage?: Pick<Storage, 'getItem'>): number {
  try {
    const value = Number((storage ?? globalThis.localStorage)?.getItem(key));
    return validDisplayBudget(value) ? value : DEFAULT_ADAPTIVE_POINTS;
  } catch { return DEFAULT_ADAPTIVE_POINTS; }
}
export function saveDisplayBudget(key: string, value: number, storage?: Pick<Storage, 'setItem'>): boolean {
  if (!validDisplayBudget(value)) throw new RangeError('Invalid display point budget');
  try { (storage ?? globalThis.localStorage).setItem(key, String(value)); return true; }
  catch { return false; }
}
