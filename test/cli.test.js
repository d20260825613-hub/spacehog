import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { applyExclude, defaultCachePath, run } from '../src/cli.js';
import { buildExcludeFilter } from '../src/args.js';
import { makeFixture } from './fixtures.js';
import { filler, makeTempDir, makeTree } from './helpers/tmp.js';

/** Collect output written to an injected stream. */
function captureStream() {
  const chunks = [];
  return {
    isTTY: false,
    columns: 100,
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}

/** Run the CLI with captured streams and no colors. */
async function runCli(argv, extra = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const code = await run(argv, {
    stdout,
    stderr,
    env: { NO_COLOR: '1', SPACEHOG_NO_PROGRESS: '1' },
    ...extra,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test('run prints usage for --help and exits 0', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /spacehog — find out what is eating your disk/);
  assert.match(stdout, /Usage/);
});

test('run prints the version for --version and exits 0', async () => {
  const { code, stdout } = await runCli(['--version']);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('run rejects bad arguments with exit code 2 and a suggestion', async () => {
  const { code, stdout, stderr } = await runCli(['--nonsense']);
  assert.equal(code, 2, 'arguments being wrong is code 2, not 1');
  assert.match(stderr, /unknown option: --nonsense/);
  assert.match(stderr, /run with --help/);
  assert.equal(stdout, '');
});

test('a mistyped option is matched to the closest real one', async () => {
  const cases = [
    ['--colr', '--color'],
    ['--hashh', '--hash'],
    ['--ignore-dir', '--ignore-dirs'],
    ['--follow-symlink', '--follow-symlinks'],
  ];
  for (const [typo, expected] of cases) {
    const { code, stderr } = await runCli([typo]);
    assert.equal(code, 2, `${typo} should be an argument error`);
    assert.match(stderr, new RegExp(`did you mean ${expected}\\?`), `wrong suggestion for ${typo}: ${stderr.trim()}`);
  }
});

test('an option with no value says so instead of reading undefined', async () => {
  const { code, stderr } = await runCli(['--top']);
  assert.equal(code, 2);
  assert.match(stderr, /--top requires a value/);
  assert.match(stderr, /for example --top <value>/);
});

test('a bad choice names the closest allowed value', async () => {
  const { code, stderr } = await runCli(['--keep', 'oldst', '.']);
  assert.equal(code, 2);
  assert.match(stderr, /did you mean oldest\?/);
});

test('a usage error never prints a stack trace', async () => {
  const { stderr } = await runCli(['--nonsense']);
  assert.equal(/at .*\(.*:\d+:\d+\)/.test(stderr), false, 'stack frames leaked into a friendly error');
  assert.equal(stderr.split('\n').filter((line) => line.trim()).length, 2, 'message plus hint, nothing else');
});

test('run fails cleanly when the path does not exist', async () => {
  const { code, stderr } = await runCli([path.join('no', 'such', 'directory')]);
  assert.equal(code, 2, 'a path that does not exist is an argument problem');
  assert.match(stderr, /cannot access/);
});

test('run prints a text report for the fixture tree', async () => {
  const root = await makeFixture();
  const { code, stdout } = await runCli([root, '--no-progress']);
  assert.equal(code, 0);
  assert.match(stdout, /▌ duplicates/);
  assert.match(stdout, /twin-a\.bin/);
  assert.match(stdout, /▌ empty directories/);
});

test('run emits parseable JSON with --json', async () => {
  const root = await makeFixture();
  const { code, stdout } = await runCli([root, '--json', '--pretty']);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.tool.name, 'spacehog');
  assert.equal(report.summary.files, 7);
  assert.equal(report.duplicates.duplicateFiles, 3);
  assert.equal(report.root, path.resolve(root));
  assert.equal(report.options.minSize, 0);
});

test('run emits Markdown with --markdown', async () => {
  const root = await makeFixture();
  const { code, stdout } = await runCli([root, '--markdown']);
  assert.equal(code, 0);
  assert.match(stdout, /^# spacehog report/);
  assert.match(stdout, /## Duplicates/);
});

test('run honours --top and --min-size', async () => {
  const root = await makeFixture();
  const { stdout } = await runCli([root, '--json', '--top', '1', '--min-size', '1kb']);
  const report = JSON.parse(stdout);
  assert.equal(report.largeFiles.length, 1);
  assert.equal(report.junk.count, 0);
  assert.equal(report.options.minSize, 1024);
});

test('run exits 2 when --fail-on-dupes is reached, and 0 when it is not', async () => {
  const root = await makeFixture();
  const reached = await runCli([root, '--json', '--fail-on-dupes', '1kb']);
  assert.equal(reached.code, 2);
  assert.match(reached.stderr, /reached the --fail-on-dupes threshold/);
  assert.ok(JSON.parse(reached.stdout), 'the report is still produced');

  const notReached = await runCli([root, '--json', '--fail-on-dupes', '1gb']);
  assert.equal(notReached.code, 0);
  assert.equal(notReached.stderr.includes('threshold'), false);
});

test('run skips duplicate detection with --no-duplicates', async () => {
  const root = await makeFixture();
  const { stdout } = await runCli([root, '--json', '--no-duplicates']);
  const report = JSON.parse(stdout);
  assert.equal(report.duplicateGroups.length, 0);
  assert.equal(report.duplicates.wastedBytes, 0);
});

test('run writes a hash cache and does not need it (--no-cache)', async () => {
  const cacheDir = await makeTempDir('spacehog-cli-cache-');
  const root = await makeTree({
    'a.bin': filler(6, 120_000),
    'b.bin': filler(6, 120_000),
  });
  const cache = path.join(cacheDir, 'hashes.json');

  const first = await runCli([root, '--json', '--cache', cache]);
  assert.equal(first.code, 0);
  assert.equal(JSON.parse(first.stdout).cacheCandidates.saved, true);

  const second = await runCli([root, '--json', '--cache', cache]);
  assert.equal(JSON.parse(second.stdout).duplicates.fullHashes, 0);

  const third = await runCli([root, '--json', '--no-cache']);
  assert.equal(JSON.parse(third.stdout).cacheCandidates.enabled, false);
});

test('run accepts several paths and reports each', async () => {
  const a = await makeTree({ 'one.txt': 'first tree' });
  const b = await makeTree({ 'two.txt': 'second tree' });
  const { code, stdout } = await runCli([a, b, '--json']);
  assert.equal(code, 0);
  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((report) => report.root), [path.resolve(a), path.resolve(b)]);
});

test('run applies --exclude to every section', async () => {
  const root = await makeTree({
    'keep/a.txt': 'duplicate body',
    'skip/a.txt': 'duplicate body',
    'keep/b.bin': filler(1, 5000),
    'skip/b.bin': filler(1, 5000),
  });
  const { stdout } = await runCli([root, '--json', '--exclude', '**/skip/**', '--min-size', '1kb']);
  const report = JSON.parse(stdout);
  assert.equal(report.duplicateGroups.length, 0, 'the only copies left are unique per folder');
  assert.equal(report.duplicates.wastedBytes, 0);
  assert.equal(report.largeFiles.length, 1, 'only the kept 5 KB file is left');
  assert.match(report.largeFiles[0].path, /keep\/b\.bin$/);
  assert.deepEqual(report.options.exclude, ['**/skip/**']);
});

test('defaultCachePath is platform aware', () => {
  const win = defaultCachePath({ LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'win32');
  assert.match(win.split(path.sep).join('/'), /spacehog\/hashes\.json$/);
  assert.match(win, /AppData/);

  const linux = defaultCachePath({ XDG_CACHE_HOME: '/home/x/.cache' }, 'linux');
  assert.equal(linux.split(path.sep).join('/'), '/home/x/.cache/spacehog/hashes.json');
});

test('applyExclude recomputes duplicate totals', () => {
  const report = {
    options: {},
    duplicateGroups: [
      {
        hash: 'h',
        algorithm: 'md5',
        size: 100,
        copies: 3,
        wastedBytes: 200,
        files: [{ path: '/a/one' }, { path: '/b/two' }, { path: '/skip/three' }],
      },
    ],
    largeFiles: [{ path: '/skip/big' }, { path: '/a/small' }],
    sparse: [],
    junk: { files: [{ path: '/skip/j.tmp' }], count: 1, totalBytes: 1 },
    emptyDirs: [{ path: '/skip/empty' }],
    emptyDirCount: 1,
    duplicates: { wastedBytes: 200, duplicateFiles: 3, duplicateGroups: 1 },
  };

  const filtered = applyExclude(report, buildExcludeFilter(['**/skip/**']), ['**/skip/**']);
  assert.equal(filtered.duplicateGroups.length, 1);
  assert.equal(filtered.duplicateGroups[0].copies, 2);
  assert.equal(filtered.duplicateGroups[0].wastedBytes, 100);
  assert.equal(filtered.duplicates.wastedBytes, 100);
  assert.equal(filtered.duplicates.duplicateFiles, 2);
  assert.equal(filtered.largeFiles.length, 1);
  assert.equal(filtered.junk.count, 0);
  assert.equal(filtered.emptyDirCount, 0);
  assert.deepEqual(filtered.options.exclude, ['**/skip/**']);
});

test('applyExclude drops groups that no longer have two copies', () => {
  const report = {
    options: {},
    duplicateGroups: [
      {
        hash: 'h',
        algorithm: 'md5',
        size: 100,
        copies: 2,
        wastedBytes: 100,
        files: [{ path: '/a/one' }, { path: '/skip/two' }],
      },
    ],
    largeFiles: [],
    sparse: [],
    junk: { files: [], count: 0, totalBytes: 0 },
    emptyDirs: [],
    emptyDirCount: 0,
    duplicates: { wastedBytes: 100, duplicateFiles: 2, duplicateGroups: 1 },
  };
  const filtered = applyExclude(report, buildExcludeFilter(['**/skip/**']), ['**/skip/**']);
  assert.deepEqual(filtered.duplicateGroups, []);
  assert.equal(filtered.duplicates.wastedBytes, 0);
});
