/**
 * Programmatic API for spacehog.
 *
 * Everything the CLI does is available here, so spacehog can be embedded in a
 * script or another tool without shelling out.
 */

export { audit } from './audit.js';
export { parseArgs, buildExcludeFilter, globToRegExp, USAGE } from './args.js';
export { run, applyExclude, defaultCachePath } from './cli.js';
export {
  HASH_ALGORITHMS,
  HashCache,
  hashFile,
  hashHead,
  mapPool,
} from './hash.js';
export { KEEP_POLICIES, explainKeep, isKeepPolicy, rankKeep, suggestKeep } from './keep.js';
export {
  DEFAULT_JUNK_EXTENSIONS,
  DEFAULT_JUNK_NAMES,
  findDuplicates,
  findEmptyDirs,
  findJunkFiles,
  findLargeFiles,
  findSparseFiles,
  isJunkFile,
  isSparse,
} from './detectors.js';
export {
  createColors,
  renderJson,
  renderMarkdown,
  renderText,
  shouldUseColor,
  summarize,
} from './reporter.js';
export * from './util.js';
export { DEFAULT_IGNORED_DIRS, walk } from './walker.js';
