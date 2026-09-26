import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { audit } from '../src/audit.js';
import { FIXTURE_TOTAL_BYTES, makeFixture } from './fixtures.js';
import { filler, makeTempDir, makeTree } from './helpers/tmp.js';

test('audit produces a complete report for the fixture tree', async () => {
  const root = await makeFixture();
  const report = await audit({ root, cachePath: null });

  assert.equal(report.tool.name, 'spacehog');
  assert.equal(report.root, path.resolve(root));
  assert.equal(report.summary.files, 7, 'node_modules is pruned by default');
  assert.equal(report.summary.totalBytes, FIXTURE_TOTAL_BYTES);
  assert.equal(report.summary.errorCount, 0);
  assert.equal(report.summary.truncated, false);
  assert.ok(report.summary.durationMs >= 0);

  // duplicates: twin-a, twin-b, nested/twin-c
  assert.equal(report.duplicates.duplicateGroups, 1);
  assert.equal(report.duplicates.duplicateFiles, 3);
  assert.equal(report.duplicates.wastedBytes, 4096 * 2);
  assert.equal(report.duplicates.algorithm, 'md5');
  assert.equal(report.duplicateGroups[0].algorithm, 'md5');
  assert.match(report.duplicateGroups[0].hash, /^[0-9a-f]{32}$/);

  // junk: scripts/build.tmp (50) + logs/app.log (120)
  assert.equal(report.junk.count, 2);
  assert.equal(report.junk.totalBytes, 170);

  // empty dirs: empty/, tree/, tree/leaf/, tree/leaf/deeper/
  const empty = report.emptyDirs.map((d) => d.display).filter((d) => d !== '');
  assert.deepEqual(empty.sort(), ['empty', 'tree', 'tree/leaf', 'tree/leaf/deeper'].sort());

  // largest files start with the twins
  assert.equal(report.largeFiles[0].size, 4096);
});

test('audit includes ignored directories when asked', async () => {
  const root = await makeFixture();
  const report = await audit({ root, ignoreDirs: false, cachePath: null });
  assert.equal(report.summary.files, 8);
  assert.equal(report.summary.ignoredDirectories, 0);
});

test('audit honours --min-size for every section', async () => {
  const root = await makeFixture();
  const report = await audit({ root, minSize: 1000, cachePath: null });
  assert.equal(report.summary.files, 7, 'the scan itself is unchanged');
  assert.ok(report.largeFiles.every((file) => file.size >= 1000));
  assert.equal(report.junk.count, 0, 'both junk files are smaller than 1 KB');
  assert.equal(report.largeFiles.length, 5);
});

test('audit can skip duplicate detection entirely', async () => {
  const root = await makeFixture();
  const report = await audit({ root, duplicates: false, cachePath: null });
  assert.equal(report.duplicateGroups.length, 0);
  assert.equal(report.duplicates.wastedBytes, 0);
  assert.equal(report.cacheCandidates.enabled, false);
});

test('audit respects maxDepth', async () => {
  const root = await makeFixture();
  const report = await audit({ root, maxDepth: 0, cachePath: null });
  assert.equal(report.summary.files, 4, 'only files directly in the root');
});

test('audit writes and then reuses a hash cache', async () => {
  // Files larger than the 64 KB head buffer, so the head and full passes are
  // genuinely two separate reads.
  const root = await makeTree({
    'big-a.bin': filler(9, 200_000),
    'big-b.bin': filler(9, 200_000),
  });
  const dir = await makeTempDir('spacehog-audit-cache-');
  const cachePath = path.join(dir, 'hashes.json');

  const first = await audit({ root, cachePath });
  assert.equal(first.cacheCandidates.enabled, true);
  assert.equal(first.cacheCandidates.saved, true);
  assert.equal(first.duplicates.fullHashes, 2);
  assert.equal(first.duplicates.wastedBytes, 200_000);

  const second = await audit({ root, cachePath });
  assert.equal(second.duplicates.fullHashes, 0, 'all hashes come from the cache');
  assert.ok(second.cacheCandidates.hits > 0);
  assert.equal(second.duplicates.wastedBytes, 200_000, 'results are identical');
});

test('audit reports unreadable trees without throwing', async () => {
  const root = await makeTree({ 'ok.txt': 'content' });
  const report = await audit({ root: path.join(root, 'gone'), cachePath: null });
  assert.equal(report.summary.files, 0);
  assert.equal(report.summary.errorCount, 1);
  assert.equal(report.errors[0].code, 'ENOENT');
});

test('audit detects sparse files where the platform exposes blocks', async () => {
  const root = await makeTree({ 'dense.bin': filler(7, 1024) });
  const report = await audit({ root, cachePath: null });
  const dense = report.largeFiles.find((file) => file.display === 'dense.bin');
  assert.ok(dense);
  assert.equal(dense.sparse, false);
  assert.equal(report.sparse.length, 0);
});

test('audit reports progress phases', async () => {
  const root = await makeFixture();
  const phases = [];
  await audit({ root, cachePath: null, onProgress: (event) => phases.push(event.phase) });
  assert.ok(phases.includes('scan'));
  assert.ok(phases.includes('analyze'));
});

test('audit stays consistent when given an algorithm other than md5', async () => {
  const root = await makeFixture();
  const report = await audit({ root, algorithm: 'sha256', cachePath: null });
  assert.equal(report.duplicates.algorithm, 'sha256');
  assert.match(report.duplicateGroups[0].hash, /^[0-9a-f]{64}$/);
  assert.equal(report.duplicates.wastedBytes, 8192);
});
