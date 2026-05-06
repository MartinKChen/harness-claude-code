# `gh` reference

| Command | What it does | Common flags / notes |
|---------|--------------|----------------------|
| `gh auth status` | Verify you're authenticated and on the right account. | Run once per session in unfamiliar environments. |
| `gh auth login` | Authenticate the CLI; grant scopes when prompted. | Re-run when you see `Resource not accessible by integration`. |
| `gh repo view --web` | Open the current repo in the browser. | Handy for branch protection / settings checks. |
| `gh pr create` | Open a PR from the current branch. | `--base main --title "<conventional>" --body-file <path>`; also `--draft`, `--reviewer`, `--label`, `--assignee @me`, `--web`. |
| `gh pr list` | List open PRs in the repo. | `--author @me`, `--state all`, `--label <label>`. |
| `gh pr view <num>` | Show a PR's details in the terminal. | `--web` to open in browser; `--comments` to include discussion. |
| `gh pr checks <num>` | Show CI status for a PR. | Run before asking a reviewer to look. |
| `gh pr edit <num>` | Edit title, body, reviewers, labels, base branch. | Pair with `--body-file` to avoid quoting issues. |
| `gh pr ready <num>` | Mark a draft PR ready for review. | `--undo` to flip back to draft. |
| `gh pr merge <num>` | Merge after approval and green checks. | Default `--squash --delete-branch`; use `--merge` only when preserving branch history matters. |
| `gh issue create` | Create an issue. | `--title --body-file --label --assignee @me`. |
| `gh issue edit <num>` | Update an existing issue. | Use `--body-file` to add `Blocked by #X` / parent task-list links. |
| `gh issue comment <num>` | Comment on an issue. | Useful for linking a blocker without editing the body. |
| `gh release create vX.Y.Z` | Cut a release tag and publish notes. | `--target main --title "vX.Y.Z" --generate-notes`; `--notes-file`, `--prerelease`, `--draft`. |
| `gh release edit vX.Y.Z` | Edit a published or draft release. | `--draft=false` to publish a previously drafted release. |
| `gh run list` | List recent GitHub Actions runs. | `--workflow <name>`, `--branch <name>`. |
| `gh run view <id> --log` | Inspect a failed CI run from the CLI. | Faster than clicking through the web UI. |

## Common failure modes

| Error | Cause | Fix |
|-------|-------|-----|
| `gh: command not found` | CLI not installed. | `brew install gh` (macOS), then `gh auth login`. |
| `could not resolve to a Repository` | Not in a git repo, or remote isn't GitHub. | Check `git remote -v`; add a GitHub remote. |
| `Resource not accessible by integration` | Token lacks required scopes. | Re-run `gh auth login` and grant the requested scopes. |
| `fatal: refusing to merge unrelated histories` (on rebase) | Branched from the wrong base. | Re-create the branch off `origin/main`. |
| `! [rejected] ... (non-fast-forward)` after rebase | Local history rewritten; remote is ahead. | `git push --force-with-lease` (never `--force`). |
