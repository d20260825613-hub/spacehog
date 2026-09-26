# Maintenance scripts

These are the tools used to develop, test and publish spacehog. None of them are
part of the CLI itself — `bin/spacehog.js` and `src/` are the shipped product.

## Testing

| Script | What it does |
| --- | --- |
| `run-tests.js` | The `npm test` entry point. `node --test` discovers files differently on Node 18-20 than on 21+, and the two obvious forms are mutually exclusive, so this passes the explicit list of top-level `test/*.test.js` files — the only form that means the same thing on 18, 20, 22 and 24. |
| `test-files.js` | Runs each test file in its own plain node process. Use it when `node --test` is blocked by a sandbox that denies child-process pipes (`spawn EPERM`). |
| `smoke.js` | End-to-end checks against the real CLI: text/JSON/Markdown modes and exit codes 0/1/2. |

## Publishing

Both publishers use the GitHub REST API, so they work on a machine with no `git`
and no `gh`. A token is read from `GITHUB_TOKEN`/`GH_TOKEN` or from the
git-ignored `.github-token` file, and is never written to a command line.

| Script | What it does |
| --- | --- |
| `release-check.js` | `npm run release:check`. Verifies the two version strings agree, the CHANGELOG has a real section for the version, the tarball npm would publish contains the CLI and the licence (and not the tests), no runtime dependency crept in, and the tree is clean and not behind upstream. Run it before tagging. Exit code 1 on any problem. |
| `publish-to-github.js` | Creates the repository if needed, sets the About description and topics, then pushes every file. Idempotent: files whose content already matches upstream (by git blob sha) are skipped, so re-running is cheap and safe. |
| `publish-and-release.js` | Runs the publisher, then creates the `v0.1.0` annotated tag. |
| `create-release.js` | Creates the GitHub Release for the tag, using the notes fenced in `REPO-ABOUT.md`. |

The version string is duplicated on purpose: `package.json` is what npm and
GitHub read, and `src/util.js` is what the CLI prints without touching the
filesystem (Node 18 cannot import JSON). `test/version.test.js` and
`release-check.js` are the guards that stop the two from drifting apart.

Two GitHub behaviours are worth knowing before editing these:

- A repository with **no commits** answers every Git Data API call (blobs, trees,
  commits, refs) with `409 Git Repository is empty`. The Contents API is the only
  one that can write the first file, which is why the publisher uses it.
- The missing-ref status is inconsistent: `409` on a fresh repo, `404` once any
  ref exists. Both mean "bootstrap me".

## Browser automation (maintainer-only)

Some GitHub actions can only be done in a signed-in browser. These attach to a
locally started Edge over the Chrome DevTools Protocol so those pages can be
driven programmatically. They need Node 22+ for the built-in `WebSocket`.

| Script | What it does |
| --- | --- |
| `edge-open.js` | Starts Edge with `--remote-debugging-port` and a dedicated profile. A dedicated `--user-data-dir` is required — Edge ignores the debug port on the default profile. Use this instead of `edge-launch.js`, which omits proxy/TLS handling. |
| `edge-cdp.js` | Minimal CDP client: `list`, `eval`, `eval-file`, `nav`, `shot` (screenshot). `--target=<substring>` selects one tab out of several, which matters because a crashed renderer keeps its target URL. |

**`edge-launch.js` is superseded and kept only for older notes.** It takes no
proxy or TLS flags, so on a machine with an intercepting proxy the browser it
starts cannot reach github.com (`ERR_CONNECTION_CLOSED`). Use `edge-open.js`.

Example — screenshot a page you need to inspect:

```bash
node scripts/edge-open.js "https://github.com/settings/tokens" 9333
node scripts/edge-cdp.js shot D:\tmp\tokens.png 9333
```

Machines that route through a TLS-inspecting proxy need `--use-system-ca` for the
API scripts, and the browser profile needs `--proxy-server` plus
`--ignore-certificate-errors` (both already set in `edge-open.js`). A proxy that
allows Node but rejects the browser is common; when that happens, drive the API
from Node instead of the browser.
