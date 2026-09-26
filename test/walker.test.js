import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_IGNORED_DIRS, walk } from '../src/walker.js';
import { filler, makeTree } from './helpers/tmp.js';

test('walk lists files with sizes and relative display paths', async () => {
  const root = await makeTree({
    'a.txt': 'hello',
    'sub/b.txt': 'world!',
    'sub/deep/c.bin': filler(7, 100),
  });

  const result = await walk(root, { ignoreDirs: DEFAULT_IGNORED_DIRS });
  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.fileCount, 3);
  assert.equal(result.stats.totalBytes, 5 + 6 + 100);
  const displays = result.files.map((f) => f.display).sort();
  // display paths always use forward slashes, on every platform
  assert.deepEqual(displays, ['a.txt', 'sub/b.txt', 'sub/deep/c.bin'].sort());
  assert.ok(result.files.every((f) => path.isAbsolute(f.path)));
});

test('walk prunes ignored directories and counts them', async () => {
  const root = await makeTree({
    'keep.txt': 'x',
    'node_modules/pkg/index.js': 'x'.repeat(50),
    'sub/.git/config': 'x'.repeat(50),
    'sub/keep2.txt': 'y',
  });

  const withIgnores = await walk(root, { ignoreDirs: DEFAULT_IGNORED_DIRS });
  assert.deepEqual(
    withIgnores.files.map((f) => f.display).sort(),
    ['keep.txt', 'sub/keep2.txt'].sort(),
  );
  assert.equal(withIgnores.stats.skippedDirCount, 2);

  const withoutIgnores = await walk(root, { ignoreDirs: [] });
  assert.equal(withoutIgnores.stats.fileCount, 4);
});

test('walk respects maxDepth', async () => {
  const root = await makeTree({
    'top.txt': 'a',
    'one/mid.txt': 'b',
    'one/two/deep.txt': 'c',
  });

  const depth0 = await walk(root, { maxDepth: 0 });
  assert.deepEqual(depth0.files.map((f) => f.display), ['top.txt']);

  const depth1 = await walk(root, { maxDepth: 1 });
  assert.deepEqual(depth1.files.map((f) => f.display).sort(), ['top.txt', 'one/mid.txt'].sort());

  const depth2 = await walk(root, { maxDepth: 2 });
  assert.equal(depth2.files.length, 3);
});

test('walk hides dotfiles when includeHidden is false', async () => {
  const root = await makeTree({
    '.hidden': 'a',
    'shown.txt': 'b',
    '.secret/inside.txt': 'c',
  });

  const hidden = await walk(root, { includeHidden: true });
  assert.equal(hidden.stats.fileCount, 3);

  const visible = await walk(root, { includeHidden: false });
  assert.deepEqual(visible.files.map((f) => f.display), ['shown.txt']);
});

test('walk stops at maxEntries and flags truncation', async () => {
  const root = await makeTree({
    'a.txt': 'a',
    'b.txt': 'b',
    'c.txt': 'c',
  });
  const result = await walk(root, { maxEntries: 2 });
  assert.equal(result.files.length, 2);
  assert.equal(result.stats.truncated, true);
});

test('walk skips symlinked directories by default', async (t) => {
  const root = await makeTree({ 'real/file.txt': 'content' });
  const link = path.join(root, 'link');
  try {
    await fs.symlink(path.join(root, 'real'), link, 'junction');
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.code}`);
    return;
  }

  const safe = await walk(root, {});
  assert.deepEqual(safe.files.map((f) => f.display), ['real/file.txt']);
  assert.equal(safe.stats.symlinkCount, 1);

  const following = await walk(root, { followSymlinks: true });
  assert.equal(following.files.length, 2);
  assert.equal(following.stats.symlinkedDirCount, 1);
});

test('walk reports a missing root as an error instead of throwing', async () => {
  const result = await walk(path.join('definitely', 'not', 'here'), {});
  assert.equal(result.files.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'ENOENT');
});

test('walk reports a file root as an error', async () => {
  const root = await makeTree({ 'file.txt': 'x' });
  const result = await walk(path.join(root, 'file.txt'), {});
  assert.equal(result.errors[0].code, 'ENOTDIR');
});

test('walk records directory entries with monotonically increasing depth', async () => {
  const root = await makeTree({
    'a/b/c/file.txt': 'x',
    'a/other.txt': 'y',
  });
  const result = await walk(root, {});
  const depths = result.directories.map((d) => d.depth);
  assert.deepEqual(depths, [0, 1, 2, 3]);
  const rootEntry = result.directories.find((d) => d.depth === 0);
  const leaf = result.directories.find((d) => d.depth === 3);
  assert.equal(leaf.fileCount, 1, 'deepest dir holds the file');
  assert.equal(leaf.display, 'a/b/c');
  assert.equal(rootEntry.display, '');
  assert.equal(rootEntry.subdirCount, 1, 'root counts its subdirectory');
});

test('walk calls onProgress as files are discovered', async () => {
  const root = await makeTree({ 'a.txt': 'x', 'b.txt': 'y' });
  const seen = [];
  await walk(root, { onProgress: (p) => seen.push(p.files) });
  assert.equal(seen.length, 2);
  assert.equal(seen.at(-1), 2);
});
