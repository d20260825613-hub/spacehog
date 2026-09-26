#!/usr/bin/env node
/**
 * Sandbox-friendly test driver.
 *
 * `node --test test/` is the normal way to run this suite, but it forks one
 * child process per test file, which some restricted environments block
 * (spawn EPERM). This script runs every test file in its own plain node
 * process instead, so the suite still runs with a single command there.
 *
 * Usage: node scripts/test-files.js [testDir]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const testDir = path.resolve(projectRoot, process.argv[2] ?? 'test');

const files = fs
  .readdirSync(testDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.js'))
  .map((entry) => path.join(testDir, entry.name))
  .sort();

if (files.length === 0) {
  console.error(`no *.test.js files found in ${testDir}`);
  process.exit(1);
}

let failed = 0;
const failedFiles = [];

for (const file of files) {
  const relative = path.relative(projectRoot, file);
  process.stdout.write(`\n=== ${relative} ===\n`);
  const result = spawnSync(process.execPath, [file], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' },
  });
  if (result.status !== 0) {
    failed += 1;
    failedFiles.push(relative);
  }
}

process.stdout.write(`\n${files.length - failed}/${files.length} test file(s) passed\n`);
if (failed > 0) {
  process.stdout.write(`failing: ${failedFiles.join(', ')}\n`);
  process.exit(1);
}
