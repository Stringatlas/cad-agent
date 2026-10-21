import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact, digest, requireData } from '../spatial/semantic-artifact';
import { getSemanticDiskIndex, recordBytes, type SemanticDiskIndex } from '../spatial/semantic-disk-index';

export type InstanceLabel = 4 | 6 | 7 | 8;
export interface InstanceClass { readonly label: InstanceLabel; readonly voxelMeters: number }
export const DEFAULT_INSTANCE_CLASSES: readonly InstanceClass[] = Object.freeze([
  { label: 6, voxelMeters: .25 }, { label: 7, voxelMeters: .5 }, { label: 8, voxelMeters: .35 },
]);
export const INSTANCE_LIMITS = Object.freeze({ maxCells: 500_000, maxMembershipBytes: 512 * 1024 * 1024,
  maxManifestBytes: 64 * 1024 * 1024, maxMilliseconds: 10 * 60 * 1000 });
export interface InstanceOptions {
  readonly classes?: readonly InstanceClass[];
  readonly limits?: Partial<Record<keyof typeof INSTANCE_LIMITS, number>>;
  readonly signal?: AbortSignal;
}
interface Cell { label: InstanceLabel; xyz: number[]; parent: number; count: number; file: number; row: number }
export interface SemanticInstance {
  readonly id: string; readonly label: InstanceLabel; readonly name: string; readonly points: number;
  readonly anchor: { readonly sourceFileId: number; readonly sourceRow: number };
}
export interface InstanceManifest {
  readonly version: 'semantic-instances-v1'; readonly complete: true;
  readonly binding: { readonly datasetId: string; readonly artifactRevision: string; readonly indexHash: string;
    readonly sourceHash: string; readonly frameId: 'toronto3d-local-v1'; readonly units: 'm';
    readonly coordinates: SemanticArtifact['dataset']['coordinates'] };
  readonly settings: { readonly algorithm: 'class-voxel-26-components-v1'; readonly gridOrigin: readonly number[]; readonly classes: readonly InstanceClass[] };
  readonly instances: readonly SemanticInstance[];
  readonly membership: { readonly file: 'memberships.bin'; readonly recordBytes: 16; readonly fields: readonly string[];
    readonly points: number; readonly bytes: number; readonly sha256: string };
  readonly statistics: { readonly cells: number; readonly selectedPoints: number; readonly totalSourcePoints: number };
}

