# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- Test suite on `node:test` (105 tests, ~430 assertions across 9 files), an
  end-to-end smoke test and a GitHub Actions matrix for Linux, macOS and
  Windows on Node 18/20/22/24.

[Unreleased]: https://github.com/d20260825613-hub/spacehog/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/d20260825613-hub/spacehog/releases/tag/v0.1.0
