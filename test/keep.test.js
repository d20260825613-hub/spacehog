import assert from 'node:assert/strict';
import test from 'node:test';

import { KEEP_POLICIES, explainKeep, isKeepPolicy, rankKeep, suggestKeep } from '../src/keep.js';

/** Minimal file records as `describeFile` produces them. */
function file(display, mtimeMs, dir = '') {
  const path = dir ? `${dir}/${display}` : `/${display}`;
  return { path, display, mtimeMs, size: 100 };
}

/**
 * Three copies with distinct properties:
 *   /a.jpg                  depth 2, newest of the shallow ones
 *   /photos/a.jpg           depth 3, oldest, parent folder "photos"
 *   /photos/backup/a.jpg    depth 4, newest overall, parent folder "backup"
 */
const GROUP = [
  file('photos/a.jpg', 1_000, 'photos'),
  file('a.jpg', 5_000),
  file('backup/a.jpg', 9_000, 'photos'),
];

test('KEEP_POLICIES lists the documented policies', () => {
  assert.deepEqual(KEEP_POLICIES, ['newest', 'oldest', 'shortest-path', 'first']);
  assert.equal(isKeepPolicy('newest'), true);
  assert.equal(isKeepPolicy('sha1'), false);
  assert.equal(isKeepPolicy('constructor'), false, 'must not be fooled by prototype keys');
});

test('newest keeps the most recently modified copy', () => {
  const index = rankKeep(GROUP, 'newest');
  assert.equal(GROUP[index].display, 'backup/a.jpg');
});

test('oldest keeps the least recently modified copy', () => {
  const index = rankKeep(GROUP, 'oldest');
  assert.equal(index, 0);
  assert.equal(GROUP[index].display, 'photos/a.jpg');
});

test('shortest-path keeps the copy closest to the root', () => {
  const index = rankKeep(GROUP, 'shortest-path');
  // a.jpg is depth 2; the other two are depth 3 and 4
  assert.equal(index, 1);
  assert.equal(GROUP[index].display, 'a.jpg');
});

test('shortest-path breaks ties on total path length', () => {
  const group = [file('deep/nested/long-name-here.jpg', 1), file('b.jpg', 1)];
  assert.equal(rankKeep(group, 'shortest-path'), 1);
});

test('first keeps the first copy in report order', () => {
  assert.equal(rankKeep(GROUP, 'first'), 0);
});

test('an unknown policy falls back to newest instead of throwing', () => {
  assert.equal(rankKeep(GROUP, 'nonsense'), rankKeep(GROUP, 'newest'));
});

test('keep-prefer overrides the policy for copies in a folder with that name', () => {
  // `prefer` matches the file's immediate parent folder, not any ancestor.
  const index = rankKeep(GROUP, 'newest', { prefer: 'photos' });
  assert.equal(index, 0, 'the copy in photos/ wins even though it is the oldest');
  assert.equal(GROUP[index].display, 'photos/a.jpg');

  // photos/backup/a.jpg sits in "backup", so it matches its own parent name.
  assert.equal(rankKeep(GROUP, 'oldest', { prefer: 'backup' }), 2);

  assert.equal(rankKeep(GROUP, 'newest', { prefer: 'PHOTOS' }), 0, 'matching is case-insensitive');
});

test('keep-prefer does not match an ancestor folder or a missing folder', () => {
  // "photos" is an ancestor of photos/backup/a.jpg but not its parent.
  assert.equal(rankKeep(GROUP, 'oldest', { prefer: 'photos' }), 0);
  assert.equal(rankKeep(GROUP, 'newest', { prefer: 'nowhere' }), rankKeep(GROUP, 'newest'));
});

test('suggestKeep returns the keeper and every redundant copy', () => {
  const suggestion = suggestKeep(GROUP, 'oldest');
  assert.equal(suggestion.keep.display, 'photos/a.jpg');
  assert.equal(suggestion.policy, 'oldest');
  assert.equal(suggestion.prefer, null);
  assert.equal(suggestion.redundant.length, 2);
  assert.equal(suggestion.redundant.some((f) => f.display === suggestion.keep.display), false);
});

test('suggestKeep handles a single file and an empty group', () => {
  const single = suggestKeep([file('only.bin', 1)], 'newest');
  assert.equal(single.keep.display, 'only.bin');
  assert.deepEqual(single.redundant, []);

  const empty = suggestKeep([], 'newest');
  assert.equal(empty.keep, null);
  assert.deepEqual(empty.redundant, []);
});

test('suggestKeep tolerates a missing or invalid mtime', () => {
  const messy = [
    { path: '/x/a.bin', display: 'a.bin', size: 1 },
    { path: '/x/b.bin', display: 'b.bin', size: 1, mtimeMs: Number.NaN },
    { path: '/x/c.bin', display: 'c.bin', size: 1, mtimeMs: 500 },
  ];
  const suggestion = suggestKeep(messy, 'newest');
  assert.equal(suggestion.keep.display, 'c.bin');
  assert.equal(suggestion.redundant.length, 2);
});

test('explainKeep describes each policy, including prefer', () => {
  assert.match(explainKeep('newest'), /most recently modified/);
  assert.match(explainKeep('oldest'), /least recently modified/);
  assert.match(explainKeep('shortest-path'), /shallowest/);
  assert.match(explainKeep('first'), /first copy in path order/);
  assert.match(explainKeep('newest', 'original'), /folder named "original"/);
  assert.match(explainKeep('unknown-policy'), /most recently modified/);
});
