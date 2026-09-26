import path from 'node:path';
import { hashFile, hashHead, mapPool, DEFAULT_HEAD_BYTES } from './hash.js';
import { toPosix } from './util.js';

/* ------------------------------------------------------------------ *
 * Duplicate detection
 * ------------------------------------------------------------------ */

/**
 * Find files whose contents are identical.
 *
 * Three cheap-to-expensive passes keep I/O low:
 *   1. group by exact byte size (files of different size can never match)
 *   2. hash only the first `headBytes` of each candidate
 *   3. full content hash for the groups that still collide
 *
 * Hard links (several names for one inode) are *not* duplicates: the bytes
 * are stored once. They are reported separately as `hardlinkGroups`.
 *
 * @param {Array<object>} files entries produced by `walk()`
 * @param {object} [options]
 * @param {string} [options.algorithm] md5 | sha1 | sha256
 * @param {import('./hash.js').HashCache|null} [options.cache] hash cache
 * @param {number} [options.concurrency] parallel file reads
 * @param {number} [options.headBytes] bytes read in the cheap pass
 * @param {number} [options.maxFileSize] never fully hash files above this size
 * @param {string} [options.root] scanned root, used for relative `display` paths
 * @param {(event: object) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{groups: object[], hardlinkGroups: object[], hardlinkWastedBytes: number, stats: object}>}
 */
