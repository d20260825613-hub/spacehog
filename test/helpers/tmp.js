import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const cleanups = [];

after(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** Create an isolated temp directory that is removed when the test file ends. */
export async function makeTempDir(prefix = 'spacehog-test-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/**
 * Materialize a tree description into a real directory.
 *
 * Keys are POSIX-style relative paths. A string or Buffer value becomes a
 * file; `null` creates a directory.
 *
 * @param {Record<string, string|Buffer|null>} tree
 * @param {string} [prefix]
 */
export async function makeTree(tree, prefix = 'spacehog-tree-') {
  const root = await makeTempDir(prefix);
  for (const [relative, contents] of Object.entries(tree)) {
    const target = path.join(root, ...relative.split('/'));
    if (contents === null) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

/** Deterministic filler content of an exact byte length. */
export function filler(byte, length) {
  return Buffer.alloc(length, byte);
}

/** A file path string that is unique but patterned, e.g. `a/a1.txt`. */
export function rel(...parts) {
  return parts.join('/');
}
