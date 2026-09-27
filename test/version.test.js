import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../src/util.js';

/**
 * The version lives in two places on purpose: `package.json` is what npm and
 * GitHub read, and `src/util.js` is what the CLI prints without touching the
 * filesystem or needing JSON import attributes (Node 18 cannot import JSON).
 *
 * Duplication without a guard drifts: the tool would report 0.1.0 while npm
 * serves 0.2.0. These tests are that guard, so a release cannot silently ship
 * an inconsistent version. `npm run release:check` runs the stricter,
 * publish-oriented version of the same idea.
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

test('the CLI version matches package.json', () => {
  assert.equal(
    VERSION,
    pkg.version,
    `src/util.js says ${VERSION} but package.json says ${pkg.version}; bump both`,
  );
});

test('the version is a plain semver string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, `unexpected version format: ${VERSION}`);
});

test('CHANGELOG documents the current version', () => {
  const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`## [${VERSION}]`),
    `CHANGELOG.md has no "## [${VERSION}]" section; add one before releasing`,
  );
  assert.ok(
    changelog.includes(`[${VERSION}]: `),
    `CHANGELOG.md has no link reference for ${VERSION}`,
  );
});

test('package.json still declares no runtime dependencies', () => {
  const runtime = pkg.dependencies ?? {};
  assert.deepEqual(
    Object.keys(runtime),
    [],
    `spacehog must stay dependency-free, found: ${Object.keys(runtime).join(', ')}`,
  );
});

test('the published package ships the CLI, the API and the licence', () => {
  const files = pkg.files ?? [];
  for (const required of ['bin', 'src', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(required), `package.json "files" is missing "${required}"`);
  }
  assert.equal(pkg.bin?.spacehog, 'bin/spacehog.js', 'the bin entry must point at bin/spacehog.js');
  assert.ok(pkg.engines?.node, 'package.json must declare the minimum Node version');
});

test('the repository metadata points at the real repository', () => {
  const url = String(pkg.repository?.url ?? '');
  assert.match(url, /d20260825613-hub\/spacehog/, `repository url looks wrong: ${url}`);
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module', 'the package is ESM');
});

/**
 * The checksum manifest is hand-adjacent data that no other test touches, and it
 * has already drifted once in a way nobody noticed: `SHA256SUMS.txt` listed a
 * hash for `spacehog.exe` that matched nothing, and omitted `spacehog-cli`
 * entirely. A checksum file that does not match its own download is worse than
 * no checksum file, so the two are compared whenever the binaries are present.
 *
 * The binaries are git-ignored, so a fresh clone skips this. `upload-assets.js`
 * regenerates the manifest as part of every upload.
 */
test('the checksum manifest matches the binaries it describes', () => {
  const buildDir = path.join(projectRoot, 'tools', 'sea');
  const sumsFile = path.join(buildDir, 'SHA256SUMS.txt');
  if (!fs.existsSync(sumsFile)) return;

  const lines = fs
    .readFileSync(sumsFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.ok(lines.length > 0, 'SHA256SUMS.txt is empty');

  const described = new Set();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})\s+(.+)$/.exec(line);
    assert.ok(match, `SHA256SUMS.txt has a malformed line: ${line}`);
    const [, expected, name] = match;
    const file = path.join(buildDir, name);
    if (!fs.existsSync(file)) continue; // binary not built on this machine
    described.add(name);
    const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(actual, expected, `SHA256SUMS.txt is stale for ${name}`);
  }

  for (const name of described) {
    const sidecar = path.join(buildDir, `${name}.sha256`);
    if (!fs.existsSync(sidecar)) continue;
    const recorded = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
    const expected = lines.find((line) => line.endsWith(`  ${name}`))?.split(/\s+/)[0];
    assert.equal(recorded, expected, `${name}.sha256 disagrees with SHA256SUMS.txt`);
  }
});
