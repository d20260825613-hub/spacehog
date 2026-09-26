#!/usr/bin/env node
/**
 * One-shot bootstrap for the spacehog repository: publish files, then tag v0.1.0.
 *
 *   node --use-system-ca scripts/publish-and-release.js
 *
 * Token lookup: GITHUB_TOKEN / GH_TOKEN in the environment, else the git-ignored
 * `.github-token` file at the project root. A fine-grained token needs
 * Repository permissions -> Contents: Read and write, and (to create the tag)
 * Account permissions -> Administration: Read and write.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN = 'd20260825613-hub';
const REPO = 'spacehog';
const TAG = 'v0.1.0';

function readToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.github-token'), 'utf8').trim();
    if (raw) return raw;
  } catch {
    /* no file */
  }
  return null;
}

const token = readToken();
if (!token) {
  console.error('No token found.');
  console.error('');
  console.error('Option A — new token (fastest):');
  console.error('  1. open https://github.com/settings/tokens?type=beta');
  console.error('  2. the existing "spacehog" token -> Repository permissions ->');
  console.error('     Contents: Read and write');
  console.error('  3. Account permissions -> Administration: Read and write');
  console.error('  4. Update token, then save it as .github-token and re-run this script');
  console.error('');
  console.error('Option B — paste an existing classic token into .github-token');
  process.exit(1);
}

const headers = {
  accept: 'application/vnd.github+json',
  'user-agent': 'spacehog-bootstrap',
  'x-github-api-version': '2022-11-28',
  authorization: `Bearer ${token}`,
};

async function call(method, route, body) {
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

// 1. push the working copy
console.log('=== step 1/3: publishing files ===');
const published = spawnSync(
  process.execPath,
  ['--use-system-ca', path.join(projectRoot, 'scripts', 'publish-to-github.js'), '--login', LOGIN, '--repo', REPO],
  { cwd: projectRoot, stdio: 'inherit', env: process.env },
);
if (published.status !== 0) {
  console.error(`\npublish step failed (exit ${published.status}) — stopping before the tag.`);
  process.exit(published.status ?? 1);
}

// 2. read the resulting head commit
console.log('\n=== step 2/3: locating main ===');
const ref = await call('GET', `/repos/${LOGIN}/${REPO}/git/ref/heads/main`);
if (!ref.ok) {
  console.error(`could not read main (${ref.status}): ${JSON.stringify(ref.body).slice(0, 200)}`);
  process.exit(1);
}
const headSha = ref.body.object.sha;
console.log(`main is at ${headSha.slice(0, 7)}`);

// 3. create the annotated tag (idempotent: an existing tag is fine)
console.log('\n=== step 3/3: tagging ===');
const existing = await call('GET', `/repos/${LOGIN}/${REPO}/git/ref/tags/${TAG}`);
if (existing.ok) {
  console.log(`${TAG} already exists at ${existing.body.object.sha.slice(0, 7)} — nothing to do`);
} else {
  const tag = await call('POST', `/repos/${LOGIN}/${REPO}/git/tags`, {
    tag: TAG,
    message: 'spacehog 0.1.0 — first release',
    object: headSha,
    type: 'commit',
  });
  if (!tag.ok) {
    console.error(`could not create the tag object (${tag.status}): ${JSON.stringify(tag.body).slice(0, 300)}`);
    console.error('A fine-grained token needs Account permissions -> Administration: Read and write for this.');
    process.exit(1);
  }
  const created = await call('POST', `/repos/${LOGIN}/${REPO}/git/refs`, { ref: `refs/tags/${TAG}`, sha: tag.body.sha });
  if (!created.ok) {
    console.error(`could not create the tag ref (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`created ${TAG} -> ${headSha.slice(0, 7)}`);
}

console.log('\ndone.');
console.log(`  repository: https://github.com/${LOGIN}/${REPO}`);
console.log(`  release   : https://github.com/${LOGIN}/${REPO}/releases/new?tag=${TAG} (paste REPO-ABOUT.md notes)`);
console.log('\nDelete the token when you are finished: https://github.com/settings/tokens');
