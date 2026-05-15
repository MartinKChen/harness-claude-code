# Branch naming

Use a prefix that signals intent, then a short kebab-case description.

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New feature | `feature/payment-integration` |
| `bugfix/` | Non-urgent bug fix | `bugfix/login-error` |
| `hotfix/` | Urgent production fix | `hotfix/memory-leak` |
| `release/` | Release prep | `release/v1.2.0` |
| `docs/` | Documentation | `docs/update-readme` |
| `refactor/` | Code restructuring | `refactor/db-layer` |
| `test/` | Test additions/improvements | `test/api-endpoints` |
| `chore/` | Maintenance | `chore/dependency-bump` |

Branches stay short-lived (days, not weeks). Rebase on `main` frequently.
