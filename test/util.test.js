import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clamp,
  commonRoot,
  ellipsize,
  formatAge,
  formatBytes,
  formatDuration,
  formatBytes as fb,
  parseSize,
  sum,
  toPosix,
} from '../src/util.js';

test('formatBytes uses binary steps and clean integers', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 ** 2), '1 MB');
  assert.equal(formatBytes(1024 ** 3 * 2.5), '2.5 GB');
  assert.equal(formatBytes(1024 ** 4), '1 TB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
});

test('formatBytes can drop the space for narrow columns', () => {
  assert.equal(fb(1024, { space: false }), '1KB');
});

test('parseSize understands units, case and bare bytes', () => {
  assert.equal(parseSize('0'), 0);
  assert.equal(parseSize('512'), 512);
  assert.equal(parseSize('1kb'), 1024);
  assert.equal(parseSize('1KB'), 1024);
  assert.equal(parseSize('2mb'), 2 * 1024 ** 2);
  assert.equal(parseSize('2 MB'), 2 * 1024 ** 2);
  assert.equal(parseSize('1.5gb'), Math.floor(1.5 * 1024 ** 3));
  assert.equal(parseSize('3b'), 3);
  assert.equal(parseSize(4096), 4096);
  assert.equal(parseSize('nonsense'), null);
  assert.equal(parseSize('-1'), null);
  assert.equal(parseSize('10 zb'), null);
  assert.equal(parseSize(undefined), null);
});

test('formatBytes and parseSize round-trip on whole units', () => {
  for (const value of [1024, 1024 ** 2, 5 * 1024 ** 2, 1024 ** 3]) {
    const text = formatBytes(value);
    assert.equal(parseSize(text), value, `${value} -> ${text}`);
  }
});

test('toPosix normalizes Windows separators only', () => {
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
  assert.equal(toPosix('a/b/c'), 'a/b/c');
  assert.equal(toPosix('/tmp/x'), '/tmp/x');
});

test('commonRoot finds the shared prefix', () => {
  assert.equal(commonRoot(['/a/b/c.txt', '/a/b/d.txt']), '/a/b');
  assert.equal(commonRoot(['/a/b', '/x/y']), '');
  assert.equal(commonRoot([]), '');
  assert.equal(commonRoot(['/only/file']), '/only/file');
});

test('ellipsize keeps both ends of long paths', () => {
  assert.equal(ellipsize('short', 10), 'short');
  assert.equal(ellipsize('abcdefghijklmnop', 9).length, 9);
  assert.match(ellipsize('abcdefghijklmnop', 9), /…/);
  assert.equal(ellipsize('abcdefghijklmnop', 3), 'abcdefghijklmnop');
});

test('clamp and sum behave', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(sum([]), 0);
  assert.equal(sum([1, 2, 3]), 6);
});

test('formatDuration switches units', () => {
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(250), '250ms');
  assert.equal(formatDuration(1500), '1.50s');
  assert.equal(formatDuration(15_000), '15.0s');
  assert.equal(formatDuration(65_000), '1m05s');
});

test('formatAge buckets by minute, hour, day and month', () => {
  const now = Date.UTC(2024, 0, 31, 12, 0, 0);
  const minute = 60_000;
  assert.equal(formatAge(now - 10_000, now), 'just now');
  assert.equal(formatAge(now - 5 * minute, now), '5m ago');
  assert.equal(formatAge(now - 3 * 60 * minute, now), '3h ago');
  assert.equal(formatAge(now - 2 * 24 * 60 * minute, now), '2d ago');
  assert.equal(formatAge(now - 60 * 24 * 60 * minute, now), '1mo ago');
  assert.equal(formatAge(now - 400 * 24 * 60 * minute, now), '1y ago');
  assert.equal(formatAge(0, now), 'unknown');
});
