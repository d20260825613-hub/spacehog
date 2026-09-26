<!--
Thanks for contributing. Please keep the checklist honest — unticked boxes are
fine, they just tell the reviewer what is left.
-->

## What this changes

<!-- One or two sentences. Link the issue it closes, e.g. "Closes #12". -->

## Type

- [ ] Bug fix (with a regression test)
- [ ] New flag or report section
- [ ] Documentation only
- [ ] Refactor with no behaviour change
- [ ] Maintainer tooling under `scripts/`

## Checklist

- [ ] `npm test` passes locally
- [ ] `npm run smoke` passes locally
- [ ] A test covers the new behaviour (or: no behaviour changed)
- [ ] The README options table is updated (if a flag was added or changed)
- [ ] No runtime dependency was added
- [ ] spacehog is still report-only: it never deletes, moves or modifies files
- [ ] I verified this on the OS I actually use (state which below)

## Verification

<!--
Paste the command you ran and the relevant output. For report changes, a short
before/after of the text report is the most useful thing you can include.
-->

```console
$ spacehog . --no-cache
```

## Platform

- OS:
- Node:
