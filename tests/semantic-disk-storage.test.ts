import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, open, readdir, rename, symlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TORONTO_SEMANTIC_LABELS } from '@spatial/contracts';
import { SemanticArtifact, digest, SEMANTIC_LIMITS } from '../apps/server/src/semantic-artifact';
import { getSemanticDiskIndex, loadPreparedSemanticDiskIndex, dropSemanticDiskIndexMemoryCache, recordBytes, pagePoints, cacheRoot,
  semanticDiskMemoryBudget, type SemanticDiskIndex } from '../apps/server/src/semantic-disk-index';

type Point = { xyz: [number, number, number]; file: number; row: number; label: number };
async function fixture(size = 37, mutate?: (points: Point[]) => void) {
  const root = await mkdtemp(join(tmpdir(), 'spatial-semantic-storage-test-')), caches = new Set<string>();
  const rows = [0, 0, 0, 0], points: Point[] = Array.from({ length: size }, (_, i) => {
    const file = i % 4 + 1; return { xyz: [(i % 117) * .001, -(i % 93) * .001, 120 + (i % 71) * .001], file, row: rows[file - 1]++, label: i % 9 };
  });
  // Non-monotonic physical order deliberately differs from source-row order.
  points.reverse(); mutate?.(points);
  const metadata = { version: '2.0', encoding: 'UNCOMPRESSED', points: points.length, hierarchy: { firstChunkSize: 22 },
    boundingBox: { min: [-100, -100, 100], max: [100, 100, 140] }, scale: [.001, .001, .001], offset: [0, 0, 120], attributes: [
      { name: 'position', type: 'int32', size: 12, min: [-100, -100, 100], max: [100, 100, 140] },
      { name: 'rgb', type: 'uint16', size: 6 }, { name: 'point source id', type: 'uint16', size: 2 },
      { name: 'source_row', type: 'uint32', size: 4 }, { name: 'scalar_Label', type: 'float', size: 4 } ] };
  const payload = Buffer.alloc(points.length * 28);
  points.forEach((p, i) => {
    p.xyz.forEach((n, axis) => payload.writeInt32LE(Math.round((n - metadata.offset[axis]) * 1000), i * 28 + axis * 4));
    payload.writeUInt16LE(p.file, i * 28 + 18); payload.writeUInt32LE(p.row, i * 28 + 20); payload.writeFloatLE(p.label, i * 28 + 24);
  });
  const hierarchy = Buffer.alloc(22); hierarchy[0] = 1; hierarchy.writeUInt32LE(points.length, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length), 14);
  const manifest = { units: 'm', frame: 'right-handed Z-up', local_origin_world: [627285, 4841948, 0], potree_scale_m: metadata.scale,
    semantic_attribute: 'scalar_Label', semantic_classes: TORONTO_SEMANTIC_LABELS,
    sources: rows.map((count, i) => ({ source_file_id: i + 1, file: `L00${i + 1}.ply`, points: count })) };
  await mkdir(join(root, 'octree')); await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'octree/metadata.json'), JSON.stringify(metadata)); await writeFile(join(root, 'octree/hierarchy.bin'), hierarchy); await writeFile(join(root, 'octree/octree.bin'), payload);
  const snapshots: SemanticArtifact[] = [];
  return { root, points, payload, metadata, hierarchy,
    async snapshot() { const s = await SemanticArtifact.open(root); snapshots.push(s); return s; },
    async index(s: SemanticArtifact) { const result = await getSemanticDiskIndex(s); caches.add(result.index.directory); return result; },
    async clean() { dropSemanticDiskIndexMemoryCache(); await Promise.all(snapshots.map(s => s.close())); await rm(root, { recursive: true, force: true }); await Promise.all([...caches].map(c => rm(c, { recursive: true, force: true }))); } };
}
async function changeByte(path: string, at = 0) {
  const file = await open(path, 'r+');
  try { const byte = Buffer.alloc(1); await file.read(byte, 0, 1, at); byte[0] ^= 1; await file.write(byte, 0, 1, at); } finally { await file.close(); }
}
async function rehashHeader(index: SemanticDiskIndex, mutate: (header: any) => void) {
  const path = join(index.directory, 'index.json'), header = JSON.parse((await readFile(path)).toString()); mutate(header);
  const { hash: _hash, ...body } = header; header.hash = digest(JSON.stringify(body)); await writeFile(path, JSON.stringify(header));
}
const corrupt = { code: 'corrupt-data' };

