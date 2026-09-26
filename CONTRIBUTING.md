# Contributing to spacehog

Thanks for taking the time to help. This project is deliberately small, so the rules
are short.

## Getting set up

```bash
git clone https://github.com/d20260825613-hub/spacehog.git
cd spacehog
node bin/spacehog.js .   # no install step: there are no dependencies
```

Node 18.17 or newer is required (the test suite uses `node:test`).

## Before you open a pull request

```bash
npm test         # unit + integration tests (node:test)
npm run smoke    # end-to-end checks against the real CLI
npm run check    # syntax check + tests
```

If `npm test` fails with `spawn EPERM` on a locked-down machine, run
`npm run test:files` instead: it executes the same suite without the per-file child
processes that `node --test` needs.

## Ground rules

1. **No runtime dependencies.** `dependencies` stays empty. Dev-only tooling is
   discussed in an issue first.
2. **Report-only.** spacehog must never delete, move or modify a user's files. A PR
   that adds `--delete` will be closed.
3. **Tests come with behaviour.** Every bug fix gets a regression test; every new flag
   gets a test plus a row in the README options table.
4. **Never throw on a per-path error.** Permission problems and racing deletions are
   collected into `report.errors`; a single bad file must not abort a scan.
5. **Cross-platform or explicit.** The CI matrix is Linux, macOS and Windows on Node
   18/20/22/24. Use `node:path` instead of string concatenation, and document any
   platform-specific behaviour (see the limitations list in the README).
6. **Style is enforced by review, not a formatter.** Two-space indent, single quotes,
   semicolons, JSDoc on exported functions, no TypeScript.

## Releasing (maintainers)

The repository lives at https://github.com/d20260825613-hub/spacehog.

Releases go through [`gh`](https://cli.github.com) — there is one script for the
whole flow:

```bash
# 1. bump the version in package.json AND src/util.js, then record it in CHANGELOG.md
# 2. gate on readiness: versions agree, tarball is correct, tree is clean
npm run release:check

# 3. tag, push the tag, and publish the GitHub Release from RELEASE-NOTES.md
node scripts/release.js

# preview every step without changing anything
node scripts/release.js --dry-run
```

`release.js` refuses to run on a dirty tree, on a version that does not match the
CHANGELOG, or when the tag already exists at a different commit.

GitHub Actions runs on pushes to `main` and on pull requests; **tag pushes do not
start a workflow**, so the release is created by the command above, not by CI.

### Publishing without git or gh

`scripts/publish-to-github.js` (removed in favour of git + `gh`) drove the REST API
directly, and remains worth reading if you ever need to bootstrap a repository
from a machine with neither tool. Two GitHub behaviours it had to work around:

- A repository with **no commits** answers every Git Data API call (blobs, trees,
  commits, refs) with `409 Git Repository is empty`. The Contents API is the only
  one that can write the first file.
- The missing-ref status is inconsistent: `409` on a fresh repo, `404` once any
  ref exists. Both mean "bootstrap me".

On such a host, `--use-system-ca` is needed where Node does not trust the local
TLS interception certificate (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

Every maintenance script is described in [`scripts/README.md`](scripts/README.md).

## Project layout

```
bin/spacehog.js               tiny entry point
src/args.js                   argument parser, help text, glob matching
src/walker.js                 recursive directory walker (prunes, error-tolerant)
src/hash.js                   streaming hashing, bounded concurrency, on-disk hash cache
src/detectors.js              duplicates, large files, junk, sparse files, empty dirs
src/audit.js                  orchestrates a full scan into one report object
src/reporter.js               text, Markdown and JSON renderers
src/cli.js                    wires args -> audit -> renderer, owns exit codes
src/index.js                  programmatic API
test/*.test.js                node:test suites
test/fixtures.js              shared deterministic tree
test/helpers/                 temp-dir builders and the CLI runner
scripts/run-tests.js          version-portable `npm test` entry point
scripts/test-files.js         same suite without per-file child processes
scripts/smoke.js              end-to-end checks against the real binary
scripts/release-check.js      pre-tag gate (versions, CHANGELOG, tarball, git)
scripts/release.js            tag + push + `gh release create`
scripts/edge-open.js          start Edge with a debug port (browser fallback)
scripts/edge-cdp.js           minimal DevTools-protocol client
scripts/fill-device-code.js   complete a GitHub device-code page over CDP
```

### Why `npm test` goes through a script

`node --test` changed its file discovery between 20 and 21, and the two obvious
forms are mutually exclusive: Node 18-20 reject the `test/*.test.js` glob
("Could not find ...test\*.test.js") while Node 21+ reject a bare directory
("Cannot find module .../test"). Node 18-20 also walk `test/` recursively and
would execute `test/fixtures.js` and `test/helpers/*.js` as three bogus tests.
`scripts/run-tests.js` therefore always passes the explicit list of top-level
`test/*.test.js` files — the one form that means the same thing on 18, 20, 22
and 24.

## Reporting a bug

Please include:

- the exact command you ran,
- your OS and `node --version`,
- what you expected and what happened,
- the smallest directory tree that reproduces it (a few files with `--json` output is
  usually enough — remember to redact absolute paths if they are sensitive).

## Suggesting a feature

Open an issue describing the question you want spacehog to answer. "Which copy of a
duplicate should I keep?" is a good feature request; "add a delete button" is not,
because spacehog is intentionally read-only.
