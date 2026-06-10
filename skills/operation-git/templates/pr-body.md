# Draft-PR body skeleton

The `implement-slice` Workflow's terminal PR phase fills this in when opening the slice's draft PR after the gate review passes (and the bounded quality review runs).

```
Closes #<slice-#>

## Summary

<one-paragraph: what the slice ships, framed as user-visible behavior>

## Review verdict

Gate review (acceptance / contract / security) passed on <YYYY-MM-DD>. See the `# Slice Gate Review` comment on #<slice-#> for the gating verdict, and the `# Slice Quality Review` comment for code-quality detail.

## Test plan

- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green
- [ ] Manual smoke: <one-line spot check the reviewer surfaced>
```

## Placeholders

| Placeholder      | Source                                                          |
|------------------|-----------------------------------------------------------------|
| `<slice-#>`      | The slice issue being closed by the PR.                         |

First line MUST be `Closes #<slice-#>` so GitHub auto-closes the slice when the PR merges. (There is no per-task list — tasks live in the slice body's `## Tasks` checklist, which is already on the issue the PR closes.)
