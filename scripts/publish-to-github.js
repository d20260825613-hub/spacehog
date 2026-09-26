#!/usr/bin/env node
/**
 * Publish this repository to GitHub without git and without gh.
 *
 * Uses the GitHub REST API (Node's built-in fetch) to create the repository,
 * upload every tracked file as a blob, build one tree + commit, and point
 * `main` at it. Nothing is installed on the machine and no credential is
 * written to disk.
 *
 * Usage (PowerShell):
 *   $env:GITHUB_TOKEN = "ghp_your_token_here"
 *   node scripts/publish-to-github.js --login <your-login> --repo spacehog
 *
 * Usage (bash):
 *   GITHUB_TOKEN=ghp_... node scripts/publish-to-github.js --login <login> --repo spacehog
 *
 * The token needs the `repo` scope (classic) or Contents + Administration:
 * write on the target repository (fine-grained). Delete the token afterwards.
 *
 * Dry run (prints what would be uploaded, contacts nothing):
 *   node scripts/publish-to-github.js --dry-run
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const { createHash } = crypto;

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const API = 'https://api.github.com';

/** Shown in the repository "About" box. Keep under 350 characters. */
const DESCRIPTION =
  'Zero-dependency CLI that finds what is eating your disk: duplicate files, ' +
  'space hogs, junk, sparse files and empty folder trees. Fast three-pass ' +
  'hashing. Reports only — never deletes.';

/** Repository topics (lowercase, digits and hyphens only). */
const TOPICS = [
  'disk-space',
  'disk-usage',
  'duplicate-files',
  'duplicate-detection',
  'cleanup',
  'cli',
  'command-line-tool',
  'nodejs',
  'javascript',
  'zero-dependencies',
  'cross-platform',
  'storage',
];

/** Never uploaded, no matter what. */
const SKIP = new Set([
  '.git',
  '.github-token',
  'node_modules',
  'spacehog.bundle',
  '.DS_Store',
  'Thumbs.db',
  'spacehog-report.json',
  // Maintainer notes: workspace-only, not part of the published repository.
  'REPO-ABOUT.md',
]);

function parseArgs(argv) {
  const values = { login: null, repo: 'spacehog', branch: 'main', private: false, dryRun: false, message: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') values.dryRun = true;
    else if (token === '--private') values.private = true;
    else if (token === '--login') values.login = argv[++i];
    else if (token === '--repo') values.repo = argv[++i];
    else if (token === '--branch') values.branch = argv[++i];
    else if (token === '--message') values.message = argv[++i];
    else if (token.startsWith('--login=')) values.login = token.slice(8);
    else if (token.startsWith('--repo=')) values.repo = token.slice(7);
    else if (token.startsWith('--branch=')) values.branch = token.slice(9);
    else if (token.startsWith('--message=')) values.message = token.slice(10);
    else {
      console.error(`unknown argument: ${token}`);
      process.exit(1);
    }
  }
  return values;
}

/** Collect every file to publish, with forward-slash repo-relative paths. */
function collectFiles(dir = projectRoot, prefix = '', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collectFiles(absolute, relative, out);
    else if (entry.isFile()) {
      const stat = fs.statSync(absolute);
      const content = fs.readFileSync(absolute);
      out.push({
        path: relative,
        absolute,
        size: stat.size,
        // Preserve the executable bit on bin/ and scripts/ for POSIX checkouts.
        mode: (stat.mode & 0o111) !== 0 ? '100755' : '100644',
        base64: content.toString('base64'),
        // Git's blob id: lets us skip files that are already identical upstream.
        sha: gitBlobSha(content),
      });
    }
  }
  return out;
}

/**
 * The id git would give this content: sha1 over "blob <len>\0<bytes>".
 * Comparing it with the remote blob sha is how we skip unchanged files.
 */
function gitBlobSha(buffer) {
  return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

/**
 * Token lookup order: environment first (never touches disk), then the
 * git-ignored `.github-token` file so the value never appears in a command line.
 */
function readToken() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const file = path.join(projectRoot, '.github-token');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw) return raw;
  } catch {
    /* no token file */
  }
  return null;
}

