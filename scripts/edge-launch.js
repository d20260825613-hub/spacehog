/**
 * Launch Edge with a debug port and a dedicated profile, then navigate to a URL.
 *
 * A dedicated user-data-dir is required: Edge refuses `--remote-debugging-port`
 * on the default profile. The trade-off is that this profile starts logged out,
 * so the first run may need a manual sign-in that then persists here.
 *
 * Usage: node scripts/edge-launch.js <url> [port]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = 'D:\\dsh\\_tools\\edge-profile';

const url = process.argv[2] ?? 'https://github.com/settings/tokens';
const port = Number(process.argv[3] ?? 9333);

if (!fs.existsSync(EDGE)) {
  console.error(`Edge not found at ${EDGE}`);
  process.exit(1);
}
fs.mkdirSync(PROFILE, { recursive: true });

const args = [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=msEdgeSidebarV2',
  '--new-window',
  url,
];

console.log(`launching Edge (debug port ${port}, profile ${PROFILE})`);
console.log(`target: ${url}`);

const child = spawn(EDGE, args, { detached: true, stdio: 'ignore' });
child.unref();
console.log(`edge pid ${child.pid}`);