test('disk pages encode every label once in physical order; exact binary64 bounds/provenance; warm reuse does not scan source', async () => {
  const f = await fixture(pagePoints * 2 + 19);
  try {
    const s = await f.snapshot(), prepared = await f.index(s), { index } = prepared;
    assert.equal(prepared.cache, 'built'); assert.equal(index.totalPoints, f.points.length); assert.equal(recordBytes, 40);
    assert.equal(semanticDiskMemoryBudget, 96 * 1024 * 1024); assert.equal(index.pages.length, 3); assert.equal(s.sourceReads.payloadBytes, f.payload.length);
    assert.ok(s.sourceReads.maxReadBytes <= SEMANTIC_LIMITS.readBytes); assert.equal(index.sourceHash, digest(f.payload));
    const counts = Array<number>(9).fill(0);
    for (const page of index.pages) {
      const bytes = await index.readPage(page); assert.equal(bytes.length, page.count * recordBytes);
      const summaries = Array.from({ length: 9 }, () => ({ count: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
      for (let n = 0; n < page.count; n++) {
        const physical = page.start + n, p = f.points[physical], at = n * recordBytes, src = physical * 28;
        const xyz = [0, 1, 2].map(axis => f.payload.readInt32LE(src + axis * 4) * .001 + f.metadata.offset[axis]);
        assert.deepEqual([bytes.readDoubleLE(at), bytes.readDoubleLE(at + 8), bytes.readDoubleLE(at + 16)], xyz);
        assert.equal(bytes.readUInt32LE(at + 24), p.file); assert.equal(bytes.readUInt32LE(at + 28), p.row);
        assert.equal(bytes.readUInt32LE(at + 32), physical); assert.equal(bytes.readUInt32LE(at + 36), p.label);
        const summary = summaries[p.label]; summary.count++; counts[p.label]++;
        xyz.forEach((v, axis) => { summary.min[axis] = Math.min(summary.min[axis], v); summary.max[axis] = Math.max(summary.max[axis], v); });
      }
      assert.deepEqual(page.labels, summaries.map(x => x.count ? x : null));
    }
    assert.deepEqual(index.counts, counts);
    for (const physical of [0, 1, 24, 4095, 4096, f.points.length - 1]) {
      const p = f.points[physical]; assert.equal(await index.resolvePhysical({ sourceFileId: p.file, sourceRow: p.row }), physical);
    }
    const warm = await f.snapshot(); assert.equal((await f.index(warm)).cache, 'memory'); assert.equal(warm.sourceReads.payloadBytes, 0);
    dropSemanticDiskIndexMemoryCache(); const reloaded = await f.snapshot(), disk = await f.index(reloaded);
    assert.equal(disk.cache, 'loaded'); assert.equal(disk.index.hash, index.hash); assert.equal(reloaded.sourceReads.payloadBytes, 0);
    assert.deepEqual(disk.index.pages, index.pages); assert.ok(Object.isFrozen(index.pages[0].labels[0]!.min));
    await assert.rejects(index.readPage({ ...index.pages[0] }), corrupt);
    await assert.rejects(index.resolvePhysical({ sourceFileId: 4, sourceRow: 1000000 }), { code: 'unknown-point' });
    assert.deepEqual((await readdir(index.directory)).sort(), ['index.json', 'pages.bin', 'records.bin', 'source-1.bin', 'source-2.bin', 'source-3.bin', 'source-4.bin']);
  } finally { await f.clean(); }
});

test('external partition lookup crosses 262144 source rows with bounded source reads and no whole lookup', async () => {
  const f = await fixture(262144 + 37, points => points.forEach((p, i) => { p.file = 1; p.row = points.length - 1 - i; }));
  try {
    // fixture original counts are balanced; update authoritative source mapping.
    const path = join(f.root, 'manifest.json'), manifest = JSON.parse((await readFile(path)).toString());
    manifest.sources.forEach((source: { points: number }, i: number) => { source.points = i === 0 ? f.points.length : 0; }); await writeFile(path, JSON.stringify(manifest));
    const s = await f.snapshot(), { index } = await f.index(s);
    for (const row of [0, 4095, 4096, 262143, 262144, f.points.length - 1]) assert.equal(await index.resolvePhysical({ sourceFileId: 1, sourceRow: row }), f.points.length - 1 - row);
    assert.equal(s.sourceReads.payloadBytes, f.payload.length); assert.ok(s.sourceReads.maxReadBytes <= SEMANTIC_LIMITS.readBytes);
    assert.equal(index.lookup[0].pages.length, Math.ceil(f.points.length / pagePoints)); assert.equal(index.lookup[1].bytes, 0);
  } finally { await f.clean(); }
});

test('active record/lookup/manifest/metadata mutation, file replacement, symlink and truncation fail closed', async () => {
  for (const mode of ['record', 'lookup', 'manifest', 'metadata', 'replace', 'symlink', 'truncate']) {
    const f = await fixture();
    try {
      const s = await f.snapshot(), { index } = await f.index(s), record = join(index.directory, 'records.bin');
      if (mode === 'record') await changeByte(record);
      else if (mode === 'lookup') await changeByte(join(index.directory, 'source-1.bin'));
      else if (mode === 'manifest') await changeByte(join(index.directory, 'index.json'));
      else if (mode === 'metadata') await changeByte(join(index.directory, 'pages.bin'));
      else if (mode === 'replace') { const bytes = await readFile(record); await rename(record, record + '.old'); await writeFile(record, bytes); }
      else if (mode === 'symlink') { await rename(record, record + '.old'); await symlink(record + '.old', record); }
      else await writeFile(record, Buffer.alloc(0));
      await assert.rejects(index.check(), corrupt);
      await assert.rejects(f.index(s), corrupt, 'memory cache reuse checks active file stability');
      if (['record', 'replace', 'symlink', 'truncate'].includes(mode)) await assert.rejects(index.readPage(index.pages[0]), corrupt);
      if (mode === 'lookup') await assert.rejects(index.resolvePhysical({ sourceFileId: 1, sourceRow: 0 }), corrupt);
      dropSemanticDiskIndexMemoryCache();
      if (mode === 'record' || mode === 'lookup' || mode === 'replace') {
        // Lazy reads authenticate content; metadata-only startup intentionally avoids record scans.
        const loaded = (await f.index(s)).index;
        if (mode === 'record') await assert.rejects(loaded.readPage(loaded.pages[0]), corrupt);
        if (mode === 'lookup') await assert.rejects(loaded.resolvePhysical({ sourceFileId: 1, sourceRow: 0 }), corrupt);
      } else await assert.rejects(f.index(s));
    } finally { await f.clean(); }
  }
});

test('load validates revision/config/count/header checksum, page coverage, label count and bounds even with recomputed hashes', async () => {
  for (const mode of ['checksum', 'revision', 'config', 'counts', 'lookup-count', 'metadata-hash', 'page-start', 'page-count', 'label-count', 'nan', 'inverted', 'outside', 'empty-bounds']) {
    const f = await fixture();
    try {
      const s = await f.snapshot(), { index } = await f.index(s);
      if (['page-start', 'page-count', 'label-count', 'nan', 'inverted', 'outside', 'empty-bounds'].includes(mode)) {
        const path = join(index.directory, 'pages.bin'), bytes = await readFile(path);
        if (mode === 'page-start') bytes.writeUInt32LE(1, 0);
        if (mode === 'page-count') bytes.writeUInt32LE(2, 4);
        if (mode === 'label-count') bytes.writeUInt32LE(4097, 40);
        if (mode === 'nan') bytes.writeDoubleLE(NaN, 44);
        if (mode === 'inverted') bytes.writeDoubleLE(999, 44);
        if (mode === 'outside') { bytes.writeDoubleLE(-200, 44); bytes.writeDoubleLE(-199, 68); }
        if (mode === 'empty-bounds') { bytes.writeUInt32LE(0, 40); bytes.writeDoubleLE(1, 44); }
        await writeFile(path, bytes); await rehashHeader(index, h => { h.pageMetadataHash = digest(bytes); });
      } else if (mode === 'checksum') await changeByte(join(index.directory, 'index.json'), 12);
      else await rehashHeader(index, h => {
        if (mode === 'revision') h.revision = '0'.repeat(64);
        if (mode === 'config') h.config.recordBytes = 36;
        if (mode === 'counts') h.counts[0]++;
        if (mode === 'lookup-count') h.lookup[0].pages = [];
        if (mode === 'metadata-hash') h.pageMetadataHash = '0'.repeat(64);
      });
      dropSemanticDiskIndexMemoryCache(); await assert.rejects(f.index(s), corrupt, mode);
    } finally { await f.clean(); }
  }
});

test('invalid/duplicate source provenance, unsupported labels and hierarchy gaps rejected before publication', async () => {
  for (const mode of ['duplicate', 'row', 'file', 'label', 'label-nan', 'xyz', 'hierarchy-overlap', 'hierarchy-gap', 'schema']) {
    const f = await fixture();
    try {
      const payload = Buffer.from(f.payload), hierarchy = Buffer.from(f.hierarchy);
      if (mode === 'duplicate') { payload.writeUInt16LE(payload.readUInt16LE(18), 28 + 18); payload.writeUInt32LE(payload.readUInt32LE(20), 28 + 20); }
      if (mode === 'row') payload.writeUInt32LE(100, 20);
      if (mode === 'file') payload.writeUInt16LE(0, 18);
      if (mode === 'label') payload.writeFloatLE(9, 24);
      if (mode === 'label-nan') payload.writeFloatLE(NaN, 24);
      if (mode === 'xyz') payload.writeInt32LE(2147483647, 0);
      if (mode === 'hierarchy-overlap') { hierarchy[0] = 0; hierarchy[1] = 1; const child = Buffer.from(hierarchy); child[0] = 1; child[1] = 0; await writeFile(join(f.root, 'octree/hierarchy.bin'), Buffer.concat([hierarchy, child])); const metadata = { ...f.metadata, hierarchy: { firstChunkSize: 44 } }; await writeFile(join(f.root, 'octree/metadata.json'), JSON.stringify(metadata)); }
      if (mode === 'hierarchy-gap') { hierarchy.writeUInt32LE(f.points.length - 1, 2); hierarchy.writeBigUInt64LE(BigInt(payload.length - 28), 14); await writeFile(join(f.root, 'octree/hierarchy.bin'), hierarchy); }
      if (mode === 'schema') { const path = join(f.root, 'manifest.json'), manifest = JSON.parse((await readFile(path)).toString()); manifest.semantic_classes[7] = 'Wrong'; await writeFile(path, JSON.stringify(manifest)); }
      await writeFile(join(f.root, 'octree/octree.bin'), payload);
      const s = await f.snapshot(); await assert.rejects(f.index(s), corrupt, mode);
    } finally { await f.clean(); }
  }
});

test('cancellation at build/wait/read/check is bounded, cleans staging, never publishes partial; retry succeeds', async () => {
  const f = await fixture(pagePoints * 3 + 7);
  try {
    const s = await f.snapshot(), before = (await readdir(cacheRoot).catch(() => [] as string[])).filter(n => n.startsWith('.building-'));
    const controller = new AbortController(); let progress = 0;
    await assert.rejects(getSemanticDiskIndex(s, controller.signal, () => { progress++; controller.abort(); }), { name: 'AbortError' }); assert.equal(progress, 1);
    assert.deepEqual((await readdir(cacheRoot)).filter(n => n.startsWith('.building-')), before);
    const { index } = await f.index(s), abort = new AbortController(); abort.abort();
    await assert.rejects(getSemanticDiskIndex(s, abort.signal), { name: 'AbortError' });
    await assert.rejects(index.readPage(index.pages[0], abort.signal), { name: 'AbortError' });
    await assert.rejects(index.resolvePhysical({ sourceFileId: 1, sourceRow: 0 }, abort.signal), { name: 'AbortError' });
    await assert.rejects(index.check(abort.signal), { name: 'AbortError' });
    const second = await fixture(pagePoints * 3);
    try {
      const a = await second.snapshot(), b = await second.snapshot(), c = await second.snapshot(), waiting = new AbortController();
      const first = getSemanticDiskIndex(a, undefined, () => waiting.abort());
      const rejected = getSemanticDiskIndex(b, waiting.signal); const successful = getSemanticDiskIndex(c);
      const results = await Promise.allSettled([first, rejected, successful]);
      assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.equal(results[2].status, 'fulfilled');
      const built = await second.index(a); assert.equal(built.cache, 'memory');
    } finally { await second.clean(); }
  } finally { await f.clean(); }
});

test('source revision replacement aborts active snapshot and new revision gets distinct common cache', async () => {
  const f = await fixture();
  try {
    const s = await f.snapshot(), first = await f.index(s); f.payload.writeFloatLE(8, 24); await writeFile(join(f.root, 'octree/octree.bin'), f.payload);
    await assert.rejects(getSemanticDiskIndex(s), { code: 'stale-revision' });
    const fresh = await f.snapshot(), second = await f.index(fresh); assert.equal(second.cache, 'built');
    assert.notEqual(first.index.hash, second.index.hash); assert.notEqual(first.index.directory, second.index.directory);
    assert.equal(second.index.sourceHash, digest(f.payload));
  } finally { await f.clean(); }
});

test('missing manifest reproduces incomplete cache; preparation recovers without deleting original bytes', async () => {
  for (const mode of ['empty', 'source-only', 'missing-manifest']) {
    const f = await fixture();
    try {
      const s = await f.snapshot(), original = (await f.index(s)).index;
      dropSemanticDiskIndexMemoryCache();
      for (const name of await readdir(original.directory)) {
        if (name === 'index.json' || mode === 'empty' || (mode === 'source-only' && name !== 'source-1.bin')) await rm(join(original.directory, name));
      }
      const names = await readdir(original.directory), before = await Promise.all(names.map(name => readFile(join(original.directory, name))));
      const reads = s.sourceReads.payloadBytes;
      assert.equal(await loadPreparedSemanticDiskIndex(s), undefined, 'selection-only lookup never scans/rebuilds');
      assert.equal(s.sourceReads.payloadBytes, reads);
      const recovered = await f.index(s);
      assert.equal(recovered.cache, 'built'); assert.equal(recovered.index.hash, original.hash);
      assert.equal(recovered.index.directory, original.directory + '-recovery-1');
      assert.equal(s.sourceReads.payloadBytes, reads + f.payload.length, 'recovery validates the whole source');
      assert.deepEqual(await readdir(original.directory), names);
      assert.deepEqual(await Promise.all(names.map(name => readFile(join(original.directory, name)))), before);
      dropSemanticDiskIndexMemoryCache();
      assert.equal((await loadPreparedSemanticDiskIndex(s))?.directory, recovered.index.directory);
      const warm = await f.index(s); assert.equal(warm.cache, 'loaded');
      assert.deepEqual(await warm.index.readPage(warm.index.pages[0]), await recovered.index.readPage(recovered.index.pages[0]));
    } finally { await f.clean(); }
  }
});

test('missing earlier generations do not hide a valid recovered publication or rebuild source', async () => {
  for (const generation of [1, 3]) {
    const f = await fixture();
    let recoveredDirectory: string | undefined;
    try {
      const s = await f.snapshot(), original = (await f.index(s)).index;
      recoveredDirectory = `${original.directory}-recovery-${generation}`;
      await rename(original.directory, recoveredDirectory);
      dropSemanticDiskIndexMemoryCache();
      const reads = s.sourceReads.payloadBytes;
      const selected = await loadPreparedSemanticDiskIndex(s);
      assert.equal(selected?.directory, recoveredDirectory);
      const prepared = await f.index(s);
      assert.equal(prepared.cache, 'loaded');
      assert.equal(prepared.index.directory, recoveredDirectory);
      assert.equal(s.sourceReads.payloadBytes, reads, 'surviving recovery avoids a whole-source rebuild');
      assert.deepEqual(await prepared.index.readPage(prepared.index.pages[0]), await selected!.readPage(selected!.pages[0]));
    } finally {
      await f.clean();
      if (recoveredDirectory) await rm(recoveredDirectory, { recursive: true, force: true });
    }
  }
});

test('concurrent preparation and selection lookup preserve incomplete cache; cancelled waiter cannot poison recovery', async () => {
  const f = await fixture(pagePoints * 3);
  try {
    const s = await f.snapshot(), original = (await f.index(s)).index;
    await rm(join(original.directory, 'index.json')); dropSemanticDiskIndexMemoryCache();
    const a = await f.snapshot(), b = await f.snapshot(), c = await f.snapshot(), cancelled = new AbortController();
    let lookup: Promise<SemanticDiskIndex | undefined> | undefined;
    const first = getSemanticDiskIndex(a, undefined, () => {
      cancelled.abort(); lookup ??= loadPreparedSemanticDiskIndex(c);
    });
    const waiter = getSemanticDiskIndex(b, cancelled.signal), second = f.index(c);
    const [one, rejected, two] = await Promise.allSettled([first, waiter, second]);
    assert.equal(one.status, 'fulfilled'); assert.equal(rejected.status, 'rejected'); assert.equal(two.status, 'fulfilled');
    const built = await f.index(a); assert.equal(built.index.directory, original.directory + '-recovery-1');
    assert.equal(b.sourceReads.payloadBytes, 0); assert.equal(c.sourceReads.payloadBytes, 0);
    assert.equal(await lookup, undefined, 'private staging is never visible to selection');
    assert.equal((await readdir(original.directory)).length, 6);
  } finally { await f.clean(); }
});

test('recovery never bypasses symlinks, unknown files, nested directories or lock markers', async () => {
  for (const mode of ['directory-symlink', 'file-symlink', 'unknown', 'nested', 'lock']) {
    const f = await fixture(); let moved: string | undefined;
    try {
      const s = await f.snapshot(), original = (await f.index(s)).index;
      await rm(join(original.directory, 'index.json')); dropSemanticDiskIndexMemoryCache();
      if (mode === 'directory-symlink') { moved = original.directory + '.held'; await rename(original.directory, moved); await symlink(moved, original.directory); }
      if (mode === 'file-symlink') { await rm(join(original.directory, 'source-1.bin')); await symlink(join(f.root, 'manifest.json'), join(original.directory, 'source-1.bin')); }
      if (mode === 'unknown' || mode === 'lock') await writeFile(join(original.directory, mode === 'lock' ? '.lock' : 'operator-data'), 'preserve');
      if (mode === 'nested') await mkdir(join(original.directory, 'records-extra'));
      const source = await readFile(join(f.root, 'manifest.json'));
      await assert.rejects(f.index(s), corrupt, mode);
      await assert.rejects(loadPreparedSemanticDiskIndex(s), corrupt, mode);
      assert.deepEqual(await readFile(join(f.root, 'manifest.json')), source);
      await assert.rejects(lstat(original.directory + '-recovery-1'), { code: 'ENOENT' });
    } finally { await f.clean(); if (moved) await rm(moved, { recursive: true, force: true }); }
  }
});

test('cancelled recovery leaves no partial publication and retry succeeds', async () => {
  const f = await fixture(pagePoints * 2);
  try {
    const s = await f.snapshot(), original = (await f.index(s)).index;
    await rm(join(original.directory, 'index.json')); dropSemanticDiskIndexMemoryCache();
    const controller = new AbortController();
    await assert.rejects(getSemanticDiskIndex(s, controller.signal, () => controller.abort()), { name: 'AbortError' });
    await assert.rejects(lstat(original.directory + '-recovery-1'), { code: 'ENOENT' });
    const recovered = await f.index(s); assert.equal(recovered.cache, 'built');
  } finally { await f.clean(); }
});

test('cross-process recovery publication race reuses winner without replacing its files', async () => {
  const f = await fixture();
  try {
    const s = await f.snapshot(), original = (await f.index(s)).index;
    await rm(join(original.directory, 'index.json')); dropSemanticDiskIndexMemoryCache();
    const before = await lstat(original.directory); let winner: { directory: string; inode: number } | undefined;
    const result = await getSemanticDiskIndex(s, undefined, () => {
      if (winner) return;
      const script = `import {SemanticArtifact} from './apps/server/src/semantic-artifact.ts';
        import {getSemanticDiskIndex} from './apps/server/src/semantic-disk-index.ts';
        import {lstat} from 'node:fs/promises'; import {join} from 'node:path';
        const s=await SemanticArtifact.open(process.argv[1]);
        try { const {index}=await getSemanticDiskIndex(s); console.log(JSON.stringify({directory:index.directory,inode:(await lstat(join(index.directory,'records.bin'))).ino})); }
        finally {await s.close();}`;
      winner = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script, f.root], { encoding: 'utf8', timeout: 30000 }));
    });
    const tracked = await f.index(s);
    assert.equal(result.index.directory, winner!.directory); assert.equal(tracked.index.directory, winner!.directory);
    assert.equal((await lstat(join(result.index.directory, 'records.bin'))).ino, winner!.inode, 'losing builder did not overwrite published winner');
    assert.equal((await lstat(original.directory)).ino, before.ino, 'original incomplete directory is untouched');
    assert.equal((await readdir(original.directory)).length, 6);
  } finally { await f.clean(); }
});

test('recovery is bounded and refuses to silently discard eight incomplete generations', async () => {
  const f = await fixture(); const extra: string[] = [];
  try {
    const s = await f.snapshot(), original = (await f.index(s)).index;
    await rm(join(original.directory, 'index.json')); dropSemanticDiskIndexMemoryCache();
    for (let n = 1; n < 8; n++) { const directory = original.directory + `-recovery-${n}`; extra.push(directory); await mkdir(directory); }
    const reads = s.sourceReads.payloadBytes;
    await assert.rejects(f.index(s), /recovery generations exhausted/);
    assert.equal(s.sourceReads.payloadBytes, reads);
    for (const directory of extra) assert.deepEqual(await readdir(directory), []);
  } finally { await f.clean(); await Promise.all(extra.map(path => rm(path, { recursive: true, force: true }))); }
});
