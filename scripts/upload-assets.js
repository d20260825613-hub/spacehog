#!/usr/bin/env node
/**
 * Attach the built binaries to a GitHub Release.
 *
 * Run `node scripts/build-exe.js --target win` and `--target linux` first.
 * Uploading the same file name again replaces the asset, so re-running after a
 * rebuild is safe.
 *
 * Usage:
 *   node scripts/upload-assets.js            # the version in package.json
 *   node scripts/upload-assets.js --dry-run
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const repo = 'd20260825613-hub/spacehog';
const tag = `v${pkg.version}`;
const dryRun = process.argv.includes('--dry-run');

const buildDir = path.join(projectRoot, 'tools', 'sea');

/**
 * What actually ships.
 *
 * `spacehog-cli`, not `spacehog`: both are Linux builds of the same size, but
 * `spacehog` is a superseded artifact from an earlier branch of build-exe.js and
 * its hash drifts from the checked-in `.sha256` the moment either is rebuilt.
 * Uploading a stale binary under an inviting name is worse than uploading
 * nothing, so the list names the artifact the build script produces today.
 */
const assets = [
  { file: path.join(buildDir, 'spacehog.exe'), name: 'spacehog.exe', platform: 'Windows x64 (GUI + CLI)' },
  { file: path.join(buildDir, 'spacehog-cli'), name: 'spacehog-cli', platform: 'Linux x64 (CLI only)' },
];

function run(tool, args, options = {}) {
  const dirs = ['D:\\dsh\\_tools\\git\\cmd', 'D:\\dsh\\_tools\\gh\\bin'].filter((d) => fs.existsSync(d));
  const extra = dirs.filter((d) => !(process.env.PATH ?? '').includes(d));
  const env =
    extra.length > 0
      ? { ...process.env, PATH: `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` }
      : process.env;
  const command = process.platform === 'win32' ? 'cmd' : tool;
  const commandArgs = process.platform === 'win32' ? ['/c', tool, ...args] : args;
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', env, ...options });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? (result.stderr || result.stdout || '').trim();
    throw new Error(`${tool} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

try {
  const present = assets.filter((asset) => fs.existsSync(asset.file));
  if (present.length === 0) {
    throw new Error('no built binaries in tools/sea. Run scripts/build-exe.js first.');
  }
  for (const asset of assets) {
    if (!fs.existsSync(asset.file)) {
      console.log(`  skip  ${asset.name} (not built)`);
    } else {
      console.log(`  found ${asset.name.padEnd(14)} ${(fs.statSync(asset.file).size / 1048576).toFixed(1)} MB  ${asset.platform}`);
    }
  }

  // One checksum file for everything being uploaded.
  const sums = present.map((asset) => `${sha256(asset.file)}  ${asset.name}`).join('\n');
  const sumsFile = path.join(buildDir, 'SHA256SUMS.txt');
  fs.writeFileSync(sumsFile, `${sums}\n`);
  console.log(`  wrote ${path.relative(projectRoot, sumsFile)}`);

  // The per-file `.sha256` next to each binary is what build-exe.js wrote; if it
  // disagrees with the checksum computed here, one of the two is a leftover and
  // the release would publish a checksum that does not match its own download.
  for (const asset of present) {
    const sidecar = `${asset.file}.sha256`;
    if (!fs.existsSync(sidecar)) {
      console.log(`  warn  ${asset.name} has no .sha256 next to it`);
      continue;
    }
    const recorded = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
    const actual = sha256(asset.file);
    console.log(`  ${recorded === actual ? 'ok  ' : 'STALE'} ${asset.name}.sha256`);
  }

  if (dryRun) {
    console.log(`\ndry run: would upload to ${tag} via gh release upload`);
    console.log(sums);
  } else {
    const upload = run('gh', [
      'release',
      'upload',
      tag,
      ...present.map((asset) => asset.file),
      sumsFile,
      '--clobber',
      '--repo',
      repo,
    ]);
    process.stdout.write(upload.stdout);
    console.log(`uploaded ${present.length + 1} asset(s) to ${tag}`);
  }
  console.log(`\nhttps://github.com/${repo}/releases/tag/${tag}`);
} catch (error) {
  console.error(`upload failed: ${error.message}`);
  process.exitCode = 1;
}
