#!/usr/bin/env node
/**
 * End-to-end smoke test: builds a throwaway tree, runs the real CLI against
 * it in all three output modes, and checks the exit codes.
 *
 * Usage: node scripts/smoke.js
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runCli as runCliProcess } from '../test/helpers/cli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const cli = path.join(projectRoot, 'bin', 'spacehog.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spacehog-smoke-'));
const failures = [];
const ENV = { NO_COLOR: '1', SPACEHOG_NO_PROGRESS: '1' };

function runCli(args) {
  return runCliProcess(cli, args, { cwd: projectRoot, env: ENV });
}

function check(label, condition, detail = '') {
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

try {
  fs.mkdirSync(path.join(root, 'photos', 'backup'), { recursive: true });
  fs.mkdirSync(path.join(root, 'empty-tree', 'deeper'), { recursive: true });
  fs.writeFileSync(path.join(root, 'photos', 'sunset.jpg'), Buffer.alloc(20_000, 1));
  fs.writeFileSync(path.join(root, 'photos', 'backup', 'sunset.jpg'), Buffer.alloc(20_000, 1));
  fs.writeFileSync(path.join(root, 'photos', 'notes.txt'), 'unique notes');
  fs.writeFileSync(path.join(root, 'photos', 'cache.log'), Buffer.alloc(300, 2));
  fs.writeFileSync(path.join(root, 'photos', 'report.bak'), Buffer.alloc(100, 3));

  process.stdout.write(`smoke tree: ${root}\n`);

  const text = await runCli([root]);
  check('text run exits 0', text.code === 0, `status ${text.code}`);
  check('text run mentions duplicates', /duplicates/.test(text.stdout));
  check('text run mentions the twin file', /sunset\.jpg/.test(text.stdout));
  check('text run keeps ANSI off when NO_COLOR is set', !text.stdout.includes('\u001B['));

  const json = await runCli([root, '--json']);
  check('json run exits 0', json.code === 0, `status ${json.code}`);
  let report = null;
  try {
    report = JSON.parse(json.stdout);
  } catch (error) {
    check('json output parses', false, error.message);
  }
  if (report) {
    check('json reports the empty nested folders', report.emptyDirCount >= 2, JSON.stringify(report.emptyDirs));
    check('json finds one duplicate group', report.duplicates.duplicateGroups === 1);
    check('json finds the junk files', report.junk.count === 2, String(report.junk.count));
    check(
      'json total bytes match the tree',
      report.summary.totalBytes === 20_000 * 2 + Buffer.byteLength('unique notes') + 300 + 100,
      `got ${report.summary.totalBytes}`,
    );
  }

  const markdown = await runCli([root, '--markdown']);
  check('markdown run exits 0', markdown.code === 0);
  check('markdown starts with a heading', markdown.stdout.startsWith('# spacehog report'));

  const failing = await runCli([root, '--json', '--fail-on-dupes', '10kb']);
  check('--fail-on-dupes exits 2', failing.code === 2, `status ${failing.code}`);

  const missing = await runCli([path.join(root, 'nope')]);
  check('missing path exits 1', missing.code === 1, `status ${missing.code}`);

  const help = await runCli(['--help']);
  check('--help exits 0', help.code === 0);
  check('--help prints usage', /Usage/.test(help.stdout));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\nsmoke test failed: ${failures.length} check(s)\n`);
  process.exit(1);
}
process.stdout.write('\nsmoke test passed\n');
