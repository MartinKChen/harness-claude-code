# Dispatch-prompt skeleton

Orchestrator skills pass a minimal prompt to dispatched sub-agents. The agent rediscovers everything (issue body, slice branch, worktree path, recent commits) on its own from the issue ID. Keep the prompt small — extra context here is hard to audit and goes stale.

## Implement / author a task

```
Implement GitHub task issue #<task-#>.

Discover the issue body, parent slice issue, slice branch, and worktree path
yourself via `gh` and `git`. You own the lifecycle until you push and add
`review:pending` to the task issue.
```

## Fix reviewer findings on a task

```
Fix the review feedback on GitHub task issue #<task-#>.

Read every comment posted after the last commit that carries
`Refs #<task-#>`, then drive the fix. You own the lifecycle until you push
and add `review:pending` to the task issue.
```

## Fix reviewer findings on a slice (engineer re-runs E2E after the fix)

```
Fix the review feedback on GitHub slice issue #<slice-#>.

Read every comment posted after the last commit that carries
`Refs #<slice-#>`, drive the fix via TDD on production code, then
re-validate the slice's E2E specs via testcontainers. You own the
lifecycle until you push and add `review:pending` to the slice issue.
```

## Validate E2E test cases on a slice

```
Validate E2E test cases on GitHub slice issue #<slice-#>.

Find every E2E spec created or modified on the slice branch, run them
against the slice's stack via testcontainers, and drive TDD on production
code only (never modify the E2E specs) until they're all green. You own
the lifecycle until you remove `e2e:running` and add `review:pending` to
the slice issue — or, if a spec fails due to a test-case constraint that
can't be addressed via production-code changes, flip to
`status:need-attention` and exit.
```

## Review a task or slice

```
Review GitHub <task|slice> issue #<n>.

Discover the issue body, slice branch, worktree path, and scoped commits
yourself. You own the lifecycle until you post your verdict comment and
flip `review:running` to its terminal state.
```

## Fix a PR

```
Fix PR #<pr-#>.

Determine the blockers (merge conflict, failing CI, or both) yourself.
You own the lifecycle until you push the fix and clear `status:in-progress`
on the PR's linked slice issue if the PR's slice carries it.
```

## Placeholders

| Placeholder      | Source                                              |
|------------------|-----------------------------------------------------|
| `<task-#>`       | The task issue number being dispatched.             |
| `<slice-#>`      | The slice issue number being dispatched.            |
| `<pr-#>`         | The draft PR number being dispatched.               |

The orchestrator fills these in before calling `Agent`. Nothing else goes into the prompt — the dispatched agent uses the issue / PR ID as its single source of truth.
