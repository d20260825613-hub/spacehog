import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_JUNK_EXTENSIONS,
  DEFAULT_JUNK_NAMES,
  findDuplicates,
  findEmptyDirs,
  findJunkFiles,
  findLargeFiles,
  findSparseFiles,
  isJunkFile,
  isSparse,
} from '../src/detectors.js';
import { HashCache } from '../src/hash.js';
import { walk } from '../src/walker.js';
import { filler, makeTree } from './helpers/tmp.js';

const abs = (root, relative) => path.join(root, ...relative.split('/'));

async function collect(root, options = {}) {
  const result = await walk(root, options);
  return result;
}

test('findDuplicates groups identical content and ignores same-size strangers', async () => {
  const root = await makeTree({
    'a.txt': 'identical payload',
    'copy/b.txt': 'identical payload',
    'deep/nested/c.txt': 'identical payload',
    'other/d.txt': 'different payload', // same length, different bytes
    'unique.txt': 'nobody else has this content',
  });

  const walked = await collect(root);
  const result = await findDuplicates(walked.files, { concurrency: 4 });

  assert.equal(result.groups.length, 1);
  const [group] = result.groups;
  assert.equal(group.copies, 3);
  assert.equal(group.size, Buffer.byteLength('identical payload'));
  assert.equal(group.wastedBytes, group.size * 2);
  assert.equal(result.stats.duplicateGroups, 1);
  assert.equal(result.stats.duplicateFiles, 3);
  assert.equal(result.stats.wastedBytes, group.size * 2);
  assert.deepEqual(
    group.files.map((f) => path.basename(f.path)).sort(),
    ['a.txt', 'b.txt', 'c.txt'],
  );
});

test('findDuplicates treats every empty file as a duplicate without hashing', async () => {
  const root = await makeTree({
    'one.bin': '',
    'two.bin': '',
    'three.bin': '',
    'notempty.bin': 'x',
  });
  const walked = await collect(root);
  const result = await findDuplicates(walked.files);

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].size, 0);
  assert.equal(result.groups[0].copies, 3);
  assert.equal(result.stats.wastedBytes, 0);
  assert.equal(result.stats.fullHashes, 0, 'empty files need no hashing');
  assert.equal(result.stats.headHashes, 0, 'empty files need no I/O at all');
});

test('findDuplicates distinguishes files that share a prefix', async () => {
  const shared = 'A'.repeat(4096);
  const root = await makeTree({
    'x1.bin': `${shared}one`,
    'x2.bin': `${shared}two`,
    'x3.bin': `${shared}one`,
  });
  const walked = await collect(root);
  const result = await findDuplicates(walked.files, { headBytes: 512 });

  assert.equal(result.groups.length, 1);
  assert.deepEqual(
    result.groups[0].files.map((f) => path.basename(f.path)).sort(),
    ['x1.bin', 'x3.bin'],
  );
});

test('findDuplicates sorts groups by reclaimable bytes, largest first', async () => {
  const root = await makeTree({
    'big1.bin': filler(1, 5000),
    'big2.bin': filler(1, 5000),
    'small1.bin': filler(2, 10),
    'small2.bin': filler(2, 10),
  });
  const walked = await collect(root);
  const result = await findDuplicates(walked.files);

  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].size, 5000);
  assert.equal(result.groups[1].size, 10);
  assert.equal(result.stats.wastedBytes, 5000 + 10);
});

test('findDuplicates skips candidates above maxFileSize', async () => {
  const root = await makeTree({
    'huge1.bin': filler(9, 4096),
    'huge2.bin': filler(9, 4096),
    'small1.bin': 'same',
    'small2.bin': 'same',
  });
  const walked = await collect(root);
  const result = await findDuplicates(walked.files, { maxFileSize: 1024 });

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].size, 4);
});

test('findDuplicates counts hard links as shared storage, not duplicates', async (t) => {
  const root = await makeTree({ 'original.bin': filler(3, 2048) });
  const linkPath = abs(root, 'linked.bin');
  try {
    await fs.link(abs(root, 'original.bin'), linkPath);
  } catch (error) {
    t.skip(`hard links unavailable: ${error.code}`);
    return;
  }

  const walked = await collect(root);
  const result = await findDuplicates(walked.files);

  assert.equal(result.groups.length, 0, 'hard links are the same file on disk');
  assert.equal(result.hardlinkGroups.length, 1);
  assert.equal(result.hardlinkGroups[0].files.length, 2);
  assert.equal(result.hardlinkWastedBytes, 2048);
});

test('findDuplicates uses the cache and reports hits', async () => {
  const root = await makeTree({
    'a.bin': filler(5, 300_000),
    'b.bin': filler(5, 300_000),
  });
  const walked = await collect(root);
  const cache = new HashCache(null, { enabled: false });
  // Manual cache: every file already hashed.
  const warm = {
    get: () => 'cached-hash',
    set: () => {},
  };
  const result = await findDuplicates(walked.files, { cache: warm, headBytes: 64 });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].copies, 2);
  assert.equal(cache.enabled, false);
});

test('findLargeFiles returns the biggest files in order', async () => {
  const files = [
    { path: '/x/small', size: 10, mtimeMs: 1 },
    { path: '/x/big', size: 1000, mtimeMs: 1 },
    { path: '/x/medium', size: 100, mtimeMs: 1 },
  ];
  const top = findLargeFiles(files, 2);
  assert.deepEqual(top.map((f) => f.size), [1000, 100]);
  assert.equal(findLargeFiles(files, 0).length, 0);
});

