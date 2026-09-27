#!/usr/bin/env node
/**
 * CLI-only entry point, used by the GUI in development mode.
 *
 * The packaged binary is a single file that switches on `--cli`. In
 * development there is no single file: the GUI has to spawn node, and node
 * needs a script. Reusing `src/gui/main.js` for that looks tempting but is
 * wrong — it would respawn *whatever script was originally run*, which under
 * `node --test test/gui.test.js` is the test file. This file is the stable
 * answer: it always means "a scan", never "a GUI" and never "a test run".
 *
 * Installed users get this path for free: `bin` and `src` are both in the
 * package's `files` allow-list.
 */

import process from 'node:process';

import { run } from '../cli.js';

process.exitCode = await run(process.argv.slice(2));
