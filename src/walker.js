import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursive, breadth-first directory walker.
 *
 * Design notes:
 *  - Iterative (explicit queue), so deep trees never blow the call stack.
 *  - Never throws for a single bad entry: permission errors and racing
 *    deletions are collected into `errors` and the walk continues.
 *  - Symlinks are skipped by default (avoids cycles and double counting).
 */

/** Directory names that are almost never worth auditing. */
export const DEFAULT_IGNORED_DIRS = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.gradle',
  '.terraform',
  'target',
  'dist',
  'build',
  '.DS_Store',
];

const ERRORS_KEPT = 40;

/**
 * @param {string} root absolute or relative directory to scan
 * @param {object} [options]
 * @param {string[]} [options.ignoreDirs] directory basenames to prune
 * @param {boolean} [options.includeHidden] include dotfiles / dot-dirs
 * @param {number} [options.maxDepth] 0 = only the root directory
 * @param {number} [options.maxEntries] stop collecting after N files
 * @param {boolean} [options.followSymlinks] follow symlinked directories (danger: cycles)
 * @param {(progress: {files: number, dirs: number, bytes: number}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function walk(root, options = {}) {
  const {
    ignoreDirs = [],
    includeHidden = true,
    maxDepth = Infinity,
    maxEntries = Infinity,
    followSymlinks = false,
    onProgress,
    signal,
  } = options;

  const ignored = new Set(ignoreDirs);
  const files = [];
  const directories = [];
  const errors = [];
  let totalBytes = 0;
  let fileCount = 0;
  let dirCount = 0;
  let skippedDirCount = 0;
  let symlinkCount = 0;
  let symlinkedDirCount = 0;
  let truncated = false;

  const recordError = (errorPath, err) => {
    if (errors.length < ERRORS_KEPT) {
      errors.push({ path: errorPath, code: err?.code ?? 'EUNKNOWN', message: err?.message ?? String(err) });
    }
  };

  const start = path.resolve(root);

  let rootStat;
  try {
    rootStat = await fs.stat(start);
  } catch (err) {
    recordError(start, err);
    return {
      root: start,
      files,
      directories,
      errors,
      stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated },
    };
  }

  if (!rootStat.isDirectory()) {
    recordError(start, Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }));
    return {
      root: start,
      files,
      directories,
      errors,
      stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated },
    };
  }

  // Display paths are relative to the root: files directly in the root show as
  // "name", deeper entries as "sub/dir/name". Trailing separators in `root`
  // must not leak into that prefix (path.basename('C:\\x\\y\\') is '').
  const queue = [{ dir: start, display: '', depth: 0 }];

  while (queue.length > 0) {
    if (signal?.aborted) break;
    const { dir, display, depth } = queue.shift();
    dirCount += 1;
    const directory = { path: dir, display, depth, fileCount: 0, subdirCount: 0 };
    directories.push(directory);

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      recordError(dir, err);
      continue;
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (signal?.aborted) break;
      const name = entry.name;
      if (!includeHidden && name.startsWith('.')) continue;

      const full = path.join(dir, name);
      const childDisplay = display ? `${display}/${name}` : name;

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        symlinkCount += 1;
        if (!followSymlinks) continue;
        try {
          const target = await fs.stat(full);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
          if (isDirectory) symlinkedDirCount += 1;
        } catch (err) {
          recordError(full, err);
          continue;
        }
      }

      if (isDirectory) {
        if (ignored.has(name)) {
          skippedDirCount += 1;
          continue;
        }
        if (depth + 1 > maxDepth) continue;
        directory.subdirCount += 1;
        queue.push({ dir: full, display: childDisplay, depth: depth + 1 });
        continue;
      }

      if (!isFile) continue;
      if (fileCount >= maxEntries) {
        truncated = true;
        continue;
      }

      let stat;
      try {
        stat = await fs.lstat(full);
      } catch (err) {
        recordError(full, err);
        continue;
      }

      fileCount += 1;
      totalBytes += stat.size;
      directory.fileCount += 1;
      files.push({
        path: full,
        display: childDisplay,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        blocks: stat.blocks ?? null,
        ino: stat.ino ?? null,
        dev: stat.dev ?? null,
        depth: depth + 1,
      });
      onProgress?.({ files: fileCount, dirs: dirCount, bytes: totalBytes });
    }
  }

  return {
    root: start,
    files,
    directories,
    errors,
    stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated },
  };
}
