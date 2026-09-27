# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

130 tests across 11 files (up from 122 across 10), green on Node 18.17, 20.11
and 24; `npm run smoke` and `npm run verify:package` pass end to end.

### Added

- **Graphical front end** (`src/gui/`, not yet wired into the npm package): one
  Windows binary that opens a local page on `127.0.0.1` when started with no
  arguments and behaves exactly like the CLI otherwise. The page posts to three
  endpoints — the bundled page, `/api/version` and `/api/run`, which streams the
  scan back as NDJSON and ends with the child's real exit code. The folder picker
  uses PowerShell's `FolderBrowserDialog`, so no UI dependency was added.
- **SEA binaries** (`scripts/build-exe.js`): esbuild bundles the source into one
  CommonJS file and `postject` injects it into a copy of the Node runtime. Windows
  gets a GUI+CLI binary, Linux a CLI-only one. Checksums land next to the
  artifacts. macOS is deliberately not built — an unsigned SEA binary is killed by
  Gatekeeper, which is worse than `npx`.
- **Exit code `3`** for `--fail-on-dupes`: reaching the threshold now has its own
  code (see *Changed* — this is a breaking change for CI scripts).
- `test/gui.test.js`: starts the real server on a loopback port and drives every
  endpoint over HTTP, including a full scan streamed back as NDJSON. The bug below
  is only visible to a test that does that.
- `test/version.test.js` now also checks that `SHA256SUMS.txt` and the per-binary
  `.sha256` files agree with the binaries they describe, whenever those binaries
  are present. The manifest had already drifted once without anyone noticing.
- `src/gui/cli-child.js`: the CLI entry the GUI spawns when running from source.
- `npm run verify:package` (`scripts/verify-package.js`): packs the real tarball,
  installs it into a throwaway prefix and runs the *installed* command —
  `--version`, a real audit, `--json`, `--keep`, `--fail-on-dupes`, `--help` and
  a dynamic import of the library entry. Nothing previously exercised the path a
  user actually takes: `npm test` runs the source tree, and `release-check.js`
  only inspects the file list. Now runs on Linux, macOS and Windows in CI.

### Changed

- **Exit code `2` no longer means "the `--fail-on-dupes` threshold was reached"**;
  that case is `3` now. `2` keeps its other meaning — the command could never have
  run, because the arguments were wrong or a path does not exist. One code for
  both left a CI script unable to tell a typo from a real finding, and unable to
  decide whether retrying could ever help. `speck` reserves `3` the same way, so
  the family stays consistent. `README.md`, `--help` and the smoke test were
  updated with the code.
- Documented exit codes corrected: `README.md` had `1` and `2` swapped, claiming
  code `1` covered invalid arguments. Invalid arguments and missing paths are `2`;
  `1` is a scan that started and then failed.

### Fixed

- **`POST /api/run` returned `200` with a bare `{"exit":1}` and not one line of
  output.** The handler watched `req` for "the client went away", but Node emits
  `'close'` on `req` as soon as the request body has been consumed — which happens
  before the child process writes its first byte — so every scan was killed
  immediately. The listener moved to `res`, which closes when the socket actually
  goes away or after `res.end()`; a relay guard stops output from being written to
  a dead response.
- **The GUI could not run its own scans from source.** It spawned
  `process.execPath` with `['--cli', ...args]`, which under `node src/gui/main.js`
  means `node --cli .` — node itself rejects `--cli`, and the scan died with exit
  code 9. The spawn target is now derived from how the process was started: a
  packaged binary is its own executable, while a source run gets node plus a
  dedicated CLI entry point. A test file is never respawned as a scan.
- `scripts/smoke.js` expected a missing path to exit `1`; that has been `2` since
  the exit codes were split out, so the smoke test could not have passed.
- `tools/sea/` (about 287 MB of blobs, bundles and binaries) is now git-ignored.
  `git check-ignore` said it was not, so `git add -A` would have committed the
  build output. The build *inputs* (`bundle-*.cjs`, `entry-*.mjs`, `sea-*.json`)
  and the checksums stay tracked on purpose.
- `SHA256SUMS.txt` was wrong in two ways: it recorded a hash for `spacehog.exe`
  that matched no build, and it omitted `spacehog-cli` altogether, so two of the
  three artifacts had no entry in the combined manifest. It is regenerated from
  the binaries now, and `scripts/upload-assets.js` compares it with each
  `.sha256` sidecar before uploading. That script also published the superseded
  `spacehog` Linux build instead of the current `spacehog-cli`; the asset list
  names the artifact the build script actually produces.

