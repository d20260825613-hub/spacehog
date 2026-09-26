# Maintenance scripts

These are the tools used to develop, test and publish spacehog. None of them are
part of the CLI itself — `bin/spacehog.js` and `src/` are the shipped product.

## Testing

| Script | What it does |
| --- | --- |
| `run-tests.js` | The `npm test` entry point. `node --test` discovers files differently on Node 18-20 than on 21+, and the two obvious forms are mutually exclusive, so this passes the explicit list of top-level `test/*.test.js` files — the only form that means the same thing on 18, 20, 22 and 24. |
| `test-files.js` | Runs each test file in its own plain node process. Use it when `node --test` is blocked by a sandbox that denies child-process pipes (`spawn EPERM`). |
| `smoke.js` | End-to-end checks against the real CLI: text/JSON/Markdown modes and exit codes 0/1/2. |
| `verify-package.js` | `npm run verify:package`. Packs the real tarball, installs it into a throwaway `--prefix`, and runs the *installed* binary: `--version`, a real audit, `--json`, `--keep`, `--fail-on-dupes`, `--help`, and a dynamic import of the library entry. The only check that covers the path a user actually takes. Runs on all three OSes in CI, because bin resolution and executable bits are platform-specific. |

## Releasing

| Script | What it does |
| --- | --- |
| `release-check.js` | `npm run release:check`. Verifies the two version strings agree, the CHANGELOG has a real section for the version, the tarball npm would publish contains the CLI and the licence (and not the tests), no runtime dependency crept in, and the tree is clean and not behind upstream. Run it before tagging. Exit code 1 on any problem. |
| `release.js` | The single release entry point: readiness gate → tag handling → annotated tag + push → `gh release create` from `RELEASE-NOTES.md`. `--dry-run` prints every step and changes nothing. |

Tag handling is deliberately split by intent: a tag whose GitHub Release already
exists is **frozen** (moving it would silently change what users downloaded, so
the release aborts and asks for a version bump), while a tag that was never
published may follow HEAD. Without that second case, fixing a bug found between
tagging and publishing would deadlock the release permanently.

The version string is duplicated on purpose: `package.json` is what npm and
GitHub read, and `src/util.js` is what the CLI prints without touching the
filesystem (Node 18 cannot import JSON). `test/version.test.js` and
`release-check.js` are the guards that stop the two from drifting apart.

### Why there is only one publisher now

Three scripts used to live here — `publish-to-github.js`,
`publish-and-release.js` and `create-release.js` — driving the GitHub REST API by
hand, because the machine that bootstrapped this project had neither `git` nor
`gh`. Both are installed now, so they were deleted rather than kept as dead
weight. The knowledge they encoded is recorded in
[CONTRIBUTING.md](../CONTRIBUTING.md#publishing-without-git-or-gh): a repository
with **no commits** answers every Git Data API call with `409 Git Repository is
empty`, and the missing-ref status is `409` on a fresh repo but `404` once any
ref exists.

## Browser automation (maintainer-only)

Some GitHub actions can only be done in a signed-in browser — device-code
authorisation and deleting a personal access token, for instance, have no usable
API. These attach to a locally started Edge over the Chrome DevTools Protocol.
They need Node 22+ for the built-in `WebSocket`.

| Script | What it does |
| --- | --- |
| `edge-open.js` | Starts Edge with `--remote-debugging-port`, a dedicated profile, `--proxy-server` and `--ignore-certificate-errors`. The dedicated `--user-data-dir` is mandatory: Edge ignores the debug port on the default profile. |
| `edge-cdp.js` | Minimal CDP client: `list`, `eval`, `eval-file`, `nav`, `shot` (screenshot). `--target=<substring>` addresses one tab out of several, which matters because a crashed renderer keeps its target URL. |
| `fill-device-code.js` | Types an 8-character device code into `github.com/login/device` and submits it. Setting `input.value` does not work on that page; this uses real CDP input events. |

Example — screenshot a page you need to inspect:

```bash
node scripts/edge-open.js "https://github.com/settings/tokens" 9333
node scripts/edge-cdp.js shot D:\tmp\tokens.png 9333
```

A proxy that allows Node but rejects the browser is common; when that happens,
drive the API from Node instead of the browser, or start Edge with
`--no-proxy-server` if the intercepting proxy cannot be trusted for TLS.

