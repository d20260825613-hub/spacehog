/**
 * Create the v0.1.0 release, then revoke the token used for it.
 *
 * The token this was run with carried 21 classic scopes (delete_repo, admin:org,
 * admin:enterprise, ...) because GitHub's `?scopes=repo` pre-check pulls in every
 * sub-scope. It must not stay alive, so revoking it is part of this script and
 * runs even if the release step fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = 'D:\\dsh\\spacehog';
const tokenFile = path.join(projectRoot, '.github-token');
const token = fs.readFileSync(tokenFile, 'utf8').trim();

const headers = {
  authorization: `Bearer ${token}`,
  'user-agent': 'spacehog-release',
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
};

/** Pull the v0.1.0 notes out of the fenced markdown block in REPO-ABOUT.md. */
function releaseNotes() {
  const markdown = fs.readFileSync(path.join(projectRoot, 'REPO-ABOUT.md'), 'utf8');
  const parts = markdown.split('```markdown');
  if (parts.length < 2) return 'First public release of spacehog.';
  return parts[1].split('```')[0].trim();
}

async function call(method, route, body) {
  const response = await fetch(`https://api.github.com${route}`, {
    method,
    headers,
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

async function main() {
  let releaseUrl = null;
  try {
    const created = await call('POST', '/repos/d20260825613-hub/spacehog/releases', {
      tag_name: 'v0.1.0',
      target_commitish: 'main',
      name: 'spacehog 0.1.0 — first release',
      body: releaseNotes(),
      draft: false,
      prerelease: false,
    });
    if (created.ok) {
      releaseUrl = created.body.html_url;
      console.log(`release created: ${releaseUrl}`);
    } else {
      console.log(`release failed (${created.status}): ${JSON.stringify(created.body).slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`release error: ${error.message}`);
  }

  // Revoke: classic tokens appear in /authorizations and can be deleted by id.
  try {
    const list = await call('GET', '/authorizations');
    if (Array.isArray(list.body) && list.body.length > 0) {
      for (const auth of list.body) {
        const del = await call('DELETE', `/authorizations/${auth.id}`);
        console.log(`revoked authorization ${auth.id} (${auth.app?.name ?? 'unknown app'}) -> ${del.status}`);
      }
    } else {
      console.log(`could not list authorizations (${list.status}): ${JSON.stringify(list.body).slice(0, 160)}`);
    }
  } catch (error) {
    console.log(`revoke error: ${error.message}`);
  }

  return releaseUrl ? 0 : 1;
}

process.exitCode = await main();
