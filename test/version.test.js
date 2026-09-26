import assert from 'node:assert/strict';
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
