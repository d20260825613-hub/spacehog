/**
 * Minimal Chrome DevTools Protocol client (no dependencies).
 *
 * Talks to an Edge/Chrome instance started with `--remote-debugging-port`:
 * lists pages, evaluates JavaScript in them, navigates, and captures
 * screenshots so the state of a page can be inspected.
 *
 * Usage:
 *   node scripts/edge-cdp.js list [port]
 *   node scripts/edge-cdp.js eval   "<expression>" [port]
 *   node scripts/edge-cdp.js eval-file <file.js> [port]   (avoids shell quoting)
 *   node scripts/edge-cdp.js nav    "<url>" [port]
 *   node scripts/edge-cdp.js shot   "<outfile.png>" [port]
 */

import fs from 'node:fs';
import process from 'node:process';

const command = process.argv[2] ?? 'list';

function argAfter(index, fallback) {
  return process.argv[index] ?? fallback;
}

// The port is always the last argument; file/expression arguments sit between.
const port = Number(process.argv[process.argv.length - 1]) || 9333;
const BASE = `http://127.0.0.1:${port}`;

async function listTargets() {
  const response = await fetch(`${BASE}/json/list`);
  if (!response.ok) throw new Error(`devtools http ${response.status}`);
  return response.json();
}

/** Pick the page target that looks most like a real tab. */
function pickPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error('no page target found');
  return pages.find((t) => /^https?:/.test(t.url) && !t.url.startsWith('edge://')) ?? pages[0];
}

/** Tiny CDP session over the built-in WebSocket (Node 22+). */
class Session {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
  }

  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('websocket failed')), { once: true });
    });
    return new Session(ws);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 20000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function withPage(fn) {
  const targets = await listTargets();
  const page = pickPage(targets);
  const session = await Session.open(page.webSocketDebuggerUrl);
  try {
    return await fn(session, page);
  } finally {
    session.close();
  }
}

async function main() {
  if (command === 'list') {
    const targets = await listTargets();
    for (const t of targets) {
      console.log(`${t.type.padEnd(10)} ${t.url.slice(0, 120)}`);
      if (t.type === 'page') console.log(`           ws: ${t.webSocketDebuggerUrl}`);
    }
    return;
  }

  if (command === 'eval' || command === 'eval-file') {
    const expression =
      command === 'eval-file'
        ? fs.readFileSync(argAfter(3, ''), 'utf8')
        : argAfter(3, 'document.title');
    const result = await withPage(async (session) => {
      const outcome = await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (outcome.exceptionDetails) {
        return { error: outcome.exceptionDetails.exception?.description ?? 'evaluation failed' };
      }
      return outcome.result.value;
    });
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'nav') {
    const url = argAfter(3, 'https://github.com');
    await withPage(async (session) => {
      await session.send('Page.enable');
      await session.send('Page.navigate', { url });
      // give the SPA/redirects a moment to settle
      await new Promise((resolve) => setTimeout(resolve, 2500));
    });
    console.log(`navigated to ${url}`);
    return;
  }

  if (command === 'shot') {
    const out = argAfter(3, 'D:\\dsh\\_tools\\page.png');
    const data = await withPage(async (session) => {
      const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return shot.data;
    });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(`screenshot: ${out} (${fs.statSync(out).size} bytes)`);
    return;
  }

  console.error(`unknown command: ${command}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`cdp error: ${error.message}`);
  process.exit(1);
});
