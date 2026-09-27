#!/usr/bin/env node
/**
 * Exercise the GUI binary the way a user would, without a browser in the loop.
 *
 * Starts spacehog.exe with no arguments, discovers the port it bound, then
 * checks every endpoint the page calls: the version banner, the folder picker
 * (skipped when nobody can click it), and a real scan streamed back as NDJSON.
 *
 * Usage: node scripts/verify-gui.js
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = path.join(projectRoot, 'tools', 'sea', 'spacehog.exe');

if (process.platform !== 'win32') {
  console.error('the GUI build is Windows-only');
  process.exit(1);
}
if (!fs.existsSync(exe)) {
  console.error(`missing ${exe}. Run: node scripts/build-exe.js --target win`);
  process.exit(1);
}

/**
 * Find the port the GUI bound.
 *
 * The port is chosen by the OS, so it is asked for rather than guessed: a
 * probe over an arbitrary range is fragile. `Get-NetTCPConnection` is part of
 * Windows and needs no extra tooling.
 */
async function findPort(pid, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-NetTCPConnection -OwningProcess ${pid} -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1).LocalPort`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const port = Number(String(result.stdout ?? '').trim());
    if (Number.isInteger(port) && port > 0) return port;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`the GUI process (pid ${pid}) never bound a loopback port`);
}

const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'spacehog-gui-'));
fs.mkdirSync(path.join(tree, 'photos'), { recursive: true });
fs.writeFileSync(path.join(tree, 'photos', 'a.jpg'), Buffer.alloc(8192, 1));
fs.writeFileSync(path.join(tree, 'photos', 'b.jpg'), Buffer.alloc(8192, 1));
fs.writeFileSync(path.join(tree, 'notes.tmp'), Buffer.alloc(128, 2));

const failures = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok   ' : 'FAIL '} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const child = spawn(exe, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  const port = await findPort(child.pid);
  const base = `http://127.0.0.1:${port}`;
  console.log(`gui listening on ${base}\n`);

  const page = await fetch(`${base}/`);
  const html = await page.text();
  check('GET / serves the page', page.ok && /<title>spacehog<\/title>/.test(html));
  check('the page is the bundled one', html.includes('api/run') && html.includes('Folder to scan'));

  const version = await (await fetch(`${base}/api/version`)).json();
  check('GET /api/version reports the version', /^\d+\.\d+\.\d+$/.test(version.version), JSON.stringify(version));
  check('GET /api/version reports the exe name', version.exe === 'spacehog.exe', version.exe);

  const missing = await fetch(`${base}/nope`);
  check('unknown routes are 404', missing.status === 404, String(missing.status));

  const bad = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"args":"not-an-array"}',
  });
  check('a malformed run request is rejected', bad.status === 400, String(bad.status));

  // Real scan, streamed as NDJSON exactly like the page consumes it.
  const scan = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: [tree, '--no-cache', '--no-progress', '--keep', 'oldest', '--top', '3'] }),
  });
  const text = await scan.text();
  const messages = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
  const output = messages.map((m) => m.chunk ?? '').join('');
  const exit = messages.find((m) => m.exit !== undefined)?.exit;

  check('the scan streams NDJSON chunks', messages.some((m) => typeof m.chunk === 'string'));
  check('the scan reports an exit code', exit === 0, String(exit));
  check('output mentions the duplicate pair', /a\.jpg/.test(output) && /duplicates/.test(output));
  check('the keep suggestion is rendered', /keep/.test(output), output.slice(0, 120));
  check('junk is detected', /notes\.tmp/.test(output));
  console.log('\n--- captured output (first 12 lines) ---');
  console.log(output.split('\n').slice(0, 12).join('\n'));
  console.log('---------------------------------------\n');
} catch (error) {
  check('GUI responded', false, error.message);
} finally {
  child.kill();
  fs.rmSync(tree, { recursive: true, force: true });
  if (stderr.trim()) console.log(`binary stderr: ${stderr.trim().slice(0, 300)}`);
}

if (failures.length > 0) {
  console.error(`gui verify failed: ${failures.length} problem(s)`);
  process.exit(1);
}
console.log('gui verify passed');
