# Repository "About" panel — copy and paste

GitHub does not let you set the About box from a file, so here is the exact text.
`scripts/publish-to-github.js` sets all of this automatically when you publish.

## Description (paste into the About box)

```
Zero-dependency CLI that finds what is eating your disk: duplicate files, space hogs, junk, sparse files and empty folder trees. Fast three-pass hashing. Reports only — never deletes.
```

Character count: 187 (GitHub's limit is 350).

Alternatives if you prefer a different tone:

- **Shortest:** `Find what is eating your disk — duplicate files, space hogs and junk. Zero dependencies. Never deletes.`
- **SEO-leaning:** `Disk usage analyzer and duplicate file finder for Windows, macOS and Linux. Zero-dependency Node CLI with text, JSON and Markdown reports.`

## Website

Leave empty, or point it at the README anchor you care about:

```
https://github.com/d20260825613-hub/spacehog#usage
```

## Topics (paste one at a time, or use the script)

```
disk-space
disk-usage
duplicate-files
duplicate-detection
cleanup
cli
command-line-tool
nodejs
javascript
zero-dependencies
cross-platform
storage
```

GitHub allows 20 topics maximum. These 12 cover what people actually search for.

Quick links once the repository exists:

- About box: `https://github.com/d20260825613-hub/spacehog` → ⚙️ next to *About*
- Topics: same panel, the **Topics** field
- Description only: `https://github.com/d20260825613-hub/spacehog/settings`

## First release

Suggested tag `v0.1.0`, target `main`, title `spacehog 0.1.0 — first release`.

Release notes (paste as-is):

```markdown
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

- Zero runtime dependencies. Node 18+ and nothing else.
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

Verify the download with the checksums attached to this release.
