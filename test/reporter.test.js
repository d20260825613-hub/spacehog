import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createColors,
  renderJson,
  renderMarkdown,
  renderText,
  shouldUseColor,
  summarize,
  terminalWidth,
} from '../src/reporter.js';

const FIXED_NOW = Date.UTC(2024, 5, 15, 12, 0, 0);

/** A hand-written report object: reporter tests must not depend on the scanner. */
function makeReport(overrides = {}) {
  const day = 86_400_000;
  return {
    tool: { name: 'spacehog', version: '0.1.0' },
    generatedAt: '2024-06-15T12:00:00Z',
    root: '/data/photos',
    options: { minSize: 0, top: 15 },
    summary: {
      files: 6,
      directories: 4,
      totalBytes: 10 * 1024 ** 2,
      humanTotal: '10 MB',
      ignoredDirectories: 1,
      symlinksSkipped: 0,
      errorCount: 0,
      truncated: false,
      durationMs: 1234,
    },
    duplicates: {
      algorithm: 'md5',
      headHashes: 4,
      fullHashes: 2,
      bytesHashed: 4096,
      inodes: 0,
      duplicateFiles: 2,
      duplicateGroups: 1,
      wastedBytes: 4 * 1024 ** 2,
    },
    duplicateGroups: [
      {
        hash: 'abcdef0123456789abcdef0123456789',
        algorithm: 'md5',
        size: 4 * 1024 ** 2,
        copies: 2,
        wastedBytes: 4 * 1024 ** 2,
        files: [
          { path: '/data/photos/a.jpg', display: 'a.jpg', size: 4 * 1024 ** 2, mtimeMs: FIXED_NOW - 2 * day, mtime: null, sparse: false },
          { path: '/data/photos/backup/a.jpg', display: 'backup/a.jpg', size: 4 * 1024 ** 2, mtimeMs: FIXED_NOW - 30 * day, mtime: null, sparse: false },
        ],
      },
    ],
    hardlinkGroups: [],
    hardlinkSavedBytes: 0,
    cacheCandidates: { enabled: true, hits: 3, misses: 1, saved: true, entries: 3 },
    largeFiles: [
      { path: '/data/photos/a.jpg', display: 'a.jpg', size: 4 * 1024 ** 2, mtimeMs: FIXED_NOW - 2 * day, mtime: null, sparse: false },
      { path: '/data/photos/video.mov', display: 'video.mov', size: 5 * 1024 ** 2, mtimeMs: FIXED_NOW - 400 * day, mtime: null, sparse: true },
    ],
    junk: {
      count: 2,
      totalBytes: 1024,
      files: [
        { path: '/data/photos/thumbs.db', display: 'thumbs.db', size: 1024, mtimeMs: FIXED_NOW, mtime: null, sparse: false },
      ],
    },
    sparse: [],
    emptyDirs: [{ path: '/data/photos/empty', display: 'empty', depth: 1 }],
    emptyDirCount: 1,
    errors: [],
    ...overrides,
  };
}

