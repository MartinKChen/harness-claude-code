---
name: operation-engineer-handoff
description: "Bounded-session handoff for the engineer agent. Owns the doc path convention (`/tmp/claude-handoff/<repo>/<unit>.md`), the incoming-pickup procedure (read the doc, verify WIP commits, resume from the recorded stop point), the outgoing-handoff procedure (finish the current TDD step, commit + push, write the doc, exit cleanly without flipping `review:pending`), and the handoff-doc template. Invoke at engineer kickoff to check for an inbound handoff, and invoke mid-workflow when the conversation budget approaches ~100K tokens."
---

# operation-engineer-handoff

Long-running TDD loops can outgrow a single agent's context window. This skill keeps the engineer agent's sessions **bounded**: pick up where the previous agent stopped (if there's a handoff doc), and hand off cleanly when the conversation approaches ~100K tokens so the next dispatch can keep going without losing state.

The engineer agent loads this skill on every dispatch. The procedures below are only executed when their trigger fires.

## When to activate

- **Incoming pickup** — At engineer kickoff, after the loaded workflow's worktree-setup step and before any implementation step. Trigger: a handoff doc exists at the computed path for this unit of work.
- **Outgoing handoff** — Mid-workflow, when the conversation budget is approaching ~100K tokens. Signals: long bash output, many file reads, repeated RED→GREEN cycles, extended diagnostics. Cut over while there's still budget to write a clean doc — don't wait until the next edit fails.

Do NOT activate for reviewer / orchestrator / e2e-author dispatches — handoff is only wired into the engineer agent. Do NOT activate to "checkpoint" progress mid-task when the context budget is fine; commit + push as normal.

## Handoff doc path

```
/tmp/claude-handoff/<repo>/<unit>.md
```

- `<repo>` = `basename "$(git rev-parse --show-toplevel)"` (same convention as the worktree path under `/tmp/git-worktree/<repo>/<slice-branch>`).
- `<unit>` is derived from the dispatch verb:

  | Dispatch verb | `<unit>` |
  |---------------|----------|
  | `Implement GitHub task issue #<n>` | `task-<n>` |
  | `Fix the review feedback on GitHub task issue #<n>` | `task-<n>` |
  | `Fix the review feedback on GitHub slice issue #<n>` | `slice-<n>` |
  | `Fix PR #<n>` | `pr-<n>` |

One unit of work, one handoff doc. The doc is overwritten on every outgoing handoff so it always reflects the most recent stop point. Ensure the parent directory exists before writing (`mkdir -p /tmp/claude-handoff/<repo>`).

## Incoming pickup

Run after the workflow's worktree-setup step and BEFORE any implementation step.

1. Compute the handoff doc path from the dispatch verb + repo.
2. If the file does not exist, exit this procedure — proceed normally with the workflow.
3. If the file exists, read it end-to-end.
4. Verify the WIP commits the doc lists are actually present on the slice branch:
   ```bash
   git -C <worktree> log --grep "Refs #<unit-id>"
   ```
   If commits the doc references are missing from the branch, the previous handoff was incomplete — surface a diagnostic naming the missing SHAs and stop. Do NOT proceed; do NOT delete the doc.
5. Resume from the doc's **Where to pick up next** section. Do NOT redo committed steps. Do NOT second-guess decisions already recorded under **Surprises / decisions** — they exist precisely so the next agent doesn't re-litigate them.
6. Leave the handoff doc on disk while you work. Delete it only after the workflow's terminal action (push + `review:pending` flip, or equivalent for fix-pr) has succeeded — at that point this unit of work is complete and the doc is no longer relevant. Cleanup:
   ```bash
   rm -f /tmp/claude-handoff/<repo>/<unit>.md
   ```

## Outgoing handoff

Trigger when the conversation context is approaching ~100K tokens.

1. **Finish the current TDD step.** Never hand off mid-RED or mid-GREEN — either complete the cycle or `git restore` the half-edit so the working tree is clean. A partial edit on disk that's not in a commit is invisible to the next agent.
2. **Commit + push every completed step** on the slice branch using the project's Conventional Commits format with both `Refs` trailers (or `Refs #<pr-#>` + `Refs #<slice-#>` for the fix-pr flavor). The next agent must not re-do work that's already on the branch. Push to `origin` before writing the doc — the doc references SHAs that must be fetchable.
3. **Write the handoff doc** at `/tmp/claude-handoff/<repo>/<unit>.md` using the template at `templates/handoff-doc.md`. Fill every section that has content; omit sections that don't (but keep the headers stable so the pickup agent can `grep` for them).
4. **Exit cleanly.** Do NOT flip `review:pending` (the work isn't done). Do NOT touch `status:in-progress` (the unit is still the same dispatch's lock). Do NOT close the issue or open a PR. Surface a short diagnostic to the caller naming the handoff doc path so whoever re-dispatches knows to re-trigger.

## Iron rules

- **One unit, one doc.** Never write a handoff doc for a unit other than the one this dispatch is working. Never read a handoff doc for a different unit.
- **Commits are the source of truth; the doc is just a pointer.** Anything the next agent needs to act on must already be in a pushed commit. The doc describes *where to continue from* the committed state — it never carries uncommitted diffs.
- **Never force-push, never skip hooks during a handoff commit.** If a pre-push hook fails, drop the handoff, fix the failure first, then re-attempt. A broken push leaves the branch in a state the next agent can't trust.
- **Verify before you resume.** Always confirm the doc's referenced commits actually exist on the branch before acting on the doc's instructions. A doc that references SHAs not on the branch is poisoned — surface and stop.
- **Delete only on terminal success.** The doc stays on disk through retries / partial fixes / additional handoffs. It is removed only when the unit's terminal workflow action succeeds.