export async function findDuplicates(files, options = {}) {
  const {
    algorithm = 'md5',
    cache = null,
    concurrency = 8,
    headBytes = DEFAULT_HEAD_BYTES,
    maxFileSize = Infinity,
    root = '',
    onProgress = null,
    signal = null,
  } = options;

  const checked = { headHashes: 0, fullHashes: 0, inodes: 0, bytesHashed: 0 };

  // --- pass 1: bucket by size -------------------------------------------
  const bySize = new Map();
  for (const file of files) {
    if (signal?.aborted) break;
    if (!file || !Number.isFinite(file.size)) continue;
    const bucket = bySize.get(file.size);
    if (bucket) bucket.push(file);
    else bySize.set(file.size, [file]);
  }

  // Windows reports ino === 0 for every file, which would make every same-size
  // pair look like a hard link. Only trust inode data when it carries meaning.
  const inoUsable = files.some((file) => file && typeof file.ino === 'number' && file.ino !== 0);

  const candidates = [];
  const hardlinkGroups = [];
  let hardlinkWastedBytes = 0;

  for (const [size, bucket] of bySize) {
    if (bucket.length < 2) continue;
    if (size > maxFileSize) continue;

    if (size === 0) {
      // Every empty file matches every other empty file; zero bytes to read,
      // so go straight to the group-building pass.
      candidates.push({ size, files: [...bucket], hash: 'empty', hashComplete: true });
      continue;
    }

    const byInode = new Map();
    if (inoUsable) {
      for (const file of bucket) {
        if (file.ino == null || file.dev == null || file.ino === 0) continue;
        const key = `${file.dev}:${file.ino}`;
        const group = byInode.get(key);
        if (group) group.push(file);
        else byInode.set(key, [file]);
      }
    }

    const distinct = [];
    const seenInodes = new Set();
    for (const file of bucket) {
      if (!inoUsable || file.ino == null || file.dev == null || file.ino === 0) {
        distinct.push(file);
        continue;
      }
      const key = `${file.dev}:${file.ino}`;
      if (seenInodes.has(key)) continue;
      seenInodes.add(key);
      distinct.push(file);
    }

    for (const group of byInode.values()) {
      if (group.length > 1) {
        checked.inodes += group.length;
        hardlinkWastedBytes += size * (group.length - 1);
        hardlinkGroups.push({
          size,
          savedBytes: size * (group.length - 1),
          files: group.map((file) => describeFile(file, root)),
        });
      }
    }

    if (distinct.length > 1) candidates.push({ size, files: distinct, hash: null });
  }

  // --- pass 2: head hash -------------------------------------------------
  const toFullHash = [];
  for (const candidate of candidates) {
    if (signal?.aborted) break;
    if (candidate.hash !== null) {
      toFullHash.push(candidate);
      continue;
    }
    const { size, files: group } = candidate;
    const heads = await mapPool(group, concurrency, async (file) => {
      const cached = cache?.get(file, `${algorithm}:head`);
      if (cached) return cached;
      try {
        const { hash } = await hashHead(file.path, algorithm, headBytes);
        cache?.set(file, `${algorithm}:head`, hash);
        return hash;
      } catch {
        return null;
      }
    });

    const buckets = new Map();
    group.forEach((file, index) => {
      const head = heads[index];
      if (head == null) return;
      checked.headHashes += 1;
      checked.bytesHashed += Math.min(size, headBytes);
      const key = size < headBytes ? `full:${head}` : head;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(file);
      else buckets.set(key, [file]);
    });

    for (const [key, bucket] of buckets) {
      if (bucket.length < 2) continue;
      if (key.startsWith('full:')) {
        // The file was smaller than the head buffer: the head hash is the full hash.
        toFullHash.push({ size, files: bucket, hash: key.slice(5), hashComplete: true });
      } else {
        toFullHash.push({ size, files: bucket, hash: null });
      }
    }
    onProgress?.({ phase: 'head', checked });
  }

  // --- pass 3: full hash -------------------------------------------------
  const groups = [];
  let wastedBytes = 0;
  let duplicateFiles = 0;

  for (const candidate of toFullHash) {
    if (signal?.aborted) break;
    const { size, files: group } = candidate;
    let hashes;
    if (candidate.hashComplete) {
      hashes = group.map(() => candidate.hash);
    } else {
      hashes = await mapPool(group, concurrency, async (file) => {
        const cached = cache?.get(file, algorithm);
        if (cached) return cached;
        try {
          const hash = await hashFile(file.path, algorithm);
          cache?.set(file, algorithm, hash);
          checked.fullHashes += 1;
          checked.bytesHashed += size;
          return hash;
        } catch {
          return null;
        }
      });
    }

    const buckets = new Map();
    group.forEach((file, index) => {
      const hash = hashes[index];
      if (hash == null) return;
      const bucket = buckets.get(hash);
      if (bucket) bucket.push(file);
      else buckets.set(hash, [file]);
    });

    for (const [hash, bucket] of buckets) {
      if (bucket.length < 2) continue;
      const saved = size * (bucket.length - 1);
      wastedBytes += saved;
      duplicateFiles += bucket.length;
      groups.push({
        hash,
        algorithm,
        size,
        copies: bucket.length,
        wastedBytes: saved,
        files: bucket
          .slice()
          .sort((a, b) => a.mtimeMs - b.mtimeMs)
          .map((file) => describeFile(file, root)),
      });
    }
    onProgress?.({ phase: 'full', checked });
  }

  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  hardlinkGroups.sort((a, b) => b.savedBytes - a.savedBytes);

  return {
    groups,
    hardlinkGroups,
    hardlinkWastedBytes,
    stats: {
      ...checked,
      duplicateFiles,
      duplicateGroups: groups.length,
      wastedBytes,
      algorithm,
    },
  };
}

function describeFile(file, root = '') {
  return {
    path: toPosix(file.path),
    display: file.display ?? (root ? relativeTo(file.path, root) : toPosix(file.path)),
    size: file.size,
    mtimeMs: file.mtimeMs,
    mtime: file.mtimeMs ? new Date(file.mtimeMs).toISOString() : null,
    sparse: isSparse(file),
  };
}

/** Path relative to the scanned root, so reports stay readable. */
function relativeTo(filePath, root) {
  const posix = toPosix(filePath);
  const base = toPosix(root).replace(/\/+$/, '');
  if (base && posix.startsWith(`${base}/`)) return posix.slice(base.length + 1);
  return posix;
}

/* ------------------------------------------------------------------ *
 * Space hogs
 * ------------------------------------------------------------------ */

