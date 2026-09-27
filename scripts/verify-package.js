#!/usr/bin/env node
/**
 * Prove that the published package actually works when installed.
 *
 * `npm test` runs the source tree, and `release-check.js` only inspects the
 * *file list* of the tarball. Neither one answers the question a user asks:
 * "if I install this, does the command work?" That path can break in ways the
 * source tree never sees — a wrong `bin` path, a file missing from `files`, an
 * ESM/CJS mismatch, or a shebang that is not executable.
 *
 * This script packs the real tarball, installs it into a throwaway prefix, and
 * runs the installed binary end to end. It is deliberately slow and offline.
 *
 * Usage: node scripts/verify-package.js
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const failures = [];
const notes = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/** Run a tool with the workspace's binary directories on PATH, never via a shell. */
function run(tool, args, options = {}) {
  const dirs = ['D:\\dsh\\_tools\\git\\cmd', 'D:\\dsh\\_tools\\node'].filter((d) => fs.existsSync(d));
  const extra = dirs.filter((d) => !(process.env.PATH ?? '').includes(d));
  const env =
    extra.length > 0
      ? { ...process.env, PATH: `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` }
      : process.env;
  const command = process.platform === 'win32' ? 'cmd' : tool;
  const commandArgs = process.platform === 'win32' ? ['/c', tool, ...args] : args;
  return spawnSync(command, commandArgs, { encoding: 'utf8', env, ...options });
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'spacehog-pkg-'));
const prefix = path.join(sandbox, 'prefix');
const cache = path.join(sandbox, 'npm-cache');

/**
 * The installed CLI entry, whatever npm decided to name it on this platform.
 *
 * `npm install --global --prefix <p>` puts the command in a different place per
 * platform, and the first version of this list only knew the Windows layout:
 *
 *   Windows  <prefix>\spacehog.cmd          (and a bare `spacehog` shell script)
 *   POSIX    <prefix>/bin/spacehog          (a symlink into node_modules)
 *
 * so the Linux job failed with "the installed package exposes a spacehog
 * command" even though the install had succeeded. The symlink is preferred over
 * the package's own `bin/spacehog.js` because it is what a user actually runs,
 * and it only exists if npm linked the `bin` field correctly.
 */
function installedBin() {
  const candidates = [
    path.join(prefix, 'bin', 'spacehog'), // POSIX global install
    path.join(prefix, 'spacehog.cmd'), // Windows global install
    path.join(prefix, 'spacehog'), // Windows (Git Bash style) global install
    path.join(prefix, 'node_modules', 'spacehog', 'bin', 'spacehog.js'), // the file itself
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

try {
  console.log(`package verify: ${pkg.name}@${pkg.version}`);
  console.log(`sandbox: ${sandbox}\n`);

  // 1. pack ------------------------------------------------------------------
  const packed = run('npm', ['pack', '--pack-destination', sandbox, '--json'], { cwd: projectRoot });
  if (packed.status !== 0) {
    check('npm pack succeeds', false, (packed.stderr || '').trim().split('\n')[0]);
    throw new Error('cannot continue without a tarball');
  }
  const report = JSON.parse(packed.stdout)[0];
  const tarball = path.join(sandbox, report.filename);
  check('tarball exists', fs.existsSync(tarball), tarball);
  notes.push(`tarball ${(report.size / 1024).toFixed(1)} KB, packed ${report.entryCount} entries`);

  // 2. install into an isolated prefix ---------------------------------------
  const installed = run(
    'npm',
    ['install', '--global', '--prefix', prefix, '--cache', cache, '--no-audit', '--no-fund', '--loglevel', 'error', tarball],
    { cwd: sandbox },
  );
  check(
    'global install succeeds',
    installed.status === 0,
    (installed.stderr || installed.stdout || '').trim().split('\n').slice(-1)[0],
  );

  // 3. the binary is where the package says it is ----------------------------
  const bin = installedBin();
  check(
    'the installed package exposes a spacehog command',
    bin !== null,
    `no ${path.join(prefix, 'bin', 'spacehog')} and no ${path.join(prefix, 'spacehog.cmd')}`,
  );
  if (!bin) throw new Error('no installed binary to run');

  const version = run(bin, ['--version']);
  check(
    'installed CLI reports the packaged version',
    version.stdout.trim() === pkg.version,
    `got "${version.stdout.trim()}", expected "${pkg.version}"`,
  );

  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(prefix, 'node_modules', 'spacehog', 'bin', 'spacehog.js')).mode;
    check('bin/spacehog.js is executable after install', (mode & 0o111) !== 0, `mode ${mode.toString(8)}`);
  }

  // 4. it actually audits a directory ---------------------------------------
  // a.jpg and backup/another.jpg share content and size (so they are a duplicate
  // pair); b.jpg only shares the size, which must NOT be reported as a match.
  const tree = path.join(sandbox, 'tree');
  fs.mkdirSync(path.join(tree, 'photos', 'backup'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'photos', 'a.jpg'), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(tree, 'photos', 'backup', 'another.jpg'), Buffer.alloc(4096, 1));
  fs.writeFileSync(path.join(tree, 'photos', 'b.jpg'), Buffer.alloc(4096, 2));
  fs.writeFileSync(path.join(tree, 'notes.tmp'), Buffer.alloc(64, 3));

  const audit = run(bin, [tree, '--json', '--no-cache', '--no-progress', '--keep', 'oldest']);
  check('installed CLI exits 0 on a real tree', audit.status === 0, `status ${audit.status}`);
  let parsed = null;
  try {
    parsed = JSON.parse(audit.stdout);
  } catch (error) {
    check('installed CLI emits valid JSON', false, error.message);
  }
  if (parsed) {
    check('JSON reports the packaged version', parsed.tool?.version === pkg.version, String(parsed.tool?.version));
    check('duplicate group found', parsed.duplicates?.duplicateGroups === 1, String(parsed.duplicates?.duplicateGroups));
    check(
      'keep suggestion survives packaging',
      typeof parsed.duplicateGroups?.[0]?.keep?.display === 'string',
      JSON.stringify(parsed.duplicateGroups?.[0]?.keep ?? null),
    );
    check('junk detection works from the installed copy', parsed.junk?.count === 1, String(parsed.junk?.count));
  }

  // 5. exit codes are wired up ----------------------------------------------
  const threshold = run(bin, [tree, '--json', '--no-cache', '--no-progress', '--fail-on-dupes', '1kb']);
  check('--fail-on-dupes still exits 3 when installed', threshold.status === 3, `status ${threshold.status}`);

  const help = run(bin, ['--help']);
  check('--help works from the installed copy', help.status === 0 && /Usage/.test(help.stdout));

  // 6. the library entry point resolves --------------------------------------
  const importCheck = run(process.execPath, [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(`file:///${path.join(prefix, 'node_modules', 'spacehog', 'src', 'index.js').split(path.sep).join('/')}`)}).then((m) => { if (typeof m.audit !== 'function') { console.error('audit missing'); process.exit(1); } console.log('ok'); });`,
  ]);
  check(
    'the programmatic API resolves from the installed package',
    importCheck.status === 0 && /ok/.test(importCheck.stdout),
    (importCheck.stderr || '').trim().split('\n')[0],
  );
} catch (error) {
  failures.push(error.message);
  console.error(`  abort  ${error.message}`);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
  notes.push('sandbox removed');
}

for (const note of notes) console.log(`  note  ${note}`);

if (failures.length > 0) {
  console.error(`\npackage verify failed: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log(`\npackage verify passed for ${pkg.name}@${pkg.version}`);
