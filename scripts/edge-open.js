/**
 * Open a URL in a debug-enabled Edge using an explicit profile directory.
 *
 * The dedicated profile does not inherit the machine's TLS interception trust
 * store, so GitHub can fail to load with chrome-error://chromewebdata/.
 * `--ignore-certificate-errors` is fine for a throwaway automation profile that
 * only ever talks to github.com.
 *
 * Usage: node scripts/edge-open.js <url> [port] [profileDir]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const url = process.argv[2] ?? 'https://github.com/settings/tokens';
const port = Number(process.argv[3] ?? 9333);
const profile = process.argv[4] ?? 'D:\\dsh\\_tools\\edge-profile';

if (!fs.existsSync(EDGE)) {
  console.error(`Edge not found at ${EDGE}`);
  process.exit(1);
}
fs.mkdirSync(profile, { recursive: true });

const args = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  // The machine routes through a local TLS-inspecting proxy; the throwaway
  // automation profile does not trust its CA, so point Edge at the proxy and
  // skip certificate validation for it.
  '--proxy-server=127.0.0.1:7897',
  '--ignore-certificate-errors',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=msEdgeSidebarV2',
  '--new-window',
  url,
];

console.log(`opening ${url}`);
console.log(`  port    ${port}`);
console.log(`  profile ${profile}`);
spawn(EDGE, args, { detached: true, stdio: 'ignore' }).unref();