/** The N largest files, biggest first. */
export function findLargeFiles(files, limit = 15, root = '') {
  return files
    .slice()
    .sort((a, b) => b.size - a.size || (a.display < b.display ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((file) => ({ ...describeFile(file, root), sparse: isSparse(file) }));
}

/* ------------------------------------------------------------------ *
 * Sparse / placeholder files
 * ------------------------------------------------------------------ */

/**
 * A file is "sparse" when the filesystem allocated far fewer blocks than the
 * logical size implies (thin provisioning, preallocated VM images, cloud
 * placeholder files). Only detectable where `stat.blocks` exists (POSIX).
 */
export function isSparse(file, { minGap = 4 * 1024 * 1024, ratio = 0.5 } = {}) {
  if (!file || file.blocks == null || !Number.isFinite(file.blocks)) return false;
  const allocated = file.blocks * 512;
  const gap = file.size - allocated;
  if (gap < minGap) return false;
  return allocated < file.size * ratio;
}

export function findSparseFiles(files, limit = 10, root = '') {
  return files
    .filter((file) => isSparse(file))
    .sort((a, b) => b.size - b.blocks * 512 - (a.size - a.blocks * 512))
    .slice(0, Math.max(0, limit))
    .map((file) => ({
      ...describeFile(file, root),
      allocatedBytes: file.blocks * 512,
      savedBytes: file.size - file.blocks * 512,
    }));
}

/* ------------------------------------------------------------------ *
 * Junk files
 * ------------------------------------------------------------------ */

/** Extensions that are near-universally regenerable or disposable. */
export const DEFAULT_JUNK_EXTENSIONS = [
  '.tmp',
  '.temp',
  '.bak',
  '.old',
  '.orig',
  '.rej',
  '.log',
  '.dmp',
  '.crdownload',
  '.part',
  '.partial',
  '.download',
  '.swp',
  '.swo',
  '.pyc',
  '.pyo',
  '.class',
  '.o',
  '.obj',
  '.tsbuildinfo',
  '.DS_Store',
  '.thumbs.db',
];

/** Exact file names (case-insensitive) treated as junk. */
export const DEFAULT_JUNK_NAMES = ['.ds_store', 'thumbs.db', 'desktop.ini', 'npm-debug.log'];

export function isJunkFile(file, { extensions = DEFAULT_JUNK_EXTENSIONS, names = DEFAULT_JUNK_NAMES } = {}) {
  const base = path.basename(file.path ?? file.display ?? '').toLowerCase();
  if (names.includes(base)) return true;
  return extensions.some((ext) => base.endsWith(ext));
}

export function findJunkFiles(files, limit = 15, options = {}) {
  const { root = '', ...matchOptions } = options;
  const matched = files.filter((file) => isJunkFile(file, matchOptions));
  const totalBytes = matched.reduce((acc, file) => acc + file.size, 0);
  const top = matched
    .slice()
    .sort((a, b) => b.size - a.size || (a.display < b.display ? -1 : 1))
    .slice(0, Math.max(0, limit))
    .map((file) => describeFile(file, root));
  return { files: top, count: matched.length, totalBytes };
}

/* ------------------------------------------------------------------ *
 * Empty directories
 * ------------------------------------------------------------------ */

/**
 * Directories that contain no files at any depth (empty folder trees).
 * A directory holding an unreadable subdirectory is kept, not reported.
 */
export function findEmptyDirs(directories, { keep = new Set() } = {}) {
  const parentOf = new Map();
  const known = new Set();
  for (const dir of directories) known.add(dir.path);
  for (const dir of directories) {
    const parent = path.dirname(dir.path);
    parentOf.set(dir.path, parent === dir.path ? null : parent);
  }

  // A directory keeps its (empty) children alive, so a folder tree with no
  // files anywhere is reported in full, deepest first.
  const notEmpty = new Set(keep);
  const ordered = directories.slice().sort((a, b) => b.depth - a.depth);
  for (const dir of ordered) {
    if (notEmpty.has(dir.path)) {
      const parent = parentOf.get(dir.path);
      if (parent && known.has(parent)) notEmpty.add(parent);
      continue;
    }
    if (dir.fileCount > 0) {
      notEmpty.add(dir.path);
      const parent = parentOf.get(dir.path);
      if (parent && known.has(parent)) notEmpty.add(parent);
    }
  }

  const empty = directories.filter((dir) => !notEmpty.has(dir.path));
  return {
    dirs: empty
      .slice()
      .sort((a, b) => b.depth - a.depth || (a.display < b.display ? -1 : 1))
      .map((dir) => ({ path: toPosix(dir.path), display: dir.display, depth: dir.depth })),
    count: empty.length,
  };
}