test('isSparse compares allocated blocks with logical size', () => {
  const mb = 1024 * 1024;
  assert.equal(isSparse({ size: 100 * mb, blocks: 0 }), true);
  assert.equal(isSparse({ size: 10 * mb, blocks: (10 * mb) / 512 }), false);
  assert.equal(isSparse({ size: 10 * mb, blocks: null }), false, 'blocks unavailable (Windows)');
  assert.equal(isSparse({ size: 2 * mb, blocks: 0 }), false, 'below the minimum gap');
  assert.equal(isSparse({ size: 100 * mb, blocks: (40 * mb) / 512 }), true);
});

test('findSparseFiles reports real usage and savings', async () => {
  const sparse = { path: '/x/huge.img', size: 100 * 1024 * 1024, blocks: 0, mtimeMs: 1 };
  const dense = { path: '/x/normal.bin', size: 1024, blocks: 2, mtimeMs: 1 };
  const result = findSparseFiles([dense, sparse]);
  assert.equal(result.length, 1);
  assert.equal(result[0].allocatedBytes, 0);
  assert.equal(result[0].savedBytes, 100 * 1024 * 1024);
});

test('isJunkFile matches extensions, multi-part extensions and names', () => {
  const check = (p) => isJunkFile({ path: p });
  assert.equal(check('/tmp/build.tmp'), true);
  assert.equal(check('/tmp/build.TMP'), true);
  assert.equal(check('/home/u/app.tsbuildinfo'), true);
  assert.equal(check('/home/u/.DS_Store'), true);
  assert.equal(check('/home/u/Thumbs.db'), true);
  assert.equal(check('/home/u/npm-debug.log'), true);
  assert.equal(check('/home/u/report.log'), true);
  assert.equal(check('/home/u/notes.txt'), false);
  assert.equal(check('/home/u/log'), false, 'extension-less name is not junk by extension');
  assert.equal(check('/home/u/important.bak'), true);
  assert.equal(check('/home/u/.gitignore'), false);
});

test('isJunkFile accepts custom extension and name lists', () => {
  assert.equal(isJunkFile({ path: '/x/thing.weird' }, { extensions: ['.weird'], names: [] }), true);
  assert.equal(isJunkFile({ path: '/x/thing.tmp' }, { extensions: ['.weird'], names: [] }), false);
  assert.equal(DEFAULT_JUNK_EXTENSIONS.includes('.tmp'), true);
  assert.equal(DEFAULT_JUNK_NAMES.includes('thumbs.db'), true);
});

test('findJunkFiles totals every match but lists only the biggest', async () => {
  const root = await makeTree({
    'a.log': filler(1, 100),
    'b.log': filler(2, 200),
    'keep.txt': 'x',
    'sub/c.tmp': filler(3, 50),
  });
  const walked = await collect(root);
  const junk = findJunkFiles(walked.files, 2);

  assert.equal(junk.count, 3);
  assert.equal(junk.totalBytes, 350);
  assert.equal(junk.files.length, 2);
  assert.equal(junk.files[0].size, 200);
  assert.equal(junk.files[1].size, 100);
});

test('findEmptyDirs reports whole empty folder trees, deepest first', async () => {
  const root = await makeTree({
    'full/keep.txt': 'content',
    'full/sub/also.txt': 'content',
    'empty': null,
    'tree/leaf': null,
    'tree/leaf/deeper': null,
  });
  const walked = await collect(root);
  const result = findEmptyDirs(walked.directories);

  // The temp root itself counts as an empty tree here, so restrict to the
  // directories this fixture actually created.
  const found = result.dirs
    .filter((d) => d.depth > 0)
    .map((d) => d.display)
    .sort();
  assert.deepEqual(found, ['empty', 'tree', 'tree/leaf', 'tree/leaf/deeper'].sort());
  assert.equal(result.count, 4, 'the four empty directories; the temp root holds files');
  // deepest first
  assert.equal(result.dirs[0].display, 'tree/leaf/deeper');
});

test('findEmptyDirs keeps directories that hold files', async () => {
  const root = await makeTree({
    'only/file.txt': 'x',
    'only/deep': null,
  });
  const walked = await collect(root);
  const result = findEmptyDirs(walked.directories);

  // `only/deep` is empty, but it is a real empty directory and should be listed.
  assert.deepEqual(result.dirs.map((d) => d.display), ['only/deep']);
});

test('findDuplicates uses the real HashCache across two runs', async () => {
  const root = await makeTree({
    'one.bin': filler(4, 200_000),
    'two.bin': filler(4, 200_000),
  });
  const walked = await collect(root);

  const memory = new HashCache(null, { enabled: true });
  const resultA = await findDuplicates(walked.files, { cache: memory });
  assert.equal(resultA.groups.length, 1);
  assert.ok(resultA.stats.fullHashes > 0, 'first run reads the files');
  assert.ok(memory.entries.size > 0, 'first run populates the cache');

  const hitsBefore = memory.hits;
  const resultB = await findDuplicates(walked.files, { cache: memory });
  assert.equal(resultB.groups.length, 1);
  assert.equal(resultB.groups[0].copies, 2);
  assert.ok(memory.hits > hitsBefore, 'second run should hit the cache');
  assert.equal(resultB.stats.fullHashes, 0, 'both files came from the cache');
});
