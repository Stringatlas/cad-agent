import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { PREPARED_ASSETS, assertPreparedArtifactIdentity, canonicalProtocolJson, protocolToken, protocolInteger,
  type PreparedArtifactIdentity } from '@spatial/contracts';
import { parseRunEvidence, type ArtifactVerification, type RunEvidence } from '@spatial/agent-harness';
import { PotreeDataset } from './potree';

export const ARTIFACT_DIGEST_CHUNK_BYTES = 64 * 1024;
export const sha256Protocol = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export class ArtifactEvidenceFailure extends Error {
  constructor(readonly code: 'missing' | 'mismatch' | 'cancelled') { super(code); }
}
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function assetStat(path: string) {
  if (await realpath(path) !== path) throw new ArtifactEvidenceFailure('mismatch');
  const stat = await lstat(path);
  if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new ArtifactEvidenceFailure('mismatch');
  return stat;
}
/** Explicit offline/pre-run pass. Fixed names only, constant-size chunks, no whole-cloud allocation. */
export async function prepareArtifactEvidence(directory: string, signal?: AbortSignal): Promise<PreparedArtifactIdentity> {
  try {
    signal?.throwIfAborted();
    const root = await realpath(resolve(directory)), dataset = new PotreeDataset(root);
    const beforeInfo = await dataset.info();
    const before = await Promise.all(PREPARED_ASSETS.map(name => assetStat(join(root, name))));
    const assets: PreparedArtifactIdentity['assets'][number][] = [], buffer = Buffer.alloc(ARTIFACT_DIGEST_CHUNK_BYTES);
    for (let i = 0; i < PREPARED_ASSETS.length; i++) {
      signal?.throwIfAborted();
      const name = PREPARED_ASSETS[i], path = join(root, name), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!same(before[i], await file.stat())) throw new ArtifactEvidenceFailure('mismatch');
        const hash = createHash('sha256'); let at = 0;
        while (at < before[i].size) {
          signal?.throwIfAborted();
          const length = Math.min(buffer.length, before[i].size - at), { bytesRead } = await file.read(buffer, 0, length, at);
          if (bytesRead !== length) throw new ArtifactEvidenceFailure('mismatch');
          hash.update(buffer.subarray(0, bytesRead)); at += bytesRead;
          await yieldTurn(); signal?.throwIfAborted();
        }
        if (!same(before[i], await file.stat()) || !same(before[i], await assetStat(path))) throw new ArtifactEvidenceFailure('mismatch');
        assets.push({ name, size: before[i].size, sha256: hash.digest('hex') });
      } finally { await file.close(); }
    }
    for (let i = 0; i < PREPARED_ASSETS.length; i++) {
      signal?.throwIfAborted(); if (!same(before[i], await assetStat(join(root, PREPARED_ASSETS[i])))) throw new ArtifactEvidenceFailure('mismatch');
    }
    const afterInfo = await dataset.info(); signal?.throwIfAborted();
    if (beforeInfo.revision !== afterInfo.revision) throw new ArtifactEvidenceFailure('mismatch');
    return { revision: afterInfo.revision, digest: sha256Protocol(canonicalProtocolJson(assets)), assets };
  } catch (error) {
    if (signal?.aborted) throw new ArtifactEvidenceFailure('cancelled');
    if (error instanceof ArtifactEvidenceFailure) throw error;
    throw new ArtifactEvidenceFailure(['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') ? 'missing' : 'mismatch');
  }
}
export async function verifyArtifactEvidence(directory: string, expected: PreparedArtifactIdentity, signal?: AbortSignal): Promise<ArtifactVerification> {
  try {
    assertPreparedArtifactIdentity(expected);
    const actual = await prepareArtifactEvidence(directory, signal);
    return canonicalProtocolJson(actual) === canonicalProtocolJson(expected) ? 'matched' : 'mismatch';
  } catch (error) { return error instanceof ArtifactEvidenceFailure ? error.code : 'mismatch'; }
}

/** Operator-only persistence. The constructor directory is trusted configuration, not a tool argument. */
export class RunEvidenceStore {
  constructor(private readonly directory: string, private readonly maxBytes = 4 * 1024 * 1024) {
    protocolInteger(maxBytes, 4 * 1024 * 1024); if (!maxBytes) throw new TypeError('Empty persistence budget');
  }
  private async root() {
    const path = resolve(this.directory);
    if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error('Invalid evidence store');
    return path;
  }
  async save(id: string, text: string): Promise<void> {
    protocolToken(id); parseRunEvidence(text, sha256Protocol, this.maxBytes);
    const root = await this.root(), path = join(root, `${id}.json`), temporary = join(root, `.evidence-${randomUUID()}.tmp`);
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      try { await file.writeFile(text, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, path);
      const directory = await open(root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw new Error('Evidence save failed'); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async load(id: string): Promise<string> {
    protocolToken(id); const path = join(await this.root(), `${id}.json`), before = await assetStat(path);
    if (before.size > this.maxBytes) throw new Error('Oversized persisted evidence');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!same(before, await file.stat())) throw new Error('Changed persisted evidence');
      const buffer = Buffer.alloc(before.size);
      if ((await file.read(buffer, 0, buffer.length, 0)).bytesRead !== buffer.length || !same(before, await file.stat()) || !same(before, await assetStat(path))) throw new Error('Changed persisted evidence');
      const text = buffer.toString('utf8'); parseRunEvidence(text, sha256Protocol, this.maxBytes); return text;
    } finally { await file.close(); }
  }
  async read(id: string): Promise<RunEvidence> { return parseRunEvidence(await this.load(id), sha256Protocol, this.maxBytes); }
}
