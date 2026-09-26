#!/usr/bin/env node
/**
 * spacehog CLI entry point.
 * Keep this file tiny: all logic lives in src/ so it stays testable.
 */

import { run } from '../src/cli.js';

const exitCode = await run(process.argv.slice(2));
process.exitCode = exitCode;
