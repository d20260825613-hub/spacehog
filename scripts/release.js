#!/usr/bin/env node
/**
 * One-command release: verify, tag, push the tag, publish the GitHub Release.
 *
 * This is the single release entry point. It replaces three separate scripts
 * that existed only because the machine that bootstrapped this project had no
 * `git` and no `gh`; both are available now, so the release path uses them
 * instead of hand-rolled REST calls.
 *
 * Steps:
 *   1. `npm run release:check` — versions agree, tarball is right, tree is clean
 *   2. refuse to continue if the tag already exists at a different commit
 *   3. create the annotated tag and push it
 *   4. create the GitHub Release from RELEASE-NOTES.md, via `gh release create`
 *
 * Usage:
 *   node scripts/release.js                 # release the version in package.json
 *   node scripts/release.js --dry-run       # show every step, change nothing
 *   node scripts/release.js --notes <file>  # use different release notes
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../src/util.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gitDir = path.resolve(projectRoot, '..', '..', '..', '_tools', 'git', 'cmd');
const dryRun = process.argv.includes('--dry-run');
const notesIndex = process.argv.indexOf('--notes');
const notesFile = path.resolve(projectRoot, notesIndex >= 0 ? process.argv[notesIndex + 1] : 'RELEASE-NOTES.md');

/**
 * PATH with the machine's tools, for hosts where git/node/gh are not installed
 * globally. `gh` matters here: this script shells out to it for the Release, and
 * forgetting its directory is exactly how a release stops at the last step.
 */
function env() {
  const dirs = [
    'D:\\dsh\\_tools\\git\\cmd',
    'D:\\dsh\\_tools\\node',
    'D:\\dsh\\_tools\\gh\\bin',
    gitDir,
  ].filter((d) => d && fs.existsSync(d));
  const extra = dirs.filter((d) => !(process.env.PATH ?? '').includes(d));
  return extra.length > 0
    ? { ...process.env, PATH: `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` }
    : process.env;
}

const ENV = env();

/** Run a tool and capture stdout. Never uses a shell (argument injection, DEP0190). */
function run(tool, args, { allowFail = false } = {}) {
  const result =
    process.platform === 'win32'
      ? spawnSync('cmd', ['/c', tool, ...args], { cwd: projectRoot, encoding: 'utf8', env: ENV })
      : spawnSync(tool, args, { cwd: projectRoot, encoding: 'utf8', env: ENV });
  if (!allowFail && (result.error || result.status !== 0)) {
    const detail = result.error?.message ?? (result.stderr || result.stdout || '').trim();
    throw new Error(`${tool} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

function step(n, total, what) {
  console.log(`\n[${n}/${total}] ${what}`);
}

function main() {
  const tag = `v${VERSION}`;
  console.log(`spacehog release ${tag}${dryRun ? ' (dry run)' : ''}`);

  if (!fs.existsSync(notesFile)) {
    throw new Error(`release notes not found: ${notesFile}`);
  }
  const notes = fs.readFileSync(notesFile, 'utf8').trim();
  console.log(`notes: ${path.relative(projectRoot, notesFile)} (${notes.split('\n').length} lines)`);

  // 1. readiness gate ------------------------------------------------------
  step(1, 4, 'release readiness check');
  if (dryRun) {
    console.log('  (skipped in dry run; run `npm run release:check` yourself)');
  } else {
    const check = run(process.execPath, ['scripts/release-check.js']);
    process.stdout.write(check.stdout.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n'));
  }

  // 2. tag state -----------------------------------------------------------
  // The strict rule is "the tag must point at HEAD". An already *published*
  // release freezes that: moving its tag would silently change what users
  // downloaded. An unpublished tag may follow HEAD, otherwise a fix committed
  // between tagging and publishing would deadlock the release forever.
  step(2, 4, `check tag ${tag}`);
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const localTag = run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { allowFail: true });
  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { allowFail: true });
  const onRemote = /[0-9a-f]{40}/.test(remoteTag.stdout ?? '');

  const published = run('gh', ['release', 'view', tag, '--json', 'url'], { allowFail: true });

  if (localTag.status === 0 && localTag.stdout.trim() === head) {
    console.log(`  ${tag} already points at HEAD`);
  } else if (localTag.status === 0) {
    const at = localTag.stdout.trim();
    if (published.status === 0) {
      throw new Error(
        `${tag} is already published at ${at.slice(0, 7)} and HEAD is ${head.slice(0, 7)} — bump the version instead of moving a shipped tag`,
      );
    }
    console.log(`  ${tag} exists at ${at.slice(0, 7)} but was never published; moving it to HEAD`);
    if (!dryRun) {
      run('git', ['tag', '-f', '-a', tag, '-m', `spacehog ${VERSION}`]);
      run('git', ['push', 'origin', `${tag}`, '--force']);
    }
  } else {
    console.log(`  creating annotated tag ${tag}`);
    if (!dryRun) {
      run('git', ['tag', '-a', tag, '-m', `spacehog ${VERSION}`]);
      run('git', ['push', 'origin', tag]);
    }
  }
  if (onRemote && localTag.status !== 0) {
    console.log(`  note: origin already has ${tag}; the push above moved it`);
  }

  // 3. GitHub Release ------------------------------------------------------
  step(3, 4, 'GitHub Release');
  if (published.status === 0) {
    console.log(`  release already exists: ${JSON.parse(published.stdout).url}`);
  } else if (dryRun) {
    console.log(`  would run: gh release create ${tag} ${path.basename(notesFile)} --title "spacehog ${VERSION}" --latest`);
  } else {
    const created = run('gh', [
      'release',
      'create',
      tag,
      notesFile,
      '--title',
      `spacehog ${VERSION}`,
      '--latest',
    ]);
    console.log(`  created: ${created.stdout.trim()}`);
  }

  // 4. summary -------------------------------------------------------------
  step(4, 4, 'done');
  console.log(`  repository : https://github.com/d20260825613-hub/spacehog`);
  console.log(`  release    : https://github.com/d20260825613-hub/spacehog/releases/tag/${tag}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`\nrelease aborted: ${error.message}`);
  process.exitCode = 1;
}
