---
description: Drive one end-to-end pass through the slice → task → review → fix → close → PR → merge lifecycle for a single feature milestone by invoking each lifecycle skill in order — `kickoff-slice-issue`, `implement-task-issue`, `review-task-issue`, `fix-task-issue`, `close-task-issue`, `create-draft-pr`, `fix-pr`, `close-pr`. Each skill is idempotent, milestone-scoped (filtered by `<feature-name>`), and skips when there's nothing eligible, so a single pass safely advances whatever state is ready; wrap with `/loop /implement-feature <feature-name>` to keep advancing until the feature is fully shipped.
argument-hint: <feature-name>
---

# implement-feature

Run one full sweep across the lifecycle skills, in order, against a single feature milestone in the current repo. This is a thin orchestrator over the eight lifecycle skills — every label flip, agent dispatch, and PR mutation is owned by the individual skills; this command just chains the invocations and scopes each one to `<feature-name>` so unrelated milestones are not touched.

Each skill is **idempotent and self-skipping** — if nothing matches its filter on a given pass (no ready slices in this milestone, no need-fix tasks, no green PRs, etc.) it reports "nothing to pick up" and returns immediately. That makes it safe to invoke all eight unconditionally on every fire.

This command does **not** wait for backgrounded sub-agents (engineers, e2e-authors, reviewers) to finish. Once a skill dispatches its agents, the command moves on to the next skill — backgrounded work continues asynchronously and is picked up by later passes. To keep the lifecycle advancing end-to-end, wrap with `/loop /implement-feature <feature-name>` so subsequent passes catch state that lands after backgrounded work completes.

## Arguments

Exactly one positional argument: `<feature-name>` — the GitHub milestone name created by `/deep-dive-feature` and used by `create-issues` to group every slice/task issue and inherited by every slice PR. This is the SAME string the user passed to `/create-issues <feature-name>`.

If `<feature-name>` is missing or empty, stop and ask the user for it before invoking any skill — running the lifecycle skills without a milestone scope would advance unrelated features in the same repo, which is never what the user wants here.

If you need a per-skill cap on top of milestone scoping, invoke that skill directly with both arguments (e.g. `/implement-task-issue <feature-name> 3`). The orchestration here never passes a cap.

## Workflow

Invoke each skill below via the `Skill` tool, **sequentially** (not in parallel — order matters because each step's GitHub-state mutations are inputs to the next step's filters). Pass `<feature-name>` to every skill as its first (and only) argument. After each skill returns, briefly note in one line what it reported (e.g. `kickoff-slice-issue: promoted 2 slices`), then move to the next step. Do not stop or branch on a skill reporting "nothing to pick up" — proceed to the next skill anyway.

1. **`kickoff-slice-issue <feature-name>`** — Promote ready slice issues (scoped to `<feature-name>` milestone) to `status:in-progress` and append `status:ready-to-implement` to their `kind:feature` task sub-issues. This is what makes tasks visible to step 2.
2. **`implement-task-issue <feature-name>`** — For every ready + unblocked task in this milestone, lock with `status:in-progress` and dispatch the matching one-shot agent in the background (`engineer` for `type:backend` / `type:frontend`, `e2e-author` for `type:e2e`). Backgrounded agents will push commits and add `review:*-pending` labels asynchronously; later passes pick those up.
3. **`review-task-issue <feature-name>`** — For every task in this milestone carrying a `review:*-pending` gate, flip the gate to `-running` and dispatch the matching reviewer (`code-reviewer` / `security-reviewer`) in the background. Backgrounded reviewers post a verdict comment and flip the gate to `-passed` / `-need-fix` asynchronously.
4. **`fix-task-issue <feature-name>`** — For every task in this milestone whose reviewer verdict came back as `*-need-fix` (and with no in-flight review cycle), strip the terminal review labels and dispatch the matching fix agent (`engineer` Mode C / `e2e-author` fix mode) in the background. The fix agent pushes and re-adds `review:*-pending` so the next pass re-dispatches reviewers.
5. **`close-task-issue <feature-name>`** — For every task in this milestone whose required review gates have all reached `*-passed`, strip `status:in-progress` and close the issue. (Backend / frontend tasks need both `code` and `security`; e2e tasks need only `code`.)
6. **`create-draft-pr <feature-name>`** — For every open slice issue in this milestone whose task sub-issues have all closed, open a draft PR with the body from `git-workflow`'s template, link the slice + tasks via `Closes #` keywords, and inherit the slice's milestone.
7. **`fix-pr <feature-name>`** — For every draft PR in this milestone with a CI failure or merge conflict, lock with `status:fix-in-progress` and dispatch `engineer` Mode B in the background with the matching scenario list (`conflict` / `ci`).
8. **`close-pr <feature-name>`** — For every draft PR in this milestone that is `MERGEABLE` with all CI green, promote → squash-merge → strip `status:in-progress` from the linked slice issue → close the slice.

After step 8, print a single summary line: `implement-feature(<feature-name>): pass complete (kickoff <X> / implement <X> / review <X> / fix-task <X> / close-task <X> / draft-pr <X> / fix-pr <X> / close-pr <X>)` using the counts each skill reported.

## Iron rules

- **One milestone per invocation.** The command exists to advance exactly one feature at a time. Multiple features ship in parallel by running `/implement-feature <feature-name>` once per feature (separate invocations / separate `/loop`s). Never call this command without `<feature-name>`, and never pass more than one feature name.
- **Forward `<feature-name>` to every skill, unchanged.** Each lifecycle skill applies the milestone filter on its own `gh issue list` / `gh pr list` query. The command does not pre-filter, does not maintain its own list, and does not interpret the milestone — it just hands the string to each skill.
- **Order is load-bearing.** Each skill's filter depends on labels mutated by an earlier skill (e.g. `implement-task-issue` cannot see a task until `kickoff-slice-issue` appends `status:ready-to-implement`; `close-task-issue` cannot fire until reviewers have flipped gates to `*-passed`). Never reorder, never skip, never parallelize.
- **One pass only — wrap with `/loop` for end-to-end shipping.** This command runs each skill exactly once and exits. Backgrounded sub-agents (engineers, reviewers, fix agents) take real wall time to push commits and flip labels; their results are picked up by later passes, not by this one. Use `/loop /implement-feature <feature-name>` (model-paced) to keep the lifecycle advancing until every slice in the milestone has merged.
- **Do not interpret or override skill output.** Each skill reports its own per-item summary; relay one line per skill into the chain summary at the end. Do not "skip ahead" because a skill reported "nothing to pick up" — the next skill may still have work, and this command's job is to call all eight unconditionally.
- **No code-changing work in this command itself.** Every code change, label flip, comment, and PR mutation is owned by one of the eight skills (or by the backgrounded agents they dispatch). This command never edits files, never pushes branches, never calls `gh` directly.
- **No caps forwarded.** This command always asks each skill to process every eligible item in the milestone. If the user wants a per-skill cap, they should invoke that skill directly with `<feature-name> <cap>`.
