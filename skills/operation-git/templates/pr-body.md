# Draft-PR body skeleton

Reviewer-review-slice fills this in when opening the slice's draft PR after a passing slice review.

```
Closes #<slice-#>

## Summary

<one-paragraph: what the slice ships, framed as user-visible behavior>

## Tasks closed by this slice

- <task-1-title> (#<task-1-#>)
- <task-2-title> (#<task-2-#>)
- ...

## Review verdict

Slice review passed on <YYYY-MM-DD>. See review comment on #<slice-#> for finding-level detail.

## Test plan

- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green
- [ ] Manual smoke: <one-line spot check the reviewer surfaced>
```

## Placeholders

| Placeholder      | Source                                                          |
|------------------|-----------------------------------------------------------------|
| `<slice-#>`      | The slice issue being closed by the PR.                         |
| `<task-N-#>`     | Each closed task sub-issue under the slice. Listed for visibility — closure of the slice automatically rolls these up when the PR merges. |

First line MUST be `Closes #<slice-#>` so GitHub auto-closes the slice when the PR merges.
