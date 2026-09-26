/**
 * Fill GitHub's device-activation code boxes and submit, using real input
 * events over CDP (setting .value directly is ignored by the page's JS).
 *
 * Usage: node --use-system-ca fill-device-code.js <8-char-code> [port]
 */

import process from 'node:process';

const code = (process.argv[2] ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const port = Number(process.argv[3] ?? 9444);
const BASE = `http://127.0.0.1:${port}`;

if (code.length !== 8) {
  console.error(`expected an 8-character code, got "${code}"`);
  process.exit(1);
}

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

  static async open(url) {
    const ws = new WebSocket(url);
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
      }, 15000);
    });
  }

  close() {
    this.ws.close();
  }
}

/** Index in the code for each visible box id, skipping the hidden hyphen box. */
const BOXES = ['0', '1', '2', '3', '5', '6', '7', '8'];

async function main() {
  const targets = await (await fetch(`${BASE}/json/list`)).json();
  const pages = targets.filter((t) => t.type === 'page' && t.url.includes('/login/device'));
  if (pages.length === 0) throw new Error('no device activation page found');
  const session = await Session.open(pages[0].webSocketDebuggerUrl);

  try {
    await session.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });

    for (let i = 0; i < BOXES.length; i += 1) {
      const selector = `#user-code-${BOXES[i]}`;
      await session.send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector('${selector}'); if (!el) return 'missing'; el.focus(); return 'ok'; })()`,
        returnByValue: true,
      });
      await session.send('Input.insertText', { text: code[i] });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    const readBack = await session.send('Runtime.evaluate', {
      expression: `JSON.stringify(${JSON.stringify(BOXES)}.map((n) => document.querySelector('#user-code-' + n)?.value ?? null))`,
      returnByValue: true,
    });
    console.log(`boxes now hold: ${readBack.result.value}`);

    const submit = await session.send('Runtime.evaluate', {
      expression: `(() => { const b = document.querySelector('#commit') || document.querySelector('button[type=submit]'); if (!b) return 'no-submit'; b.click(); return (b.textContent || b.value || '').trim(); })()`,
      returnByValue: true,
    });
    console.log(`submitted via: ${submit.result.value}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const after = await session.send('Runtime.evaluate', {
      expression: `JSON.stringify({ url: location.href, title: document.title, body: document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 220) : null })`,
      returnByValue: true,
    });
    console.log(`after: ${after.result.value}`);
  } finally {
    session.close();
  }
}

await main();
