/**
 * Entry point for the GUI build.
 *
 * One binary, two modes:
 *   spacehog-gui.exe                 -> opens the graphical front end
 *   spacehog-gui.exe --cli . --json  -> behaves exactly like the command line
 *   spacehog-gui.exe . --json        -> also the command line, for convenience
 *
 * The child process the GUI spawns uses `--cli`, so the two modes never fight
 * over argv.
 */

import process from 'node:process';

import { run } from '../cli.js';
import { openInBrowser, startGui } from './server.js';

const argv = process.argv.slice(2);
const isCli = argv[0] === '--cli' || flagRequestsConsole(argv);

/** `--help`, `--version` or any positional path means the user wants the CLI. */
function flagRequestsConsole(args) {
  if (args.includes('--help') || args.includes('-h') || args.includes('--version') || args.includes('-v')) return true;
  return args.some((a) => !a.startsWith('-'));
}

async function main() {
  if (isCli) {
    const args = argv[0] === '--cli' ? argv.slice(1) : argv;
    return run(args);
  }

  try {
    await startGui({ open: openInBrowser });
    // Keep the process alive as long as the page can reach it. The window is
    // the browser; this process just serves it.
    return new Promise(() => {});
  } catch (error) {
    console.error(`spacehog GUI could not start: ${error.message}`);
    console.error('Run it with arguments instead, for example: spacehog-gui.exe . --json');
    return 1;
  }
}

main().then(
  (code) => {
    if (typeof code === 'number') process.exitCode = code;
  },
  (error) => {
    console.error(`spacehog: ${error?.stack ?? error}`);
    process.exitCode = 1;
  },
);

// Keep the process alive while the page is open. `main()` resolves as soon as
// the server is listening for the GUI case, and nothing else holds the loop.
if (!isCli) {
  setInterval(() => {}, 1 << 30);
}
