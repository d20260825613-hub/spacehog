import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExcludeFilter, globToRegExp, parseArgs, USAGE } from '../src/args.js';

test('parseArgs fills documented defaults and defaults the path to "."', () => {
  const parsed = parseArgs([]);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.paths, ['.']);
  assert.equal(parsed.values.top, 15);
  assert.equal(parsed.values['min-size'], 0);
  assert.equal(parsed.values.hash, 'md5');
  assert.equal(parsed.values.concurrency, 8);
  assert.equal(parsed.values.duplicates, true);
  assert.equal(parsed.values.hidden, true);
  assert.equal(parsed.values['ignore-dirs'], true);
  assert.deepEqual(parsed.values.exclude, []);
});

test('parseArgs reads long options with a space or an equals sign', () => {
  const spaced = parseArgs(['--top', '5', '--hash', 'sha256', '--min-size', '2mb', 'dir']);
  assert.equal(spaced.ok, true);
  assert.equal(spaced.values.top, 5);
  assert.equal(spaced.values.hash, 'sha256');
  assert.equal(spaced.values['min-size'], 2 * 1024 ** 2);
  assert.deepEqual(spaced.paths, ['dir']);

  const equals = parseArgs(['--top=7', '--hash=sha1', '--min-size=1kb']);
  assert.equal(equals.values.top, 7);
  assert.equal(equals.values.hash, 'sha1');
  assert.equal(equals.values['min-size'], 1024);
});

test('parseArgs reads short options and glued values', () => {
  const short = parseArgs(['-n', '3', '-s', '10kb', '-a', 'sha1', 'x']);
  assert.equal(short.values.top, 3);
  assert.equal(short.values['min-size'], 10 * 1024);
  assert.equal(short.values.hash, 'sha1');

  const glued = parseArgs(['-n20']);
  assert.equal(glued.values.top, 20);

  const gluedWithEquals = parseArgs(['-n=25']);
  assert.equal(gluedWithEquals.values.top, 25);
});

test('parseArgs bundles boolean short flags and reports a short value flag with nothing left', () => {
  const bundled = parseArgs(['-hv']);
  assert.equal(bundled.ok, true);
  assert.equal(bundled.values.help, true);
  assert.equal(bundled.values.version, true);

  // -n is glued to the rest of the token, so "v" is its value, not --version.
  const glued = parseArgs(['-nv']);
  assert.equal(glued.ok, false);
  assert.match(glued.message, /--top expects a number, got "v"/);

  const dangling = parseArgs(['-n']);
  assert.equal(dangling.ok, false);
  assert.match(dangling.message, /-n \(--top\) requires a value/);
});

test('parseArgs supports boolean negation for negatable flags', () => {
  const parsed = parseArgs(['--no-duplicates', '--no-hidden', '--no-ignore-dirs', '--no-progress', '--no-color']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.values.duplicates, false);
  assert.equal(parsed.values.hidden, false);
  assert.equal(parsed.values['ignore-dirs'], false);
  assert.equal(parsed.values.progress, false);
  assert.equal(parsed.values.color, false);
});

test('parseArgs repeats --exclude into a list', () => {
  const parsed = parseArgs(['--exclude', '*/tmp/*', '--exclude=*/cache/*']);
  assert.deepEqual(parsed.values.exclude, ['*/tmp/*', '*/cache/*']);
});

test('parseArgs rejects unknown options and bad values', () => {
  assert.match(parseArgs(['--nope']).message, /unknown option: --nope/);
  assert.match(parseArgs(['-z']).message, /unknown option: -z/);
  assert.match(parseArgs(['--top', 'abc']).message, /expects a number/);
  assert.match(parseArgs(['--top']).message, /requires a value/);
  assert.match(parseArgs(['--min-size', '2 flurbs']).message, /expects a size/);
  assert.match(parseArgs(['--hash', 'crc32']).message, /must be one of/);
  assert.match(parseArgs(['--top', '-1']).message, /must be >= 0/);
  assert.match(parseArgs(['--json=maybe']).message, /takes no value/);
});

test('parseArgs treats everything after -- as paths', () => {
  const parsed = parseArgs(['--top', '2', '--', '--not-an-option', '-x']);
  assert.equal(parsed.values.top, 2);
  assert.deepEqual(parsed.paths, ['--not-an-option', '-x']);
});

test('parseArgs accepts several paths and single-dash stdin-ish tokens as paths', () => {
  const parsed = parseArgs(['a', 'b', '-']);
  assert.deepEqual(parsed.paths, ['a', 'b', '-']);
});

test('globToRegExp implements the documented glob subset', () => {
  assert.equal(globToRegExp('*/backup/*').test('x/backup/y'), true);
  assert.equal(globToRegExp('*.tmp').test('a/b/c.tmp'), true);
  assert.equal(globToRegExp('*.tmp').test('a/b/c.txt'), false);
  assert.equal(globToRegExp('a/**/z').test('a/b/c/z'), true);
  assert.equal(globToRegExp('a?.txt').test('ab.txt'), true);
  assert.equal(globToRegExp('a?.txt').test('abc.txt'), false);
  assert.equal(globToRegExp('literal.name').test('literalXname'), false);
});

test('buildExcludeFilter matches any pattern and is cheap when empty', () => {
  const none = buildExcludeFilter([]);
  assert.equal(none('anything/at/all'), false);

  const filter = buildExcludeFilter(['**/node_modules/**', '*.log']);
  assert.equal(filter('src/node_modules/x/y.js'), true);
  assert.equal(filter('node_modules/x.js'), true);
  assert.equal(filter('logs/app.log'), true);
  assert.equal(filter('src/index.js'), false);
  assert.equal(filter('logs/app.log.bak'), false);

  // A single * never crosses a path separator.
  const shallow = buildExcludeFilter(['*/node_modules/*']);
  assert.equal(shallow('src/node_modules/x.js'), true);
  assert.equal(shallow('src/node_modules/x/y.js'), false);
});

test('USAGE documents every exit code and the example commands', () => {
  assert.match(USAGE, /Exit codes/);
  assert.match(USAGE, /--fail-on-dupes/);
  assert.match(USAGE, /spacehog ~\/Downloads/);
});
