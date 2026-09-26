/**
 * "Which copy should I keep?" policies.
 *
 * Deleting is the user's call, so spacehog never does it — but a duplicate
 * group is only actionable if you know which copy is the one to keep. These
 * policies are pure functions over the files of a single group, which keeps
 * them cheap to test and impossible to get wrong in an OS-specific way.
 *
 * Every policy returns an index into the group; lower wins. `suggestKeep`
 * turns that into a keeper plus the redundant copies.
 */

import { toPosix } from './util.js';

/** Number of path segments in a display path (a shallower copy is usually the one you reach for). */
function depthOf(file) {
  const path = toPosix(file.display ?? file.path ?? '');
  return path.split('/').filter(Boolean).length;
}

/** Directory name the file sits in, lowercased, for `prefer` matching. */
function parentName(file) {
  const path = toPosix(file.path ?? file.display ?? '');
  const parts = path.split('/').filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : '').toLowerCase();
}

const POLICIES = {
  /**
   * Keep the most recently modified copy: the one you worked on last is
   * usually the live one, and the older copies are the stale ones.
   */
  newest: (file) => -mtime(file),

  /** Keep the least recently modified copy — the original of a set of copies. */
  oldest: (file) => mtime(file),

  /** Keep the copy with the shallowest path, then the shortest path. */
  'shortest-path': (file) => depthOf(file) * 1000 + String(file.display ?? file.path ?? '').length,

  /** Keep the first copy in report order (deterministic: path-sorted upstream). */
  first: () => 0,
};

function mtime(file) {
  const value = Number(file.mtimeMs);
  return Number.isFinite(value) ? value : 0;
}

export const KEEP_POLICIES = Object.keys(POLICIES);

export function isKeepPolicy(name) {
  return Object.prototype.hasOwnProperty.call(POLICIES, String(name));
}

/**
 * Index of the copy to keep within a group.
 *
 * @param {Array<object>} files files of one duplicate group
 * @param {string} policy one of KEEP_POLICIES
 * @param {{prefer?: string}} [options] `prefer` adds a strong bonus for copies
 *   whose parent directory matches the given name (e.g. `--keep-prefer original`)
 */
export function rankKeep(files, policy = 'newest', options = {}) {
  const score = POLICIES[policy] ?? POLICIES.newest;
  const prefer = options.prefer ? String(options.prefer).toLowerCase() : null;

  let bestIndex = 0;
  let bestScore = Infinity;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    // A preferred directory outweighs the policy, so it is applied as a large
    // offset rather than as a separate pass.
    const preference = prefer && parentName(file) === prefer ? -1e12 : 0;
    const value = preference + score(file, index);
    if (value < bestScore) {
      bestScore = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * Suggest a keeper for a duplicate group.
 *
 * @returns {{keep: object, redundant: object[], policy: string, prefer: string|null}}
 */
export function suggestKeep(files, policy = 'newest', options = {}) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return { keep: null, redundant: [], policy, prefer: options.prefer ?? null };
  }
  const index = rankKeep(list, policy, options);
  return {
    keep: list[index],
    redundant: list.filter((_, i) => i !== index),
    policy,
    prefer: options.prefer ? String(options.prefer).toLowerCase() : null,
  };
}

/** One-line explanation shown in the human report. */
export function explainKeep(policy, prefer = null) {
  const suffix = prefer ? `, preferring a folder named "${prefer}"` : '';
  switch (policy) {
    case 'oldest':
      return `keeping the least recently modified copy (treat it as the original)${suffix}`;
    case 'shortest-path':
      return `keeping the copy with the shallowest path${suffix}`;
    case 'first':
      return `keeping the first copy in path order${suffix}`;
    case 'newest':
    default:
      return `keeping the most recently modified copy${suffix}`;
  }
}
