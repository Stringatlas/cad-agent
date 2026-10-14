import type { CadOperation, CadResult, CadSource } from '@spatial/contracts';

/** Kernel-independent solid sandbox. IDs belong to this instance, never ProjectState. */
export interface CadAdapter {
  readonly source: CadSource;
  execute(operation: CadOperation): Promise<CadResult>;
  dispose(): void | Promise<void>;
}
