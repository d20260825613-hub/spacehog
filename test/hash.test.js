import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  HASH_ALGORITHMS,
  HashCache,
  hashFile,
  hashHead,
  isSupportedAlgorithm,
  mapPool,
} from '../src/hash.js';
import { filler, makeTempDir, makeTree } from './helpers/tmp.js';

test('hashFile matches node crypto for every supported algorithm', async () => {
  const content = Buffer.from('spacehog duplicate detection\n'.repeat(50));
  const root = await makeTree({ 'sample.txt': content });

  for (const algorithm of HASH_ALGORITHMS) {
    const expected = crypto.createHash(algorithm).update(content).digest('hex');
    assert.equal(await hashFile(path.join(root, 'sample.txt'), algorithm), expected);
  }
});

test('hashFile handles empty files', async () => {
  const root = await makeTree({ 'empty.bin': '' });
  const expected = crypto.createHash('md5').update(Buffer.alloc(0)).digest('hex');
  assert.equal(await hashFile(path.join(root, 'empty.bin'), 'md5'), expected);
});

test('hashHead reads only the prefix and flags short files as complete', async () => {
  const root = await makeTree({
    'big.bin': filler(1, 5000),
    'small.bin': Buffer.from('abc'),
  });

  const big = await hashHead(path.join(root, 'big.bin'), 'md5', 1024);
  assert.equal(big.bytesRead, 1024);
  assert.equal(big.complete, false);
  assert.equal(big.hash, crypto.createHash('md5').update(filler(1, 1024)).digest('hex'));

  const small = await hashHead(path.join(root, 'small.bin'), 'md5', 1024);
  assert.equal(small.bytesRead, 3);
  assert.equal(small.complete, true);
  assert.equal(small.hash, crypto.createHash('md5').update('abc').digest('hex'));
});

test('hashHead and hashFile agree for files shorter than the head buffer', async () => {
  const root = await makeTree({ 'tiny.bin': 'hello world' });
  const file = path.join(root, 'tiny.bin');
  const [head, full] = await Promise.all([hashHead(file, 'sha256', 4096), hashFile(file, 'sha256')]);
  assert.equal(head.hash, full);
});

test('hashFile rejects for a missing file', async () => {
  await assert.rejects(() => hashFile(path.join('nope', 'missing.bin'), 'md5'));
});

test('isSupportedAlgorithm accepts the documented set', () => {
  assert.equal(isSupportedAlgorithm('md5'), true);
  assert.equal(isSupportedAlgorithm('SHA256'), true);
  assert.equal(isSupportedAlgorithm('crc32'), false);
});

test('mapPool preserves order and bounds concurrency', async () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const limit = 4;
  let active = 0;
  let peak = 0;

  // Workers hold their slot until every slot is occupied, which makes the
  // assertions deterministic. Using a timer instead would be flaky by
  // construction: on a loaded machine four 2ms timers can fire one after
  // another, and a "peak > 1" check would fail even though the pool is correct.
  let openGate;
  const gate = new Promise((resolve) => {
    openGate = resolve;
  });

  const results = await mapPool(items, limit, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    // The four runners reach their first await synchronously, so this fires
    // only once all `limit` slots are in use.
    if (active === limit) openGate();
    try {
      await gate;
    } finally {
      active -= 1;
    }
    return value * 2;
  });

  assert.deepEqual(results, items.map((value) => value * 2));
  assert.equal(peak, limit, `the pool should use exactly ${limit} slots, saw ${peak}`);
  assert.equal(active, 0, 'every slot must be released');
});

test('mapPool never exceeds its limit even for slow workers', async () => {
  // Same idea, but the workers yield to the event loop between entering and
  // leaving, which is where an off-by-one in the pool would show up.
  const items = Array.from({ length: 12 }, (_, i) => i);
  const limit = 3;
  let active = 0;
  let peak = 0;
  let order = 0;
  const completions = [];

  const results = await mapPool(items, limit, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    completions.push(order++);
    return value;
  });

  assert.deepEqual(results, items);
  assert.ok(peak <= limit, `peak concurrency was ${peak}, limit ${limit}`);
  assert.equal(completions.length, items.length, 'every item must complete exactly once');
});

test('mapPool handles an empty list and a limit above the list size', async () => {
  assert.deepEqual(await mapPool([], 8, async (v) => v), []);
  assert.deepEqual(await mapPool([1, 2], 999, async (v) => v + 1), [2, 3]);
});

test('mapPool propagates the first worker error', async () => {
  await assert.rejects(
    () =>
      mapPool([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error('boom');
        return value;
      }),
    /boom/,
  );
});

test('HashCache round-trips through disk and reports hits and misses', async () => {
  const dir = await makeTempDir('spacehog-cache-');
  const store = path.join(dir, 'nested', 'hashes.json');
  const file = { path: path.join(dir, 'a.bin'), size: 10, mtimeMs: 1234.9 };

  const first = await HashCache.load(store);
  assert.equal(first.enabled, true);
  assert.equal(first.get(file, 'md5'), null);
  first.set(file, 'md5', 'deadbeef');
  const saved = await first.save();
  assert.equal(saved.saved, true);

  const second = await HashCache.load(store);
  assert.equal(second.get(file, 'md5'), 'deadbeef');
  assert.equal(second.hits, 1);
  assert.equal(second.misses, 0);

  // Same path and size but a different mtime must miss.
  assert.equal(second.get({ ...file, mtimeMs: 9999 }, 'md5'), null);

  // A different algorithm is a different cache entry.
  assert.equal(second.get(file, 'sha1'), null);
});

test('HashCache is a no-op when disabled', async () => {
  const dir = await makeTempDir('spacehog-cache-off-');
  const store = path.join(dir, 'hashes.json');
  const cache = await HashCache.load(store, { enabled: false });
  cache.set({ path: 'x', size: 1, mtimeMs: 1 }, 'md5', 'aaa');
  const result = await cache.save();
  assert.equal(cache.enabled, false);
  assert.equal(result.saved, false);
  assert.equal(cache.get({ path: 'x', size: 1, mtimeMs: 1 }, 'md5'), null);
});

test('HashCache ignores a corrupt store file', async () => {
  const dir = await makeTempDir('spacehog-cache-bad-');
  const store = path.join(dir, 'hashes.json');
  await fsp.writeFile(store, '{ not json at all');
  const cache = await HashCache.load(store);
  assert.equal(cache.entries.size, 0);
  assert.equal(cache.enabled, true);
});

test('HashCache drops nothing until it exceeds maxEntries', async () => {
  const dir = await makeTempDir('spacehog-cache-cap-');
  const store = path.join(dir, 'hashes.json');
  const cache = await HashCache.load(store);
  for (let i = 0; i < 10; i += 1) {
    cache.set({ path: `f${i}`, size: i, mtimeMs: i }, 'md5', `h${i}`);
  }
  const result = await cache.save({ maxEntries: 4 });
  assert.equal(result.entries, 4);

  const reloaded = await HashCache.load(store);
  assert.equal(reloaded.entries.size, 4);
  assert.equal(reloaded.get({ path: 'f9', size: 9, mtimeMs: 9 }, 'md5'), 'h9');
});
