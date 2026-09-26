import path from 'node:path';

import { filler, makeTree } from './helpers/tmp.js';

/**
 * A small, fully deterministic tree used by the audit/CLI/reporter tests.
 *
 *   twin-a.bin / twin-b.bin / nested/twin-c.bin   3 copies of 4 KB of 0x11
 *   solo.bin / same-size.bin                      4 KB each, different bytes
 *   scripts/build.tmp, logs/app.log                junk (50 B + 120 B)
 *   empty/ , tree/leaf/, tree/leaf/deeper/         empty directories
 *   node_modules/pkg/index.js                      pruned by default
 */
export const FIXTURE = {
  'twin-a.bin': filler(0x11, 4096),
  'twin-b.bin': filler(0x11, 4096),
  'nested/twin-c.bin': filler(0x11, 4096),
  'solo.bin': filler(0x22, 4096),
  'same-size.bin': filler(0x33, 4096),
  'scripts/build.tmp': filler(0x44, 50),
  'logs/app.log': filler(0x45, 120),
  'empty': null,
  'tree/leaf': null,
  'tree/leaf/deeper': null,
  'node_modules/pkg/index.js': filler(0x55, 900),
};

export const FIXTURE_TOTAL_BYTES = 4096 * 5 + 50 + 120;

/** Build the fixture tree; returns its root. */
export function makeFixture(prefix = 'spacehog-fixture-') {
  return makeTree(FIXTURE, prefix);
}

/** Absolute path of a fixture entry. */
export function fixturePath(root, relative) {
  return path.join(root, ...relative.split('/'));
}

export { filler };