/** Offline only. Caller owns snapshot lifetime; published directory must not already exist. */
export async function clusterSemanticInstances(snapshot: SemanticArtifact, index: SemanticDiskIndex,
  output: string, options: InstanceOptions = {}): Promise<InstanceManifest> {
  const classes = (options.classes ?? DEFAULT_INSTANCE_CLASSES).map(c => ({ ...c })).sort((a, b) => a.label - b.label);
  if (!classes.length || classes.some((c, i) => ![4, 6, 7, 8].includes(c.label) || !Number.isFinite(c.voxelMeters) ||
    c.voxelMeters < .001 || c.voxelMeters > 100 || (i > 0 && classes[i - 1].label === c.label))) throw new RangeError('Invalid instance classes/voxel size');
  const limits = { ...INSTANCE_LIMITS, ...options.limits };
  if (Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0) || limits.maxCells > 2_000_000 ||
    limits.maxManifestBytes > 256 * 1024 * 1024) throw new RangeError('Invalid instance budgets');
  const started = performance.now(), signal = options.signal;
  const checkpoint = () => { signal?.throwIfAborted(); if (performance.now() - started > limits.maxMilliseconds) throw new RangeError('Instance time budget exceeded'); };
  checkpoint();
  requireData(index.revision === snapshot.dataset.revision && index.totalPoints === snapshot.dataset.totalPoints, 'Instance index artifact mismatch');
  // Confirm this is the canonical index for this exact open source snapshot, not merely a matching revision string.
  requireData((await getSemanticDiskIndex(snapshot, signal)).index.hash === index.hash, 'Instance index identity mismatch');
  await snapshot.check(signal); await index.check(signal);
  const expectedPoints = classes.reduce((sum, c) => sum + index.counts[c.label], 0);
  if (expectedPoints * 16 > limits.maxMembershipBytes) throw new RangeError('Instance membership budget exceeded');
  const sizes = new Map(classes.map(c => [c.label as number, c.voxelMeters]));
  const cells: Cell[] = [], byKey = new Map<string, number>();
  const key = (label: number, xyz: readonly number[]) => `${label}:${xyz[0]},${xyz[1]},${xyz[2]}`;
  const voxel = (bytes: Buffer, at: number, size: number) => [0, 1, 2].map(axis => {
    const n = Math.floor(bytes.readDoubleLE(at + axis * 8) / size);
    requireData(Number.isSafeInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER - 2, 'Invalid instance voxel coordinate'); return n;
  });
  const root = (i: number): number => {
    let r = i; while (cells[r].parent !== r) r = cells[r].parent;
    while (cells[i].parent !== i) { const next = cells[i].parent; cells[i].parent = r; i = next; } return r;
  };
  const less = (a: Cell, b: Cell) => a.file < b.file || (a.file === b.file && a.row < b.row);
  const scan = async (visit: (bytes: Buffer, at: number, label: InstanceLabel, xyz: number[]) => void | Promise<void>) => {
    let matched = 0;
    for (const page of index.pages) {
      checkpoint();
      if (!classes.some(c => page.labels[c.label])) continue;
      const bytes = await index.readPage(page, signal);
      for (let at = 0; at < bytes.length; at += recordBytes) {
        const label = bytes.readUInt32LE(at + 36), size = sizes.get(label);
        if (size === undefined) continue;
        await visit(bytes, at, label as InstanceLabel, voxel(bytes, at, size)); matched++;
      }
      await yieldTurn();
    }
    requireData(matched === expectedPoints, 'Incomplete instance class coverage'); checkpoint();
  };
  await scan((bytes, at, label, xyz) => {
    const k = key(label, xyz), found = byKey.get(k), file = bytes.readUInt32LE(at + 24), row = bytes.readUInt32LE(at + 28);
    if (found === undefined) {
      if (cells.length >= limits.maxCells) throw new RangeError('Instance occupied-cell budget exceeded');
      byKey.set(k, cells.length); cells.push({ label, xyz, parent: cells.length, count: 1, file, row });
    } else { const c = cells[found]; c.count++; if (file < c.file || (file === c.file && row < c.row)) { c.file = file; c.row = row; } }
  });
  // At most 26 probes per occupied cell. Numeric-min anchor roots prevent order-dependent IDs.
  for (let i = 0; i < cells.length; i++) {
    if (i % 4096 === 0) { checkpoint(); await yieldTurn(); }
    const c = cells[i];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      if (!x && !y && !z) continue;
      const j = byKey.get(key(c.label, [c.xyz[0] + x, c.xyz[1] + y, c.xyz[2] + z]));
      if (j === undefined || j >= i) continue;
      const a = root(i), b = root(j); if (a !== b) { if (less(cells[a], cells[b])) cells[b].parent = a; else cells[a].parent = b; }
    }
  }
  const totals = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) { const r = root(i); totals.set(r, (totals.get(r) ?? 0) + cells[i].count); }
  const roots = [...totals.keys()].sort((a, b) => cells[a].label - cells[b].label || cells[a].file - cells[b].file || cells[a].row - cells[b].row);
  const binding: InstanceManifest['binding'] = { datasetId: snapshot.dataset.id, artifactRevision: index.revision,
    indexHash: index.hash, sourceHash: index.sourceHash, frameId: 'toronto3d-local-v1', units: 'm', coordinates: snapshot.dataset.coordinates };
  const settings: InstanceManifest['settings'] = { algorithm: 'class-voxel-26-components-v1', gridOrigin: [0, 0, 0], classes };
  const idBinding = digest(JSON.stringify({ binding, settings }));
  const instances: SemanticInstance[] = roots.map(r => ({ id: `instance-${digest(`${idBinding}:${cells[r].label}:${cells[r].file}:${cells[r].row}`)}`,
    label: cells[r].label, name: TORONTO_SEMANTIC_LABELS[cells[r].label], points: totals.get(r)!,
    anchor: { sourceFileId: cells[r].file, sourceRow: cells[r].row } }));
  // Bound even temporary JSON encoding; exact byte bound is checked again before publication.
  if (instances.length * 512 + 8192 > limits.maxManifestBytes) throw new RangeError('Instance manifest budget exceeded');
  const ordinals = new Map(roots.map((r, ordinal) => [r, ordinal]));
  output = resolve(output); await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output)); output = join(parent, basename(output));
  try { await lstat(output); throw new Error('Instance output already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const staging = await mkdtemp(join(parent, '.instances-building-'));
  try {
    const file = await open(join(staging, 'memberships.bin'), 'wx', 0o600), hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024), emitted = new Uint32Array(instances.length); let used = 0, written = 0;
    const flush = async () => {
      if (!used) return; const bytes = buffer.subarray(0, used); hash.update(bytes);
      let at = 0; while (at < bytes.length) { checkpoint(); const result = await file.write(bytes, at, bytes.length - at); requireData(result.bytesWritten > 0, 'Incomplete membership write'); at += result.bytesWritten; }
      written += used; used = 0;
    };
    try {
      await scan(async (bytes, at, label, xyz) => {
        const cell = byKey.get(key(label, xyz)); requireData(cell !== undefined, 'Instance cell changed');
        const ordinal = ordinals.get(root(cell)); requireData(ordinal !== undefined, 'Missing instance ordinal');
        buffer.writeUInt32LE(ordinal, used); bytes.copy(buffer, used + 4, at + 24, at + 36); used += 16; emitted[ordinal]++;
        if (used === buffer.length) await flush();
      });
      await flush(); await file.sync();
    } finally { await file.close(); }
    requireData(written === expectedPoints * 16 && instances.every((c, i) => c.points === emitted[i]), 'Incomplete instance membership output');
    const manifest: InstanceManifest = { version: 'semantic-instances-v1', complete: true, binding, settings, instances,
      membership: { file: 'memberships.bin', recordBytes: 16, fields: ['instanceOrdinal:u32le', 'sourceFileId:u32le', 'sourceRow:u32le', 'physicalRecord:u32le'],
        points: expectedPoints, bytes: written, sha256: hash.digest('hex') },
      statistics: { cells: cells.length, selectedPoints: expectedPoints, totalSourcePoints: index.totalPoints } };
    const encoded = JSON.stringify(manifest); if (Buffer.byteLength(encoded) > limits.maxManifestBytes) throw new RangeError('Instance manifest budget exceeded');
    await writeFile(join(staging, 'manifest.json'), encoded + '\n', { flag: 'wx', mode: 0o600 });
    await snapshot.check(signal); await index.check(signal); checkpoint();
    // Recheck destination: a concurrent nonempty publication causes rename to fail, never merge.
    try { await lstat(output); throw new Error('Instance output already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(staging, output); return manifest;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

/** Preparation may build the existing complete semantic cache; no source file is modified. */
export async function prepareSemanticInstances(datasetRoot: string, output: string, options: InstanceOptions = {}) {
  const snapshot = await SemanticArtifact.open(datasetRoot, options.signal);
  try { const { index } = await getSemanticDiskIndex(snapshot, options.signal); return await clusterSemanticInstances(snapshot, index, output, options); }
  finally { await snapshot.close(); }
}
