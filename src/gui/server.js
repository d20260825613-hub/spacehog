/**
 * Minimal GUI host for the Windows build.
 *
 * It serves one local page and exposes three tiny endpoints. The scan itself is
 * run as a child process of *this same program* in CLI mode, which keeps a
 * single copy of the CLI logic and gives the page a real exit code to report.
 * That means `spacehog.exe --cli …` in a packaged build and `node main.js --cli
 * …` under `node src/gui/main.js`; see `resolveSpawnTarget` for the difference.
 *
 * Only 127.0.0.1 is bound, and the child is spawned with an argument vector
 * rather than a shell string, so a folder name with quotes or spaces cannot
 * turn into command injection.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PAGE } from './page.js';
import { VERSION } from '../util.js';

/** Ask Windows for a folder without adding a dependency on a UI toolkit. */
function pickFolderViaPowerShell() {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "Choose a folder to scan"',
      '$d.ShowNewFolderButton = $false',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
    ].join('; ');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    );
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', () => resolve({ error: 'could not open the folder picker' }));
    child.on('close', () => {
      const picked = out.trim();
      resolve(picked ? { path: picked } : { error: 'no folder selected' });
    });
  });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * How to start a second copy of *this* program in CLI mode.
 *
 * Two shapes exist and they need different argument vectors:
 *
 *   - packaged (SEA): the program is its own executable, so `execPath` alone is
 *     enough and the first argument is `--cli`.
 *   - development: `node --cli .` is not a thing — node would treat `--cli` as
 *     one of its own options. The command is node and the first argument is a
 *     script path. That script is `cli-child.js`, not `main.js`: respawning
 *     *whatever started the GUI* would mean respawning a test file when the GUI
 *     is started from a test.
 *
 * `execPath` is the injectable seam; when it is not given the shape is decided
 * by whether this process was started with a script (`process.argv[1]`), which
 * is exactly what a packaged SEA binary does not have.
 */
export function resolveSpawnTarget({ execPath = null, argv = process.argv, execPathFallback = process.execPath } = {}) {
  if (execPath) return { command: execPath, args: (args) => ['--cli', ...args] };

  const script = argv[1] ? fileURLToPath(new URL('./cli-child.js', import.meta.url)) : null;
  if (script) return { command: execPathFallback, args: (args) => [script, ...args] };

  return { command: execPathFallback, args: (args) => ['--cli', ...args] };
}

/** A child that is still running has neither an exit code nor a signal. */
export function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * @param {object} options
 * @param {string} [options.open] injectable "open this URL" for tests
 * @param {string} [options.execPath] force the CLI executable (tests, packaged builds)
 * @returns {Promise<{url: string, server: import('node:http').Server}>}
 */
export async function startGui({ open = null, execPath = null } = {}) {
  const target = resolveSpawnTarget({ execPath });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, PAGE, 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/version') {
      return send(
        res,
        200,
        JSON.stringify({ version: VERSION, exe: path.basename(target.command), cwd: process.cwd() }),
      );
    }

    if (req.method === 'POST' && url.pathname === '/api/browse') {
      if (process.platform !== 'win32') {
        return send(res, 200, JSON.stringify({ error: 'the folder picker is Windows-only; type the path instead' }));
      }
      return pickFolderViaPowerShell().then((result) => send(res, 200, JSON.stringify(result)));
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      req.on('end', () => {
        let args = [];
        try {
          args = JSON.parse(body).args ?? [];
        } catch {
          return send(res, 400, JSON.stringify({ error: 'bad request body' }));
        }
        if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
          return send(res, 400, JSON.stringify({ error: 'args must be an array of strings' }));
        }

        res.writeHead(200, {
          'content-type': 'application/x-ndjson',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
        });

        // This program again, in CLI mode: one copy of the scanning logic, and a
        // real exit code for the page to report.
        const child = spawn(target.command, target.args(args), { windowsHide: true });
        const relay = (chunk) => {
          if (!res.writableEnded) res.write(`${JSON.stringify({ chunk: String(chunk) })}\n`);
        };
        child.stdout.on('data', relay);
        child.stderr.on('data', relay);
        child.on('error', (error) => {
          relay(`could not start the scan: ${error.message}\n`);
        });
        child.on('close', (code) => {
          if (res.writableEnded) return;
          res.write(`${JSON.stringify({ exit: code ?? 1 })}\n`);
          res.end();
        });

        // "The client went away" is a property of the *response*, not the
        // request. `req` emits 'close' as soon as its body has been consumed —
        // which is immediately here, since the body is read above — so listening
        // on `req` killed the scan before it could write its first byte. `res`
        // closes when the socket actually goes away, or after `res.end()`.
        res.on('close', () => {
          if (!res.writableEnded && isRunning(child)) child.kill();
        });
      });
      return undefined;
    }

    return send(res, 404, JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  if (open) await open(url);
  else console.log(`spacehog GUI on ${url}  (close this window to stop)`);
  return { url, server };
}

/** Open a URL with the platform's default handler, without a shell. */
export function openInBrowser(url) {
  return new Promise((resolve) => {
    const command =
      process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { windowsHide: true, detached: false, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(true));
  });
}
