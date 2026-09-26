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

## Publishing (maintainers)

The repository lives at https://github.com/d20260825613-hub/spacehog.

On a machine with `git`, publish normally:

```bash
git init -b main
git add .
git commit -m "feat: spacehog 0.1.0"
git remote add origin https://github.com/d20260825613-hub/spacehog.git
git push -u origin main
```

On a machine **without** `git` or `gh` (but with Node 18+, which has `fetch`),
`scripts/publish-to-github.js` pushes every file through the GitHub REST API. It
uses the Contents API rather than the Git Data API on purpose: a repository with
no commits answers every Git Data call with `409 Git Repository is empty`, and
the Contents API is the only one that can write the first file.

Give it a token through the environment, or save it in the git-ignored
`.github-token` file (keeps it out of shell history):

```bash
# PowerShell
$env:GITHUB_TOKEN = "ghp_..."
node --use-system-ca scripts/publish-and-release.js

# bash
GITHUB_TOKEN=ghp_... node scripts/publish-and-release.js
```

- `scripts/publish-to-github.js` — push files only. Idempotent: files whose
  content already matches upstream are skipped, so re-running is safe.
- `scripts/publish-and-release.js` — push files, then create the `v0.1.0` tag.
- `--dry-run` lists what would be uploaded without contacting GitHub.

A fine-grained token needs **Repository permissions → Contents: Read and write**
to push files, plus **Account permissions → Administration: Read and write** to
create the repository or a tag. Delete the token right after use.

`--use-system-ca` is needed on machines where Node does not trust the local TLS
interception certificate (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).

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
scripts/publish-to-github.js  REST-API publisher (no git required)
scripts/publish-and-release.js publisher + v0.1.0 tag
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
