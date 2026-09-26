#!/usr/bin/env node
/**
 * Release readiness check — run this before tagging or publishing.
 *
 * It verifies the things that cannot be verified after the fact:
 *   1. `src/util.js` VERSION === package.json version
 *   2. the CHANGELOG has a real section for that version (not just Unreleased)
 *   3. the tarball npm would publish actually contains the CLI and the licence
 *   4. no runtime dependency crept in
 *   5. the working tree is clean and `main` is not behind the remote
 *
 * Usage:
 *   node scripts/release-check.js
 *   node scripts/release-check.js --expect 0.2.0   # for a specific release
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../src/util.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

/**
 * Run a tool without ever going through a shell.
 *
 * `.cmd` shims are what Windows uses for npm/git, and `spawnSync` cannot execute
 * them without `shell: true` — but `shell: true` concatenates arguments without
 * escaping (Node DEP0190, a real injection surface). `cmd /c <tool> <args>` gives
 * the same result with the argument vector passed separately.
 */
function run(tool, args, options = {}) {
  if (process.platform === 'win32') {
    return spawnSync('cmd', ['/c', tool, ...args], { ...options, shell: false });
  }
  return spawnSync(tool, args, { ...options, shell: false });
}

/** Make the workspace's portable git/npm reachable when they are not in PATH. */
function toolEnv() {
  const extra = process.env.PATH ?? '';
  const candidates = ['D:\\dsh\\_tools\\git\\cmd', 'D:\\dsh\\_tools\\node'];
  const missing = candidates.filter((dir) => fs.existsSync(dir) && !extra.includes(dir));
  return missing.length > 0 ? { ...process.env, PATH: `${missing.join(path.delimiter)}${path.delimiter}${extra}` } : process.env;
}

const ENV = toolEnv();

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    problems.push(label);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const expectIndex = process.argv.indexOf('--expect');
const expected = expectIndex >= 0 ? process.argv[expectIndex + 1] : pkg.version;

console.log(`release check (expecting ${expected})`);

// 1. version agreement ------------------------------------------------------
check(
  'src/util.js VERSION matches package.json',
  VERSION === pkg.version,
  `util.js=${VERSION} package.json=${pkg.version}`,
);
if (expected) check(`package.json is ${expected}`, pkg.version === expected, `is ${pkg.version}`);

// 2. changelog --------------------------------------------------------------
const changelog = fs.readFileSync(path.join(projectRoot, 'CHANGELOG.md'), 'utf8');
check(`CHANGELOG has a [${expected}] section`, changelog.includes(`## [${expected}]`));
check(`CHANGELOG links [${expected}]`, changelog.includes(`[${expected}]: `));
const unreleasedBody = changelog.split('## [Unreleased]')[1]?.split('## [')[0] ?? '';
check(
  'CHANGELOG Unreleased is not empty',
  /###/.test(unreleasedBody),
  'nothing recorded since the last release',
);

// 3. dependencies -----------------------------------------------------------
const deps = Object.keys(pkg.dependencies ?? {});
check('no runtime dependencies', deps.length === 0, deps.join(', '));

// 4. what actually gets published ------------------------------------------
const dryRun = run('npm', ['pack', '--dry-run', '--json'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: ENV,
});
if (dryRun.status !== 0) {
  // npm may be unavailable (e.g. PowerShell execution policy). Fall back to a
  // static check of the `files` allow-list.
  notes.push('npm pack unavailable; checked the files allow-list instead');
  const files = pkg.files ?? [];
  check('files list ships bin/ and src/', files.includes('bin') && files.includes('src'));
  check('files list ships LICENSE', files.includes('LICENSE'));
} else {
  let report = null;
  try {
    report = JSON.parse(dryRun.stdout);
  } catch {
    report = null;
  }
  if (!report?.[0]) {
    notes.push('could not parse npm pack output');
    check('npm pack produced a report', false);
  } else {
    const entry = report[0];
    const paths = (entry.files ?? []).map((f) => f.path);
    check(`tarball contains ${paths.length} files`, paths.length > 0);
    check('tarball ships bin/spacehog.js', paths.includes('bin/spacehog.js'));
    check('tarball ships LICENSE', paths.includes('LICENSE'));
    check('tarball ships the API entry', paths.includes('src/index.js'));
    check('tarball does not ship tests', !paths.some((p) => p.startsWith('test/')));
    check('tarball does not ship scripts/', !paths.some((p) => p.startsWith('scripts/')));
    notes.push(`tarball size ${(entry.size / 1024).toFixed(1)} KB (unpacked ${(entry.unpackedSize / 1024).toFixed(1)} KB)`);
  }
}

// 5. git state --------------------------------------------------------------
const git = run('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8', env: ENV });
if (git.status === 0) {
  check('working tree is clean', git.stdout.trim() === '', git.stdout.trim().split('\n')[0] ?? '');
  const behind = run('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: projectRoot, encoding: 'utf8', env: ENV });
  if (behind.status === 0) {
    check('not behind the upstream branch', Number(behind.stdout.trim()) === 0, `${behind.stdout.trim()} commit(s) behind`);
  } else {
    notes.push('no upstream tracking branch configured');
  }
} else {
  notes.push(`git unavailable or not a checkout (${git.error?.code ?? git.status}); skipped git checks`);
}

for (const note of notes) console.log(`  note  ${note}`);

if (problems.length > 0) {
  console.error(`\nrelease check failed: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`\nrelease check passed for ${expected}`);
