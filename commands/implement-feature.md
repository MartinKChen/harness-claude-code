---
description: Drive one end-to-end pass through the slice → task → review → fix → close → PR → merge lifecycle for a single feature milestone by invoking each lifecycle skill in order. Each skill is idempotent, milestone-scoped (filtered by `<feature-name>`), and skips when there's nothing eligible, so a single pass safely advances whatever state is ready; wrap with `/loop /implement-feature <feature-name>` to keep advancing until the feature is fully shipped.
argument-hint: <feature-name>
---

# implement-feature

Run one full sweep across the lifecycle skills, in order, against a single feature milestone in the current repo. This is a thin orchestrator over the lifecycle skills — every label flip, agent dispatch, and PR mutation is owned by the individual skills; this command just chains the invocations and scopes each one to `<feature-name>` so unrelated milestones are not touched.

Each skill is **idempotent and self-skipping** — if nothing matches its filter on a given pass it reports "nothing to pick up" and returns immediately. That makes it safe to invoke them all unconditionally on every fire.

This command does **not** wait for backgrounded sub-agents (engineers, e2e-authors, reviewers) to finish. Once a skill dispatches its agents, the command moves on — backgrounded work continues asynchronously and is picked up by later passes. To keep the lifecycle advancing end-to-end, wrap with `/loop /implement-feature <feature-name>`.

## Arguments

Exactly one positional argument: `<feature-name>` — the GitHub milestone name created by `/deep-dive-feature` and used by `create-issues` to group every slice/task issue and inherited by every slice PR.

If `<feature-name>` is missing or empty, stop and ask the user for it before invoking any skill — running the lifecycle skills without a milestone scope would advance unrelated features in the same repo, which is never what the user wants here.

If you need a per-skill cap on top of milestone scoping, invoke that skill directly with both arguments (e.g. `/workflow-orchestrator-implement-task <feature-name> 3`). The orchestration here never passes a cap.

## Workflow

Invoke each skill below via the `Skill` tool, **sequentially** (not in parallel — order matters because each step's GitHub-state mutations are inputs to the next step's filters). Pass `<feature-name>` to every skill as its first (and only) argument. After each skill returns, briefly note in one line what it reported, then move to the next step. Do not stop or branch on a skill reporting "nothing to pick up" — proceed to the next skill anyway.

### Task lifecycle

1. **`workflow-orchestrator-kickoff-slice <feature-name>`** — Promote ready slice issues to `status:in-progress` and append `status:ready-to-implement` to their `kind:feature` task sub-issues. This is what makes tasks visible to step 2.
2. **`workflow-orchestrator-implement-task <feature-name>`** — For every ready + unblocked task in this milestone, lock with `status:in-progress` and dispatch the matching background agent (`engineer` for `type:backend` / `type:frontend`, `e2e-author` for `type:e2e`). Backgrounded agents push commits and add `review:pending` asynchronously.
3. **`workflow-orchestrator-review-task <feature-name>`** — For every task carrying `review:pending`, flip to `review:running` and dispatch the `reviewer` agent in the background. Backgrounded reviewers post a verdict comment and flip the gate to `review:passed` / `review:need-fix`. On `passed` the reviewer also closes the task issue (the task lifecycle ends here).
4. **`workflow-orchestrator-fix-task <feature-name>`** — For every task whose verdict came back as `review:need-fix`, strip the label and dispatch the matching fix agent (`engineer` for backend/frontend, `e2e-author` for e2e). The agent pushes and re-adds `review:pending` so the next pass re-dispatches the reviewer.

### Slice lifecycle

5. **`workflow-orchestrator-prepare-slice <feature-name>`** — For every slice whose task sub-issues have ALL closed (and no `review:*` / `e2e:*` label yet), lock with `e2e:running` and dispatch `engineer` in the background to run the slice's E2E specs against a real stack via testcontainers. The engineer drives TDD on production code only — never modifies E2E specs — and on full green removes `e2e:running` + adds `review:pending` to the slice (which is what step 6 picks up). On a test-case constraint the engineer bails to `status:need-attention`.
6. **`workflow-orchestrator-review-slice <feature-name>`** — For every slice carrying `review:pending`, flip to `review:running` and dispatch the `reviewer` agent. On pass, the reviewer creates the draft PR (`merge:manual`) with the slice's `Closes #<slice-#>` body. On fail, the gate flips to `review:need-fix`.
7. **`workflow-orchestrator-fix-slice <feature-name>`** — For every slice carrying `review:need-fix`, strip the label and dispatch `engineer` to (a) address slice-level findings via TDD on production code and (b) re-validate the slice's E2E suite via testcontainers. The engineer pushes and re-adds `review:pending` so step 6 re-dispatches the reviewer. On an E2E test-case constraint the engineer bails to `status:need-attention`.

### PR lifecycle

8. **`workflow-orchestrator-fix-pr <feature-name>`** — For every draft PR in this milestone with a CI failure or merge conflict (and no `status:fix-in-progress` / `status:need-attention` already present), lock with `status:fix-in-progress` and dispatch `engineer` in the background. The engineer determines the specific fix scope itself.
9. **`workflow-orchestrator-close-pr <feature-name>`** — For every draft PR in this milestone labeled `merge:auto` that is `MERGEABLE` with all CI green, promote draft → ready, squash-merge with `--delete-branch`. GitHub auto-closes the slice when the PR merges (via the `Closes #<slice-#>` body line).

`merge:manual` drafts (reviewer's default) are not auto-merged here — the user opens and merges those manually.

After step 9, print a single summary line: `implement-feature(<feature-name>): pass complete (kickoff <X> / implement <X> / review-task <X> / fix-task <X> / prepare-slice <X> / review-slice <X> / fix-slice <X> / fix-pr <X> / close-pr <X>)` using the counts each skill reported. Note that `prepare-slice` and `fix-slice` both dispatch engineers in the background — their reported count is the number of slices locked + dispatched in this fire, not the number that finished validating. Wrap with `/loop /implement-feature <feature-name>` so subsequent passes pick up slices once the backgrounded engineers add `review:pending`.

## Iron rules

- **One milestone per invocation.** Run `/implement-feature <feature-name>` once per feature.
- **Forward `<feature-name>` to every skill, unchanged.** Each skill applies the milestone filter on its own `gh` query. This command does not pre-filter or interpret the milestone.
- **Order is load-bearing.** Each skill's filter depends on labels mutated by an earlier skill. Never reorder, never skip, never parallelize.
- **One pass only — wrap with `/loop` for end-to-end shipping.** Backgrounded sub-agents take real wall time; their results are picked up by later passes.
- **Do not interpret or override skill output.** Relay one line per skill. Do not "skip ahead" because a skill reported "nothing to pick up".
- **No code-changing work in this command itself.** Every code change, label flip, comment, and PR mutation is owned by one of the lifecycle skills (or by the backgrounded agents they dispatch).
- **No caps forwarded.** Always process every eligible item in the milestone.
