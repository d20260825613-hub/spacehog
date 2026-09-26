<div align="center">

# spacehog

**Find out what is eating your disk — duplicates, space hogs, junk, and empty folder trees.**

Zero dependencies · Node 18+ · Windows, macOS and Linux · Report-only, never deletes anything

[![CI](https://github.com/d20260825613-hub/spacehog/actions/workflows/ci.yml/badge.svg)](https://github.com/d20260825613-hub/spacehog/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D18.17-3c873a)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)

</div>

---

## Contents

- [See it in action](#see-it-in-action)
- [Why another disk tool](#why-another-disk-tool)
- [Install](#install)
- [Usage](#usage)
  - [Options](#options)
  - [Recipes](#recipes)
  - [Exit codes](#exit-codes)
- [What the report tells you](#what-the-report-tells-you)
- [Use it as a library](#use-it-as-a-library)
- [Project layout](#project-layout)
- [Performance notes](#performance-notes)
- [Limitations (honest list)](#limitations-honest-list)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## See it in action

```console
$ spacehog ~/Pictures

spacehog v0.1.0 · /home/you/Pictures
────────────────────────────────────────────────────────────────────────
22.7 MB scanned · 8 files · 11 dirs · 28ms
HIGH  About 5.7 MB looks reclaimable (25% of the tree).

▌ duplicates · 2 group(s) · 4 file(s)
  duplicates · 5.2 MB reclaimable
  paths below are relative to /home/you/Pictures
  ● 3.2 MB × 2 → save 3.2 MB
     md5:db425e34512e
     · photos/IMG_2041.jpg (2d ago)
     · photos/backup/IMG_2041.jpg (3mo ago)
  ○ 2 MB × 2 → save 2 MB
     md5:688e0ce070ed
     · photos/IMG_2042.jpg (just now)
     · photos/raw/copy_of_IMG_2042.jpg (just now)

▌ largest files · top 8
   1   11.8 MB  projects/old/backup.zip         just now
   2    3.2 MB  photos/IMG_2041.jpg             just now
   3    3.2 MB  photos/backup/IMG_2041.jpg      just now
   4      2 MB  photos/IMG_2042.jpg             just now
   5      2 MB  photos/raw/copy_of_IMG_2042.jpg just now
   6    410 KB  projects/old/debug.log          just now
   7      6 KB  scratch/.DS_Store               just now
   8       7 B  projects/notes.md               just now

▌ junk · 2 file(s) · 416 KB
  ·    410 KB  projects/old/debug.log
  ·      6 KB  scratch/.DS_Store
  Junk is regenerable by definition, but check the list: .log and .bak can matter.

▌ empty directories · 4
  · downloads/partial
  · empty-folder/nested
  · downloads
  · empty-folder

────────────────────────────── next steps ──────────────────────────────
  Review before deleting: spacehog only reports, it never removes files.
  Machine-readable copies: spacehog . --json → duplicateGroups[].files[]
```

## Why another disk tool

`du` tells you which folder is big. Dedicated duplicate finders hash everything and
can take minutes. `spacehog` answers the three questions people actually ask, in one
pass, in under a second on a normal home directory:

1. **What is duplicated?** Byte-identical files, grouped, with the exact bytes you
   would get back.
2. **What is big?** The biggest files in the tree, with ages.
3. **What is leftover?** Regenerable junk, sparse files, and empty folder trees.

Design choices that keep it fast and safe:

- **Three-pass duplicate detection.** Files are grouped by exact size first (files of
  different sizes can never be duplicates), then only the first 64 KB is hashed, and
  the full content hash runs only for groups that still collide. Hashing the same
  bytes twice is avoided, and a warm cache skips unchanged files entirely.
- **Hard links are not duplicates.** Several names for one inode store bytes once, so
  they are reported separately instead of pretending deleting them frees space.
- **It never deletes, moves or modifies anything.** There is no `--delete`, on
  purpose. Deleting is your call, with the report in front of you.
- **Zero runtime dependencies**, about 1.9 k lines of plain ESM across `src/`. No
  lockfile to audit.
- **Symlinks are skipped by default** (no cycles, no double counting) and every
  unreadable path is reported instead of crashing the scan.

## Install

```bash
# run without installing
npx spacehog .

# or install globally
npm install -g spacehog
spacehog ~/Downloads
```

From source:

```bash
git clone https://github.com/d20260825613-hub/spacehog.git
cd spacehog
node bin/spacehog.js .        # no install step, no dependencies
npm test                      # 98 tests across 8 files
npm run smoke                 # end-to-end CLI check
```

## Usage

```console
spacehog [path] [options]
```

Pass several paths to get one report per path. With no path, the current directory
is scanned.

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `-n, --top <n>` | `15` | Entries listed per section |
| `-s, --min-size <size>` | `0` | Ignore files smaller than `<size>` (`10mb`, `1.5gb`, bare bytes) |
| `-m, --max-size <size>` | all | Never fully hash files bigger than `<size>` |
| `-a, --hash <algo>` | `md5` | `md5`, `sha1` or `sha256` |
| `-c, --concurrency <n>` | `8` | Parallel file reads while hashing |
| `--max-depth <n>` | unlimited | Limit recursion depth |
| `--max-entries <n>` | unlimited | Stop collecting after n files (partial report is flagged) |
| `--exclude <glob>` | – | Skip matching paths; repeatable, supports `*`, `**`, `?`, `{a,b}` |
| `--no-duplicates` | duplicates on | Skip duplicate detection entirely |
| `--no-ignore-dirs` | `node_modules`, `.git`, `dist`, … skipped | Also scan those folders |
| `--no-hidden` | dotfiles included | Ignore dotfiles and dot-directories |
| `--follow-symlinks` | off | Follow symlinked directories (can loop) |
| `--no-cache` / `--cache <file>` | per-user cache dir | Disable or relocate the hash cache |
| `--json` / `--markdown` | text | Machine-readable or Markdown report |
| `--pretty` | off | Indent the JSON |
| `--progress` / `--no-progress` | auto | Force or silence the progress line |
| `--color` / `--no-color` | auto | Force or disable ANSI colors |
| `--fail-on-dupes <size>` | – | Exit `2` when duplicate waste reaches `<size>` |
| `-h, --help` / `-v, --version` | – | Help / version |

`NO_COLOR` and `FORCE_COLOR` are honoured, as is `TERM=dumb`.

### Recipes

```bash
spacehog                                  # audit the current directory
spacehog ~/Downloads -n 25                # top 25 in Downloads
spacehog /data --min-size 100mb           # only look at large files
spacehog . --exclude '**/node_modules/**' --exclude '*.iso'
spacehog . --json --pretty > report.json  # feed a dashboard
spacehog . --markdown > report.md         # paste into an issue or PR
spacehog . --fail-on-dupes 500mb          # CI gate: fail when 500 MB is duplicated
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Report produced (even when duplicates were found) |
| `1` | Invalid arguments, or a path could not be scanned at all |
| `2` | `--fail-on-dupes` threshold reached |

## What the report tells you

| Section | Meaning |
| --- | --- |
| `duplicates` | Groups of byte-identical files. `wastedBytes` is what deleting all but one copy of each group would free. |
| `hardlinkGroups` | Files sharing one inode. Listed separately: the bytes are stored once, so nothing is reclaimable. |
| `largeFiles` | Biggest files, largest first. `sparse: true` flags thin-provisioned or placeholder files. |
| `junk` | Files whose extension is regenerable by definition (`.tmp`, `.bak`, `.log`, `.pyc`, …). Review the list; `.log` and `.bak` sometimes matter. |
| `sparse` | Files whose real disk usage is far below their logical size. Not reclaimable, just context. |
| `emptyDirs` | Folders with no files anywhere inside them. A whole empty tree is listed, deepest first. |
| `errors` | Paths that could not be read, with `code` and `message`. A scan continues past them. |

The JSON report is a single stable object; `duplicateGroups[].files[].path` holds
absolute paths, while `display` holds the path relative to the scanned root.

## Use it as a library

```js
import { audit, renderMarkdown, findDuplicates, walk } from 'spacehog';

const report = await audit({ root: '/data', minSize: 10 * 1024 * 1024, cachePath: null });

console.log(report.summary.totalBytes, report.duplicates.wastedBytes);
console.log(renderMarkdown(report));

// or drive the pieces yourself
const { files } = await walk('/data', { ignoreDirs: ['node_modules'] });
const duplicates = await findDuplicates(files, { algorithm: 'sha256', concurrency: 4 });
```

Every exported helper is documented with JSDoc in `src/`.

## Project layout

```
spacehog/
├── bin/
│   └── spacehog.js          # CLI entry point (10 lines: parse argv, call run())
├── src/
│   ├── index.js             # public API surface — import from here, not from internals
│   ├── cli.js               # wires args -> audit -> renderer; owns exit codes 0/1/2,
│   │                        #   progress line, SIGINT handling, --exclude post-filter
│   ├── args.js              # zero-dep argument parser, help text, glob -> RegExp
│   ├── audit.js             # one full scan -> one report object (the orchestrator)
│   ├── walker.js            # iterative, error-tolerant directory walk; prunes and limits
│   ├── hash.js              # streaming hashes, bounded concurrency pool, on-disk cache
│   ├── detectors.js         # duplicates, large files, junk, sparse files, empty dirs
│   ├── reporter.js          # text / Markdown / JSON renderers + the severity verdict
│   └── util.js              # byte formatting, size parsing, path and time helpers
├── test/
│   ├── *.test.js            # 8 suites, 98 tests (node:test, no test framework)
│   ├── fixtures.js          # one deterministic tree reused by several suites
│   └── helpers/
│       ├── tmp.js           # temp-dir and tree builders, auto-cleanup
│       └── cli.js           # run the real CLI, with a fallback for locked-down hosts
├── scripts/
│   ├── test-files.js        # runs the suite without per-file child processes
│   ├── smoke.js             # end-to-end checks against the real binary
│   └── publish-to-github.js # create the repo + upload via the REST API (no git needed)
├── .github/workflows/ci.yml # 3 OSes x Node 18/20/22/24, plus a self-audit job
├── package.json             # no `dependencies` key at all — that is the point
├── README.md                # this file
├── CONTRIBUTING.md          # ground rules: no deps, report-only, tests with behaviour
├── CHANGELOG.md             # Keep a Changelog
└── LICENSE                  # MIT
```

**Data flow:** `bin` → `cli.js` (args) → `audit.js` → `walker.js` collects files and
directories → `detectors.js` analyses them (using `hash.js` for content identity) →
`audit.js` assembles the report → `reporter.js` renders text, Markdown or JSON.

**Where to change what:**

| You want to… | Edit |
| --- | --- |
| Add a CLI flag | `src/args.js` (`SPEC`, `USAGE`) and pass it through in `src/cli.js` |
| Change what counts as junk | `src/detectors.js` (`DEFAULT_JUNK_EXTENSIONS`, `DEFAULT_JUNK_NAMES`) |
| Skip different folders by default | `src/walker.js` (`DEFAULT_IGNORED_DIRS`) |
| Add a report section | `src/detectors.js` + `src/audit.js` + `src/reporter.js` |
| Change the report look | `src/reporter.js` only — it never touches the filesystem |

## Performance notes

- Duplicate detection reads each candidate's first 64 KB, then only reads a full file
  when a head hash collides. On typical trees that means a few percent of the bytes.
- Hashing is bounded by `--concurrency` (default 8) and streamed, so memory stays flat
  for multi-gigabyte files.
- The hash cache lives in `%LOCALAPPDATA%\spacehog\hashes.json` on Windows and
  `$XDG_CACHE_HOME/spacehog/hashes.json` (or `~/.cache/spacehog/hashes.json`) elsewhere,
  keyed by path, size and mtime, capped at 200 000 entries and written atomically.
  A second run over an unchanged tree does almost no I/O.

## Limitations (honest list)

- `md5` is used by default because it is the fastest digest available in every Node
  build. It is a change detector here, **not** a security primitive; use `--sha256` if
  you care about that distinction.
- Sparse-file detection needs `stat.blocks`, which Windows does not report, so the
  `sparse` section stays empty there.
- Hard-link detection needs a usable inode number; Windows reports `ino === 0`, so
  hard links are simply treated as separate files there.
- Scanning is single-threaded I/O with async reads; there is no worker-thread hashing
  yet (see the roadmap).
- `--exclude` filters report entries after the walk, so `summary.files` still counts
  everything that was scanned. The excluded entries are removed from every section.

## Roadmap

- [ ] Worker-thread hashing for trees with millions of files
- [ ] `--keep <policy>` to suggest which copy of a duplicate to keep
- [ ] Optional CSV export for spreadsheets
- [ ] Machine-readable progress events (`--progress=json`) for editors

## Contributing

Issues and pull requests are welcome. Before opening a PR:

```bash
npm test          # unit + integration tests
npm run smoke     # end-to-end CLI checks
npm run check     # syntax check + tests
```

Guidelines: no runtime dependencies, keep the CLI report-only, and add a test for
every behaviour change. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