async function api(token, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'spacehog-publish',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = collectFiles();
  const totalBytes = files.reduce((acc, file) => acc + file.size, 0);

  console.log(`spacehog -> GitHub publisher`);
  console.log(`  files   : ${files.length}`);
  console.log(`  bytes   : ${totalBytes}`);
  console.log(`  repo    : ${args.login ? `${args.login}/${args.repo}` : `(unknown owner)/${args.repo}`}`);
  console.log(`  branch  : ${args.branch}`);

  if (args.dryRun) {
    console.log('\ndry run — nothing was uploaded. Files that would be sent:');
    for (const file of files) console.log(`  ${file.mode} ${String(file.size).padStart(8)}  ${file.path}`);
    return 0;
  }

  const token = readToken();
  if (!token) {
    console.error('\nmissing GITHUB_TOKEN.');
    console.error('PowerShell: $env:GITHUB_TOKEN = "ghp_..."');
    console.error('bash:       export GITHUB_TOKEN=ghp_...');
    console.error('Or save it in .github-token at the project root (git-ignored) and re-run.');
    console.error('Create one at https://github.com/settings/tokens/new (scope: repo).');
    return 1;
  }

  const who = await api(token, 'GET', '/user');
  if (!who.ok) {
    console.error(`\ntoken rejected (${who.status}): ${who.body?.message ?? 'unknown error'}`);
    if (who.status === 401) console.error('The token is wrong, expired, or was revoked.');
    if (who.status === 403) console.error('The token lacks the required scope.');
    return 1;
  }
  const login = args.login ?? who.body.login;
  if (args.login && args.login !== who.body.login) {
    console.error(`\ntoken belongs to "${who.body.login}", not "${args.login}". Aborting.`);
    return 1;
  }
  console.log(`\nauthenticated as ${who.body.login}`);

  const existing = await api(token, 'GET', `/repos/${login}/${args.repo}`);
  if (existing.ok) {
    console.log(`repository ${login}/${args.repo} already exists — pushing into it`);
  } else if (existing.status === 404) {
    const created = await api(token, 'POST', '/user/repos', {
      name: args.repo,
      description: DESCRIPTION,
      homepage: `https://github.com/${login}/${args.repo}`,
      private: Boolean(args.private),
      has_issues: true,
      has_wiki: false,
      has_projects: false,
      auto_init: false,
    });
    if (!created.ok) {
      console.error(`\ncould not create the repository (${created.status}): ${JSON.stringify(created.body).slice(0, 300)}`);
      return 1;
    }
    console.log(`created ${login}/${args.repo}`);
  } else {
    console.error(`\ncould not check the repository (${existing.status}): ${JSON.stringify(existing.body).slice(0, 300)}`);
    return 1;
  }

  // --- About box: description, homepage and topics ----------------------
  const patched = await api(token, 'PATCH', `/repos/${login}/${args.repo}`, {
    description: DESCRIPTION,
    homepage: `https://github.com/${login}/${args.repo}`,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
  });
  console.log(patched.ok ? 'set the repository description' : `could not set the description (${patched.status})`);

  const topics = await api(token, 'PUT', `/repos/${login}/${args.repo}/topics`, { names: TOPICS });
  if (topics.ok) {
    console.log(`set ${topics.body.names.length} topics: ${topics.body.names.join(', ')}`);
  } else {
    console.log(`could not set topics (${topics.status}) — add them by hand if you want`);
  }

  // --- push the files ---------------------------------------------------
  // The Contents API is used instead of the Git Data API on purpose: a freshly
  // created repository has no commits, and GitHub answers EVERY Git Data call
  // (blobs, trees, commits, refs) with `409 Git Repository is empty` until the
  // first commit exists. The Contents API is the only one that can write into
  // that void. As a bonus, comparing blob shas lets us skip unchanged files.
  const ref = await api(token, 'GET', `/repos/${login}/${args.repo}/git/ref/heads/${args.branch}`);
  const emptyRepo = !ref.ok && (ref.status === 404 || ref.status === 409);
  if (!ref.ok && !emptyRepo) {
    console.error(`\ncould not read refs/heads/${args.branch} (${ref.status}): ${JSON.stringify(ref.body).slice(0, 200)}`);
    return 1;
  }
  if (emptyRepo) console.log(`repository is empty — this push creates the first commit on ${args.branch}`);

  const remote = new Map();
  if (!emptyRepo) {
    const head = await api(token, 'GET', `/repos/${login}/${args.repo}/git/trees/${args.branch}?recursive=1`);
    if (head.ok) {
      for (const entry of head.body.tree ?? []) if (entry.type === 'blob') remote.set(entry.path, entry.sha);
    }
  }

  const message =
    args.message ??
    (emptyRepo
      ? `feat: spacehog 0.1.0 — zero-dependency disk audit CLI\n\n` +
        `Duplicates (three-pass), large files, junk, sparse files and empty directory\n` +
        `trees. text/json/markdown reports, a hash cache, and --fail-on-dupes for CI.`
      : `chore: sync files with the local working copy`);

  console.log('\npushing files:');
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failures = 0;
  let lastCommit = null;

  for (const file of files) {
    const remoteSha = remote.get(file.path);
    if (remoteSha === file.sha) {
      unchanged += 1;
      console.log(`  -- ${String(file.size).padStart(8)}  ${file.path} (unchanged)`);
      continue;
    }
    const payload = {
      message,
      content: file.base64,
      branch: args.branch,
      committer: {
        name: who.body.name || who.body.login,
        email: who.body.email || `${who.body.login}@users.noreply.github.com`,
      },
      ...(remoteSha ? { sha: remoteSha } : {}),
    };
    const put = await api(token, 'PUT', `/repos/${login}/${args.repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g, '/')}`, payload);
    if (!put.ok) {
      failures += 1;
      console.error(`  !! ${file.path} (${put.status}): ${JSON.stringify(put.body).slice(0, 200)}`);
      continue;
    }
    lastCommit = put.body.commit?.sha ?? lastCommit;
    if (remoteSha) updated += 1;
    else created += 1;
    console.log(`  ${remoteSha ? 'up' : 'new'} ${String(file.size).padStart(8)}  ${file.path}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} file(s) failed — re-run to retry (unchanged files are skipped).`);
    return 1;
  }

  console.log(
    `\ndone. ${created} created, ${updated} updated, ${unchanged} already up to date on ${args.branch}` +
      (lastCommit ? ` (${lastCommit.slice(0, 7)})` : ''),
  );
  console.log(`  https://github.com/${login}/${args.repo}`);
  console.log(`\nRemember to delete the token: https://github.com/settings/tokens`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`\npublish failed: ${error.message}`);
    process.exitCode = 1;
  });