test('createColors emits ANSI codes only when enabled', () => {
  const plain = createColors(false);
  assert.equal(plain.bold('x'), 'x');
  assert.equal(plain('x', 'red'), 'x');
  assert.equal(plain.red('x'), 'x');

  const color = createColors(true);
  assert.equal(color.red('x'), '\u001B[31mx\u001B[0m');
  assert.equal(color.bold('x'), '\u001B[1mx\u001B[0m');
  assert.match(color('x', 'red', 'bold'), /^\u001B\[31m\u001B\[1mx/);
});

test('shouldUseColor follows flags, NO_COLOR, FORCE_COLOR and TTY detection', () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  assert.equal(shouldUseColor({ flag: true, stream: pipe, env: {} }), true);
  assert.equal(shouldUseColor({ flag: false, stream: tty, env: {} }), false);
  assert.equal(shouldUseColor({ stream: tty, env: {} }), true);
  assert.equal(shouldUseColor({ stream: pipe, env: {} }), false);
  assert.equal(shouldUseColor({ stream: tty, env: { NO_COLOR: '1' } }), false);
  assert.equal(shouldUseColor({ stream: pipe, env: { FORCE_COLOR: '1' } }), true);
  assert.equal(shouldUseColor({ stream: tty, env: { TERM: 'dumb' } }), false);
});

test('terminalWidth clamps odd values', () => {
  assert.equal(terminalWidth({ columns: 120 }), 120);
  assert.equal(terminalWidth({ columns: 500 }), 160);
  assert.equal(terminalWidth({ columns: 5 }), 100);
  assert.equal(terminalWidth({}), 100);
});

test('summarize derives reclaimable bytes and severity', () => {
  const big = summarize(makeReport(), FIXED_NOW);
  assert.equal(big.wasted, 4 * 1024 ** 2);
  assert.equal(big.junk, 1024);
  assert.equal(big.reclaimable, 4 * 1024 ** 2 + 1024);
  assert.equal(big.severity, 'high');

  const clean = summarize(
    makeReport({
      duplicates: { ...makeReport().duplicates, wastedBytes: 0 },
      junk: { count: 0, totalBytes: 0, files: [] },
    }),
    FIXED_NOW,
  );
  assert.equal(clean.severity, 'info');
  assert.match(clean.headline, /tidy/);

  const small = summarize(
    makeReport({
      summary: { ...makeReport().summary, totalBytes: 10 * 1024 ** 3 },
      duplicates: { ...makeReport().duplicates, wastedBytes: 1024 },
      junk: { count: 0, totalBytes: 0, files: [] },
    }),
    FIXED_NOW,
  );
  assert.equal(small.severity, 'low');
});

test('renderText prints every section header and the key numbers', () => {
  const text = renderText(makeReport(), { color: false, width: 100, now: FIXED_NOW });
  assert.match(text, /spacehog v0\.1\.0/);
  assert.match(text, /\/data\/photos/);
  assert.match(text, /▌ duplicates/);
  assert.match(text, /▌ largest files/);
  assert.match(text, /▌ junk/);
  assert.match(text, /▌ empty directories/);
  assert.match(text, /4 MB × 2/);
  assert.match(text, /abcdef012345/);
  assert.match(text, /thumbs\.db/);
  assert.match(text, /empty/);
  assert.match(text, /1\.23s/);
  assert.equal(text.includes('\u001B['), false, 'no ANSI codes when color is off');
});

test('renderText emits ANSI codes when color is on', () => {
  const text = renderText(makeReport(), { color: true, width: 100, now: FIXED_NOW });
  assert.match(text, /\u001B\[/);
});

test('renderText surfaces errors and truncation warnings', () => {
  const report = makeReport({
    summary: { ...makeReport().summary, errorCount: 2, truncated: true },
    errors: [{ path: '/root/secret', code: 'EACCES', message: 'denied' }],
  });
  const text = renderText(report, { color: false, now: FIXED_NOW });
  assert.match(text, /2 path\(s\) could not be read/);
  assert.match(text, /file limit reached/);
});

test('renderText says so when a tree is clean', () => {
  const report = makeReport({
    duplicates: { ...makeReport().duplicates, wastedBytes: 0, duplicateFiles: 0, duplicateGroups: 0 },
    duplicateGroups: [],
    junk: { count: 0, totalBytes: 0, files: [] },
    emptyDirs: [],
    emptyDirCount: 0,
    sparse: [],
    largeFiles: [],
  });
  const text = renderText(report, { color: false, now: FIXED_NOW });
  assert.match(text, /no duplicate content found/);
  assert.match(text, /no obvious junk files/);
  assert.match(text, /✓ none/);
});

test('renderJson round-trips and can be pretty printed', () => {
  const report = makeReport();
  const compact = renderJson(report);
  assert.equal(compact.includes('\n'), false);
  assert.deepEqual(JSON.parse(compact), report);

  const pretty = renderJson(report, { pretty: true });
  assert.match(pretty, /\n {2}"tool"/);
  assert.deepEqual(JSON.parse(pretty), report);
});

test('renderMarkdown produces a readable issue-ready report', () => {
  const markdown = renderMarkdown(makeReport(), { now: FIXED_NOW });
  assert.match(markdown, /^# spacehog report/m);
  assert.match(markdown, /\*\*Root:\*\* `\/data\/photos`/);
  assert.match(markdown, /## Duplicates/);
  assert.match(markdown, /\| Size \| Copies \| Reclaimable \| Sample path \|/);
  assert.match(markdown, /<details><summary>Group 1/);
  assert.match(markdown, /## Largest files/);
  assert.match(markdown, /## Junk/);
  assert.match(markdown, /## Empty directories/);
});

test('renderMarkdown escapes pipes in paths so tables stay intact', () => {
  const report = makeReport();
  const sample = report.duplicateGroups[0].files[0];
  sample.path = '/data/we|ird/a.jpg';
  sample.display = 'we|ird/a.jpg';
  const markdown = renderMarkdown(report, { now: FIXED_NOW });
  assert.match(markdown, /we\\\|ird/);
});
