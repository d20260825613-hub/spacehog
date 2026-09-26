# spacehog 0.1.0

First public release. spacehog audits a directory tree and answers three questions
in one pass, in well under a second on a normal home directory.

## What it finds

- **Duplicates** — byte-identical files, grouped, with the exact bytes you get back
  from deleting all but one copy of each group.
- **Space hogs** — the biggest files in the tree, with ages.
- **Junk** — regenerable leftovers (`.tmp`, `.bak`, `.log`, `.pyc`, `Thumbs.db`, …).
- **Sparse files** — logical size far above real disk usage (thin provisioning,
  placeholders, preallocated VM images).
- **Empty directories** — whole empty folder trees, deepest first.

## Highlights

- Zero runtime dependencies. Node 18.17+ and nothing else.
- Three-pass duplicate detection (size → 64 KB head hash → full hash) so it reads a
  few percent of the bytes instead of all of them.
- Hard links are reported as shared storage, not as duplicates.
- Persistent hash cache keyed by path, size and mtime: a second scan does almost no I/O.
- `--json` and `--markdown` output; `--fail-on-dupes <size>` for CI gates.
- Report-only by design: there is no `--delete`.

## Install

```bash
npx spacehog .
```

## Links

- Documentation: https://github.com/d20260825613-hub/spacehog#readme
- Changelog: https://github.com/d20260825613-hub/spacehog/blob/main/CHANGELOG.md
- Issues: https://github.com/d20260825613-hub/spacehog/issues
