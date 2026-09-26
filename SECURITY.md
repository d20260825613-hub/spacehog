# Security Policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/d20260825613-hub/spacehog/security/advisories/new)
rather than in a public issue.

Include what you did, what happened, and what an attacker could achieve. You can
expect an initial response within a week.

## Supported versions

spacehog is pre-1.0. Only the latest release receives fixes; please confirm the
issue against `main` before reporting.

## Threat model — what spacehog does and does not do

spacehog is a **local, read-only** tool. Understanding its design limits is the
honest starting point for judging any finding.

**It does not:**

- open network connections, upload anything, or phone home
- delete, move, rename, or modify any file (there is no `--delete` on purpose)
- follow symlinks by default, and it never writes outside its cache file

**It does:**

- read file contents to compute hashes, and read metadata (`stat`) for sizes
- write one file: the hash cache, at
  `%LOCALAPPDATA%\spacehog\hashes.json` (Windows) or
  `$XDG_CACHE_HOME/spacehog/hashes.json` / `~/.cache/spacehog/hashes.json`
  elsewhere. Disable it with `--no-cache` or relocate it with `--cache <file>`.
- accept arbitrary paths on the command line, by design — the caller already has
  those permissions

### Known, intentional limitations

These are documented behaviour, not vulnerabilities. Reports about them will be
closed with a pointer to this section.

- **`--hash md5` (the default) is not a security primitive.** It is a change
  detector chosen because it is the fastest digest available in every Node build.
  A motivated attacker who can write to your disk could craft two files that
  collide. Use `--hash sha256` if that distinction matters to you.
- **Hashing is not constant-time and reports are not secret.** A report lists
  full file paths and sizes. Do not publish reports from trees whose filenames
  are sensitive without redacting them.
- **The hash cache is a plain JSON file with mode inherited from the OS.** On a
  multi-user machine another local user with read access to your cache directory
  can see the paths and hashes it contains. Use `--no-cache` on shared hosts.
- **`--follow-symlinks` can loop** or traverse outside the tree you named. It is
  off by default for exactly this reason.
- **Resource use is bounded but real.** A scan of a huge tree consumes memory
  proportional to the number of files (a few hundred bytes each) and CPU for
  hashing. `--max-entries` and `--max-size` bound this if you need to.

### Supply chain

The published package has **zero runtime dependencies** — `package.json` has no
`dependencies` key at all, and CI fails if one is added. Everything the CLI uses
comes from the Node standard library.
