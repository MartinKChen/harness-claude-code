# Commit messages — Conventional Commits

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
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

Closes #123"
```

## PR titles

Same format as commits: `<type>(<scope>): <description>`.

```
feat(auth): add SSO support for enterprise users
fix(api): resolve race condition in order processing
docs(api): add OpenAPI specification for v2 endpoints
```
