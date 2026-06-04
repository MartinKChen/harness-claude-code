# Dispatch-prompt skeleton

The inner slice lifecycle runs inside one background `implement-slice` Workflow per slice (see `workflow-implement-slice`). That workflow dispatches sub-agents at each phase with a minimal prompt: a **(slice #, task IDs)** pair, never an issue-per-task. There are no per-task issues — task tracking lives in a static-ID checklist inside the slice issue body. Each dispatched agent reads the slice body, locates its task block(s), and resumes from the checklist (an already-`[x]` task is done).

The orchestrator (the workflow, or the outer `/loop` for `fix-pr`) fills ONLY the placeholders — never failure logs or diagnosis. Extra context here is hard to audit and goes stale.

## Author E2E for a slice's e2e tasks

```
Author E2E for slice #<slice-#> tasks <ids>.

Read the slice #<slice-#> body and locate the named e2e task block(s) in the
`## Tasks` checklist. Author one Playwright spec per task's mapped Gherkin
scenario, tick each authored task's checkbox in the slice body, post a comment
summarizing what you authored, then commit and push. You own the lifecycle
until your specs are pushed and the boxes are ticked.
```

## Fix E2E coverage feedback on a slice

```
Fix E2E coverage feedback on slice #<slice-#>.

Read the newest coverage-gate review comment (posted after the last commit that
carries `Refs #<slice-#>`), then revise the E2E specs to close the gap. Commit,
push, and post a comment summarizing the fix. You own the lifecycle until the
revised specs are pushed.
```

## Implement a slice's tasks

```
Implement slice #<slice-#> tasks <ids>.

Read the slice #<slice-#> body, locate the named task block(s) in the `## Tasks`
checklist, and follow each task's spec pointer (api-contract / data-model /
Gherkin scenario / design tokens). Drive outside-in TDD, tick each task's
checkbox as you finish it, commit per task (one `Task: <id>` trailer each), and
push. You own the lifecycle until the named tasks are implemented, boxed, and
pushed.
```

## Pass E2E acceptance for a slice

```
Pass E2E acceptance for slice #<slice-#>.

Find every E2E spec on the slice branch, run them against the slice's stack via
testcontainers, and drive TDD on production code only (never modify the E2E
specs) until they are all green, then push. You own the lifecycle until the
suite is green and pushed — or, if a spec fails due to a test-case constraint
that can't be addressed via production-code changes, flip the slice to
`status:need-attention` and exit.
```

## Fix reviewer findings on a slice

```
Fix the review feedback on slice #<slice-#>.

Read every comment posted after the last commit that carries `Refs #<slice-#>`,
drive the fix via TDD on production code, then commit, push, and post a comment
summarizing the fix. You own the lifecycle until the fix is pushed.
```

## Fix a PR

```
Fix PR #<pr-#>.

Determine the blockers (merge conflict, failing CI, or both) yourself.
You own the lifecycle until you push the fix and clear `status:fix-in-progress`
on the PR.
```

## Placeholders

| Placeholder      | Source                                                       |
|------------------|--------------------------------------------------------------|
| `<slice-#>`      | The slice issue number the workflow is driving.              |
| `<ids>`          | Comma-separated static task IDs from the slice checklist (e.g. `e2e.1,e2e.2` or `be.1`). |
| `<pr-#>`         | The draft PR number being dispatched (`fix-pr` only).        |

The orchestrator fills these in before calling `Agent`. Nothing else goes into the prompt — the dispatched agent uses the slice body's checklist as its single source of truth for task state.
