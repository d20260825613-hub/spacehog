#!/usr/bin/env node
/**
 * spacehog CLI entry point.
 *
 * All the logic lives in src/ so it stays testable; this file exists to install
 * the behaviour every command line tool needs and then hand over to `run`.
 *
 * `installCliHandlers` covers the three cases that are easy to forget and
 * obvious to a user the moment they are missing:
 *   - `spacehog . | head` exits quietly instead of printing a node EPIPE trace
 *   - Ctrl-C during a long scan stops the process instead of raising
 *   - an unexpected bug prints one readable line, not twenty stack frames
 */

import process from 'node:process';

import { USAGE } from '../src/args.js';
import { run } from '../src/cli.js';
import { installCliHandlers } from '../src/cli-kit.js';

const debug = () => process.argv.includes('--debug') || process.env.SPACEHOG_DEBUG === '1';

installCliHandlers({
  tool: 'spacehog',
  usage: () => USAGE,
  debug,
  onInterrupt: (signal) => {
    if (signal === 'SIGINT') process.stderr.write('\nspacehog: stopped.\n');
  },
});

process.exitCode = await run(process.argv.slice(2));
