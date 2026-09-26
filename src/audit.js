import {
  findDuplicates,
  findEmptyDirs,
  findJunkFiles,
  findLargeFiles,
  findSparseFiles,
} from './detectors.js';
import { HashCache } from './hash.js';
import { formatBytes, isoNow, sum, VERSION } from './util.js';
import { DEFAULT_IGNORED_DIRS, walk } from './walker.js';

/**
 * Run one full audit of a directory tree.
 *
 * @param {object} options
 * @param {string} options.root directory to scan
 * @param {number} [options.minSize] ignore files smaller than this many bytes
 * @param {number} [options.top] how many entries each section lists
 * @param {number} [options.maxDepth]
 * @param {boolean} [options.includeHidden]
 * @param {boolean} [options.ignoreDirs] prune well-known dependency folders
 * @param {boolean} [options.followSymlinks]
 * @param {number} [options.maxEntries]
 * @param {boolean} [options.duplicates] run duplicate detection
 * @param {string} [options.algorithm] md5 | sha1 | sha256
 * @param {number} [options.concurrency]
 * @param {number} [options.maxHashSize] never fully hash files above this size
 * @param {string} [options.cachePath] hash cache location (null disables it)
 * @param {(event: object) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<object>} the report object consumed by the renderers
 */
export async function audit(options) {
  const {
    root,
    minSize = 0,
    top = 15,
    maxDepth = Infinity,
    includeHidden = true,
    ignoreDirs = true,
    followSymlinks = false,
    maxEntries = Infinity,
    duplicates = true,
    algorithm = 'md5',
    concurrency = 8,
    maxHashSize = Infinity,
    cachePath = null,
    onProgress = null,
    signal = null,
  } = options;

  const startedAt = Date.now();
  onProgress?.({ phase: 'scan', stage: 'walking' });

  const walked = await walk(root, {
    ignoreDirs: ignoreDirs ? DEFAULT_IGNORED_DIRS : [],
    includeHidden,
    maxDepth,
    maxEntries,
    followSymlinks,
    signal,
    onProgress: (progress) => onProgress?.({ phase: 'scan', stage: 'walking', ...progress }),
  });

  const files = walked.files;
  const directories = walked.directories;

  const relevant = minSize > 0 ? files.filter((file) => file.size >= minSize) : files;
  const totalBytes = sum(files.map((file) => file.size));

  onProgress?.({ phase: 'analyze', stage: 'large' });
  const largeFiles = findLargeFiles(relevant, top, walked.root);
  const junk = findJunkFiles(relevant, top, { root: walked.root });
  const sparse = findSparseFiles(relevant, top, walked.root);
  const empty = findEmptyDirs(directories);

  let duplicateResult = {
    groups: [],
    hardlinkGroups: [],
    hardlinkWastedBytes: 0,
    stats: {
      algorithm,
      duplicateFiles: 0,
      duplicateGroups: 0,
      wastedBytes: 0,
      headHashes: 0,
      fullHashes: 0,
      bytesHashed: 0,
      inodes: 0,
    },
  };
  let cacheReport = { enabled: Boolean(cachePath), hits: 0, misses: 0, saved: false, entries: 0 };

  if (duplicates) {
    const cache = await HashCache.load(cachePath, { enabled: Boolean(cachePath) });    onProgress?.({ phase: 'analyze', stage: 'duplicates' });
    duplicateResult = await findDuplicates(relevant, {
      algorithm,
      cache,
      concurrency,
      maxFileSize: maxHashSize,
      root: walked.root,
      signal,
      onProgress: (event) => onProgress?.({ phase: 'analyze', stage: 'duplicates', ...event }),
    });
    const saved = await cache.save();
    cacheReport = {
      enabled: cache.enabled,
      hits: cache.hits,
      misses: cache.misses,
      saved: saved.saved,
      entries: saved.entries,
    };
  }

  const finishedAt = Date.now();

  return {
    tool: { name: 'spacehog', version: VERSION },
    generatedAt: isoNow(new Date(finishedAt)),
    root: walked.root,
    options: {
      minSize,
      top,
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : null,
      includeHidden,
      ignoreDirs,
      followSymlinks,
      duplicates,
      algorithm,
      maxHashSize: Number.isFinite(maxHashSize) ? maxHashSize : null,
    },
    summary: {
      files: walked.stats.fileCount,
      directories: walked.stats.dirCount,
      totalBytes,
      humanTotal: formatBytes(totalBytes),
      ignoredDirectories: walked.stats.skippedDirCount,
      symlinksSkipped: followSymlinks ? 0 : walked.stats.symlinkCount,
      errorCount: walked.errors.length,
      truncated: walked.stats.truncated,
      durationMs: finishedAt - startedAt,
    },
    duplicates: duplicateResult.stats,
    duplicateGroups: duplicateResult.groups,
    hardlinkGroups: duplicateResult.hardlinkGroups,
    hardlinkSavedBytes: duplicateResult.hardlinkWastedBytes,
    cacheCandidates: cacheReport,
    largeFiles,
    junk,
    sparse,
    emptyDirs: empty.dirs,
    emptyDirCount: empty.count,
    errors: walked.errors,
  };
}
