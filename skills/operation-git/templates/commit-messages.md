# Commit messages — Conventional Commits

```
<type>(<scope>): <subject>

[optional body]

Task: <static-id>
Refs #<slice-#>
```

| Type | Use for | Example |
|------|---------|---------|
| `feat` | New feature | `feat(auth): add OAuth2 login` |
| `fix` | Bug fix | `fix(api): handle null response in user endpoint` |
| `docs` | Documentation | `docs(readme): update installation instructions` |
| `style` | Formatting only | `style: fix indentation in login component` |
| `refactor` | Refactor, no behavior change | `refactor(db): extract connection pool to module` |
| `test` | Tests | `test(auth): add unit tests for token validation` |
| `chore` | Maintenance | `chore(deps): update dependencies` |
| `perf` | Performance | `perf(query): add index to users table` |
| `ci` | CI/CD | `ci: add PostgreSQL service to test workflow` |
| `revert` | Revert a prior commit | `revert: revert "feat(auth): add OAuth2 login"` |
| `build` | Build system / dependencies | `build: add httpx test dep` |

## Trailer rules (workflow-* skills)

There are no per-task issues — task tracking lives in a static-ID checklist in
the slice issue body. So every commit produced inside a slice-phase `workflow-*`
skill carries a `Task:` trailer plus the slice `Refs`:

```
Task: <static-id>
Refs #<slice-#>
```

- `Task: <static-id>` — the slice-checklist task ID this commit advances (e.g.
  `Task: be.1`). This is the commit→task mapping used for crash recovery: a
  re-dispatched agent reads the checklist for ticked boxes and the branch log for
  `Task:` trailers to know what already landed. A commit that advances more than
  one task may carry more than one `Task:` trailer.
- `Refs #<slice-#>` — the slice issue. Same value for every commit on the slice
  branch; lets reviewers scope by slice quickly and lets the reconcile reaper
  find a slice branch's WIP commits.

**fix-pr is the exception.** A fix-PR commit is not advancing a slice task, so it
drops the `Task:` trailer and carries two `Refs`:

```
Refs #<pr-#>
Refs #<slice-#>
```

Never use `Closes #<slice-#>` in commits — closure happens later (PR merge closes
the slice via the PR body's `Closes` line).

**Bad**

```
git commit -m "fixed stuff"
git commit -m "updates"
git commit -m "WIP"
```

**Good**

```
git commit -m "fix(api): retry requests on 503 Service Unavailable

The external API occasionally returns 503 errors during peak hours.
Added exponential backoff retry logic with max 3 attempts.

Task: be.2
Refs #40"
```

## PR titles

Same format as commits: `<type>(<scope>): <description>`.

```
feat(auth): add SSO support for enterprise users
fix(api): resolve race condition in order processing
docs(api): add OpenAPI specification for v2 endpoints
```
