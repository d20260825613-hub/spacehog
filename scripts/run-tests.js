#!/usr/bin/env node
/**
 * Version-portable test runner.
 *
 * `node --test` changed how it discovers files, and the two obvious forms are
 * mutually exclusive:
 *   - Node 18-20: expand `test/*.test.js`? No — the glob is passed through and
 *     the run dies with "Could not find ...test\*.test.js". They only accept
 *     real paths.
 *   - Node 21+:  glob patterns and explicit file paths both work, but a bare
 *     directory is treated as a module specifier ("Cannot find module .../test").
 *
 * A bare directory is also a trap on Node 18-20 for a second reason: those
 * versions walk `test/` recursively and execute EVERY .js file they find, so
 * `test/fixtures.js` and `test/helpers/*.js` get loaded and reported as three
 * bogus "tests" (101 instead of 98).
 *
 * So: always hand over the explicit list of top-level `test/*.test.js` files.
 * That is the one form whose meaning is identical on 18, 20, 22 and 24.
 *
 * Usage: node scripts/run-tests.js [extra node --test args]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(projectRoot, 'test');

const files = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  console.error(`no *.test.js files found in ${testDir}`);
  process.exit(1);
}

const args = ['--test', ...files.map((name) => path.join('test', name)), ...process.argv.slice(2)];

console.log(`node ${process.versions.node} -> node ${args.join(' ')}`);
const result = spawnSync(process.execPath, args, { cwd: projectRoot, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
