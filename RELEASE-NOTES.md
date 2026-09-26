# spacehog 0.2.0

Duplicate groups are now actionable: spacehog tells you which copy to keep.

## Added

- **`--keep <policy>`** (`-k`) suggests which copy of a duplicate group to keep,
  and marks it in the report with `← keep`:

  | Policy | Picks |
  | --- | --- |
  | `newest` (default) | The most recently modified copy |
  | `oldest` | The least recently modified copy — treat it as the original |
  | `shortest-path` | The copy closest to the scan root |
  | `first` | The first copy in path order |

- **`--keep-prefer <name>`** gives copies inside a folder with that name priority
  over the policy, so `originals/` beats `exports/`. It matches the file's
  immediate parent folder.

- The JSON report grew `duplicateGroups[].keep` and `.redundant`, plus
  `keepPolicy` and `keepPrefer` in `options` — so a script can act on the
  suggestion without re-deriving it.

spacehog still deletes nothing. The suggestion is advice, not an action.

## Install

```bash
npx spacehog . --keep oldest
```

## Links

- Documentation: https://github.com/d20260825613-hub/spacehog#which-copy-to-keep
- Changelog: https://github.com/d20260825613-hub/spacehog/blob/main/CHANGELOG.md
- Issues: https://github.com/d20260825613-hub/spacehog/issues