## [0.2.0] - 2026-09-26

### Added

- `--keep <policy>` (`-k`) and `--keep-prefer <name>`: in every duplicate group,
  spacehog now marks the copy to keep with `← keep`. Policies are `newest`
  (default), `oldest`, `shortest-path` and `first`; `--keep-prefer` gives copies
  inside a folder with that name priority over the policy. The suggestion is
  computed by pure functions in `src/keep.js`, so it is cheap to test and never
  touches the filesystem. spacehog still deletes nothing.
- JSON: `duplicateGroups[].keep` and `.redundant`, plus `options.keepPolicy` and
  `options.keepPrefer`.
- `npm run release:check` (`scripts/release-check.js`): verifies the two version
  strings agree, the CHANGELOG has a section for the version, the tarball npm
  would publish contains the CLI and the licence but not the tests, no runtime
  dependency crept in, and the tree is clean and not behind upstream.
- `scripts/release.js`: one-command release — readiness gate, annotated tag,
  push, then `gh release create` from `RELEASE-NOTES.md`. `npm run release:dry`
  previews every step without changing anything.
- `test/version.test.js`: guards against the version drifting between
  `package.json` and `src/util.js`, and pins the packaging contract (bin entry,
  `files` allow-list, ESM, MIT, zero dependencies).
- Issue forms for bug reports and feature requests, a pull request template,
  `SECURITY.md` with an explicit threat model, a Contributor Covenant code of
  conduct, and a Dependabot config scoped to development dependencies.
- `.gitattributes` forcing LF for all text files, so a Windows checkout cannot
  silently rewrite the tree to CRLF.
- Maintainer tooling under `scripts/`, documented in `scripts/README.md`.
- Test suite grew to 122 tests across 10 files, green on Node 18.17, 20.11 and 24.

### Changed

- Releases now go through `gh`: `scripts/release.js` replaces the hand-rolled
  REST publisher, and `RELEASE-NOTES.md` replaces `REPO-ABOUT.md` as the source
  of the published notes.

### Removed

- `scripts/publish-to-github.js`, `scripts/publish-and-release.js` and
  `scripts/create-release.js`. They existed because the machine that
  bootstrapped this project had neither `git` nor `gh`; both are installed now,
  so they were dead weight. The API quirks they encoded are recorded in
  CONTRIBUTING.md.
- `scripts/edge-launch.js` — superseded by `edge-open.js`, which sets the proxy
  and TLS flags the former lacked.
- `push-fix.ps1`, a one-off bootstrap script that asked for a token on stdin.

### Fixed

- De-flaked the `mapPool` concurrency test. It asserted a peak-concurrency
  number derived from `setTimeout`, which could legitimately be 1 on a loaded
  machine; it now uses an explicit gate and asserts the exact slot count.
- `release-check.js` no longer passes arguments to a shell, which removed a
  Node `DEP0190` warning and the argument-injection surface behind it.

## [0.1.0] - 2025-01-01

### Added

- `spacehog` CLI that audits a directory tree without any external dependencies.
- Duplicate detection in three passes: exact size grouping, 64 KB head hash,
  then full content hash only for groups that still collide.
- Hard-link awareness: several names for one inode are reported as shared
  storage instead of duplicate files.
- Persistent hash cache keyed by path, size and mtime, with an atomic write.
- Sections for largest files, junk files (`.tmp`, `.bak`, `.log`, ...), sparse
  files and empty directory trees.
- `--json` and `--markdown` output modes next to the human-readable report;
  Markdown is shaped for pasting into issues and pull requests.
- `--fail-on-dupes <size>` for CI gates, plus documented exit codes.
- Programmatic API (`audit`, `walk`, `findDuplicates`, renderers) exported from
  `src/index.js`.
- Test suite on `node:test` (98 tests at the time), an end-to-end smoke test and
  a GitHub Actions matrix for Linux, macOS and Windows on Node 18/20/22/24.

[Unreleased]: https://github.com/d20260825613-hub/spacehog/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/d20260825613-hub/spacehog/releases/tag/v0.2.0
[0.1.0]: https://github.com/d20260825613-hub/spacehog/releases/tag/v0.1.0
