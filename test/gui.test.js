import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test, { after } from 'node:test';

import { isRunning, resolveSpawnTarget, startGui } from '../src/gui/server.js';
import { filler, makeTree } from './helpers/tmp.js';

/**
 * End-to-end cover for the GUI's HTTP surface, against the *development* code
 * path (`node src/gui/main.js`), not the packaged binary.
 *
 * That is deliberate. `POST /api/run` used to answer with a bare `{"exit":1}`
 * and no output at all, because the server watched `req` for "the client went
 * away" — and `req` emits `'close'` the moment its body is consumed, which is
 * before the child process wrote anything. Only a test that actually starts a
 * server, streams a scan and reads the chunks back catches that; unit-testing
 * the handler in isolation does not.
 *
 * `fetch` is avoided on purpose: it honours HTTP_PROXY, so a machine with a
 * proxy configured would send these loopback requests to a proxy.
 */

const servers = [];
after(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
});

/** Start the GUI on a random port and return its origin. */
async function startTestGui() {
  const { url, server } = await startGui({ open: async () => true });
  servers.push(server);
  return url.replace(/\/$/, '');
}

/** Minimal JSON request helper: works on every supported Node, ignores proxies. */
function request(origin, { method = 'GET', path: route = '/', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(body);
    const target = new URL(route, origin);
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method,
        headers: {
          connection: 'close',
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('resolveSpawnTarget runs the CLI child, not node itself', () => {
  // Packaged build: the executable is the program, so `--cli` comes first and
  // the same file switches to CLI mode.
  const packaged = resolveSpawnTarget({ execPath: 'C:\\app\\spacehog.exe' });
  assert.equal(packaged.command, 'C:\\app\\spacehog.exe');
  assert.deepEqual(packaged.args(['.', '--json']), ['--cli', '.', '--json']);

  // Development build: node needs a script path, otherwise `--cli` is rejected
  // as a bad node option. The script is the dedicated CLI child — never the
  // file that happened to start the GUI (that would be this test file).
  const dev = resolveSpawnTarget({
    argv: ['C:\\node\\node.exe', path.join('src', 'gui', 'main.js')],
    execPathFallback: 'C:\\node\\node.exe',
  });
  assert.equal(dev.command, 'C:\\node\\node.exe');
  const [script, ...rest] = dev.args(['.', '--json']);
  assert.equal(path.basename(script), 'cli-child.js');
  assert.equal(fs.existsSync(script), true, `the CLI child entry point is missing: ${script}`);
  assert.deepEqual(rest, ['.', '--json']);
  assert.equal(script.includes('gui.test.js'), false, 'the GUI would respawn the test runner');
});

test('isRunning is false once a child has an exit code or a signal', () => {
  assert.equal(isRunning({ exitCode: null, signalCode: null }), true);
  assert.equal(isRunning({ exitCode: 0, signalCode: null }), false);
  assert.equal(isRunning({ exitCode: null, signalCode: 'SIGTERM' }), false);
});

test('the GUI serves its page and reports the version', async () => {
  const origin = await startTestGui();

  const page = await request(origin, { path: '/' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.text, /<title>spacehog<\/title>/);

  const version = await request(origin, { path: '/api/version' });
  assert.equal(version.status, 200);
  const info = JSON.parse(version.text);
  assert.match(info.version, /^\d+\.\d+\.\d+$/);
  // Under `node --test` the CLI is started through a script, so the reported
  // program is node rather than a packaged binary — the honest answer.
  assert.equal(info.exe, path.basename(process.execPath));
});

test('unknown routes are 404 and bad bodies are 400', async () => {
  const origin = await startTestGui();

  const missing = await request(origin, { path: '/nope' });
  assert.equal(missing.status, 404);
  assert.deepEqual(JSON.parse(missing.text), { error: 'not found' });

  const broken = await request(origin, { method: 'POST', path: '/api/run', body: 'not json' });
  assert.equal(broken.status, 400);

  const wrongShape = await request(origin, {
    method: 'POST',
    path: '/api/run',
    body: JSON.stringify({ args: 'not-an-array' }),
  });
  assert.equal(wrongShape.status, 400);
});

test('POST /api/run streams the scan as NDJSON and ends with an exit code', async () => {
  const root = await makeTree({
    'photos/a.jpg': filler(1, 8192),
    'photos/b.jpg': filler(1, 8192),
    'notes.tmp': filler(2, 128),
  });
  const origin = await startTestGui();

  const response = await request(origin, {
    method: 'POST',
    path: '/api/run',
    body: JSON.stringify({ args: [root, '--no-cache', '--no-progress', '--top', '3'] }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /ndjson/);

  const messages = response.text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const output = messages.map((message) => message.chunk ?? '').join('');

  assert.ok(
    messages.some((message) => typeof message.chunk === 'string' && message.chunk.length > 0),
    `the scan produced no output at all: ${response.text.slice(0, 200)}`,
  );
  assert.equal(messages.at(-1).exit, 0, 'the last line is the exit code');
  assert.match(output, /a\.jpg/);
  assert.match(output, /notes\.tmp/, 'junk detection still runs through the GUI');
});

test('POST /api/run surfaces a bad argument as exit code 2', async () => {
  const origin = await startTestGui();
  const response = await request(origin, {
    method: 'POST',
    path: '/api/run',
    body: JSON.stringify({ args: ['--nonsense'] }),
  });

  const messages = response.text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const output = messages.map((message) => message.chunk ?? '').join('');

  assert.equal(messages.at(-1).exit, 2, 'the page needs the real exit code to colour the result');
  assert.match(output, /unknown option/);
});
