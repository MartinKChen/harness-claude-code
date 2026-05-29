---
name: operation-engineer-handoff
description: "Bounded-session handoff for the engineer agent. Owns the doc path convention (`/tmp/harness-claude-code/<repo>/handoffs/<unit>.md`), the incoming-pickup procedure (read the doc, verify WIP commits, resume from the recorded stop point), the outgoing-handoff procedure (finish the current TDD step, commit + push, write the doc, exit cleanly without flipping `review:pending`), and the handoff-doc template. Loaded conditionally: at engineer kickoff when a handoff doc already exists at the computed path OR the slice branch carries prior `Refs #<unit>` WIP commits (crash recovery), and on-demand when the `engineer-budget-gate.sh` hook denies a mutation with a handoff instruction (default threshold 150K). Also defines the crash-resilience contract: a SIGKILL'd agent leaves no doc, but its pushed WIP commits plus the Stage-0 reconcile reaper let a fresh dispatch resume from the last committed step."
---

# operation-engineer-handoff

Long-running TDD loops can outgrow a single agent's context window. This skill keeps the engineer agent's sessions **bounded**: pick up where the previous agent stopped (if there's a handoff doc), and hand off cleanly when the harness-side budget-gate hook denies a mutation telling the agent to wrap up, so the next dispatch can keep going without losing state.

## Trigger ownership — the hook is the signal, not the agent

The agent CANNOT reliably measure its own window occupancy from inside the conversation. Only the harness can — and it does, via `hooks/engineer-budget-gate.sh` on `PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Bash)`. That hook reads the live transcript's most-recent assistant turn usage, fires a `deny` with a handoff instruction once occupancy crosses `ENGINEER_HANDOFF_THRESHOLD` (default 150000), then steps aside so the handoff's own commit / push / doc-write are not blocked. It re-arms after another `ENGINEER_HANDOFF_REARM` (default 20000) of growth in case the agent ignored the first deny.

Do not author "I think I'm running out of context, let me hand off" prose. Wait for the hook deny — it's keyed to the real signal, fires before the safety margin runs out, and tells you the exact unit, doc path, and threshold value in its reason text.

## When to activate

- **Incoming pickup** — At engineer kickoff, after the loaded workflow's worktree-setup step and before any implementation step. Trigger: **either** a handoff doc exists at the computed path for this unit of work (graceful handoff), **or** no doc exists but the slice branch already carries `Refs #<unit>` WIP commits from a prior dispatch that was killed mid-run before it could finish (crash recovery). The engineer agent loads this skill when `[ -f /tmp/harness-claude-code/<repo>/handoffs/<unit>.md ]` OR `git -C <worktree> log --grep "Refs #<unit-id>"` is non-empty.
- **Outgoing handoff** — When the `engineer-budget-gate.sh` PreToolUse hook denies a mutating tool call with a handoff instruction in its `permissionDecisionReason`. The agent loads this skill in response to the deny and runs the procedure below.

Do NOT activate for reviewer / orchestrator / e2e-author dispatches — handoff is only wired into the engineer agent. Do NOT write a handoff *doc* mid-task to "checkpoint" progress when no budget-gate deny has fired — the checkpoint mechanism is ordinary commit + push of each completed step (see **Crash resilience**), not a doc.

## Handoff doc path

```
/tmp/harness-claude-code/<repo>/handoffs/<unit>.md
```

- `<repo>` = the consuming project's basename — the path component between `harness-claude-code/` and `worktrees/` in the worktree's path, i.e. the `<repo>` in `/tmp/harness-claude-code/<repo>/worktrees/<slice-branch>`. Derive it from the worktree cwd, e.g. `sed -E 's#^.*/harness-claude-code/([^/]+)/worktrees/.*#\1#'`. Do NOT use `basename "$(git rev-parse --show-toplevel)"`: inside a linked worktree that resolves to the slice-branch leaf, not the repo, and the doc would land at a path the budget-gate / PreCompact hooks don't write to.
- `<unit>` is derived from the dispatch verb:

  | Dispatch verb | `<unit>` |
  |---------------|----------|
  | `Implement GitHub task issue #<n>` | `task-<n>` |
  | `Fix the review feedback on GitHub task issue #<n>` | `task-<n>` |
  | `Fix the review feedback on GitHub slice issue #<n>` | `slice-<n>` |
  | `Fix PR #<n>` | `pr-<n>` |

One unit of work, one handoff doc. The doc is overwritten on every outgoing handoff so it always reflects the most recent stop point. Ensure the parent directory exists before writing (`mkdir -p /tmp/harness-claude-code/<repo>/handoffs`).

## Incoming pickup

Run after the workflow's worktree-setup step and BEFORE any implementation step. There are two pickup paths — a graceful handoff (doc present) and a crash recovery (no doc, but the branch carries prior WIP commits).

1. Compute the handoff doc path from the dispatch verb + repo.
2. **Doc present — graceful handoff.** Read it end-to-end. Verify the WIP commits it lists are actually present on the slice branch:
   ```bash
   git -C <worktree> log --grep "Refs #<unit-id>"
   ```
   If commits the doc references are missing from the branch, the previous handoff was incomplete — surface a diagnostic naming the missing SHAs and stop. Do NOT proceed; do NOT delete the doc. Otherwise resume from the doc's **Where to pick up next** section. Do NOT redo committed steps. Do NOT second-guess decisions already recorded under **Surprises / decisions** — they exist precisely so the next agent doesn't re-litigate them.
3. **No doc but prior `Refs #<unit-id>` WIP commits exist — crash recovery.** The previous dispatch was killed mid-run (a `SIGKILL` gives no chance to write a doc) and the Stage-0 reconcile reaper released the lock so you were re-dispatched. Reconstruct the stop point from the branch itself: read every WIP commit and its diffstat (`git -C <worktree> log --stat --grep "Refs #<unit-id>"`), map the committed steps onto the issue's done criteria, and resume from the first unsatisfied step. Do NOT redo committed steps. Treat any uncommitted working-tree change as suspect — a partial edit captured at kill time — `git restore` it and re-derive that step cleanly so you build on a clean, committed base.

   **Resume the prior approach — do not restart with a fresh strategy.** The committed WIP commits embody the previous agent's chosen design and the seams it already built; your job is to *continue* that line, not to re-litigate it. Restarting from a blank approach because you'd have designed it differently throws away the committed work's value and roughly doubles wall-clock — it is the single most expensive crash-recovery anti-pattern. Abandon the prior approach only when a committed step is *provably* wrong (e.g. its own test fails on re-run, or it contradicts the issue's done criteria); if you do, say so explicitly in your first diagnostic, naming the commit and the evidence — never silently swap strategies.
4. **Neither doc nor prior WIP commits.** Start fresh — proceed normally with the workflow.
5. Leave the handoff doc (when one exists) on disk while you work. Delete it only after the workflow's terminal action (push + `review:pending` flip, or equivalent for fix-pr) has succeeded — at that point this unit of work is complete and the doc is no longer relevant. Cleanup:
   ```bash
   rm -f /tmp/harness-claude-code/<repo>/handoffs/<unit>.md
   ```

## Outgoing handoff

Trigger: `engineer-budget-gate.sh` returned a `deny` whose `permissionDecisionReason` instructs you to run Outgoing handoff. The reason text names the exact occupancy, threshold, and doc path. Do not pre-emptively run this procedure without that deny.

1. **Finish the current TDD step.** Never hand off mid-RED or mid-GREEN — either complete the cycle or `git restore` the half-edit so the working tree is clean. A partial edit on disk that's not in a commit is invisible to the next agent.
2. **Commit + push every completed step** on the slice branch using the project's Conventional Commits format with both `Refs` trailers (or `Refs #<pr-#>` + `Refs #<slice-#>` for the fix-pr flavor). The next agent must not re-do work that's already on the branch. Push to `origin` before writing the doc — the doc references SHAs that must be fetchable.
3. **Write the handoff doc** at `/tmp/harness-claude-code/<repo>/handoffs/<unit>.md` using the template at `templates/handoff-doc.md`. Fill every section that has content; omit sections that don't (but keep the headers stable so the pickup agent can `grep` for them).
4. **Exit cleanly.** Do NOT flip `review:pending` (the work isn't done). Do NOT touch `status:in-progress` (the unit is still the same dispatch's lock). Do NOT close the issue or open a PR. Surface a short diagnostic to the caller naming the handoff doc path so whoever re-dispatches knows to re-trigger.

## Crash resilience — the checkpoint contract

A budget-gate handoff is *graceful*: you finish a step, commit, push, and write the doc. A crash is not — a `SIGKILL` (memory pressure, killed process tree) is uncatchable, so a crashed dispatch writes **no doc and no exit signal**. Recovery is therefore not your job at crash time; it is split across two mechanisms that have already been built:

- **The Stage-0 reconcile reaper** (`task-finder-stage-0-reconcile.sh`, run each `/implement-feature` pass) detects the orphaned lock — your dispatch's in-flight label with a stale telemetry heartbeat — and flips it back to its ready state. The next pass re-dispatches the unit to a fresh engineer.
- **Your pushed WIP commits** are the only state that survives. The fresh engineer's **Incoming pickup** path 3 above resumes from them.

What this asks of you while you work: **commit and push each completed TDD step promptly — do not batch pushes to the end.** Every pushed step is a durable checkpoint that bounds crash loss to at most the single in-flight step, and (as a bonus) keeps the slice branch's last-commit time fresh, which is the liveness signal the reaper's GitHub-staleness fallback reads for engineer dispatches that have no telemetry record. This is *not* the mid-task doc-writing the iron rules forbid — it is ordinary commit + push, just promptly rather than hoarded. The handoff *doc* is still written only on a budget-gate deny.

## Iron rules

- **One unit, one doc.** Never write a handoff doc for a unit other than the one this dispatch is working. Never read a handoff doc for a different unit.
- **Push completed steps promptly; never hoard commits.** A pushed step is a crash checkpoint and a liveness signal. Local-only commits are lost if the worktree is reclaimed, and a long unpushed stretch reads as a dead branch to the reaper.
- **Commits are the source of truth; the doc is just a pointer.** Anything the next agent needs to act on must already be in a pushed commit. The doc describes *where to continue from* the committed state — it never carries uncommitted diffs.
- **Never force-push, never skip hooks during a handoff commit.** If a pre-push hook fails, drop the handoff, fix the failure first, then re-attempt. A broken push leaves the branch in a state the next agent can't trust.
- **Verify before you resume.** Always confirm the doc's referenced commits actually exist on the branch before acting on the doc's instructions. A doc that references SHAs not on the branch is poisoned — surface and stop.
- **Crash-recovery resumes, never restarts.** A re-dispatched engineer continues the approach encoded in the prior WIP commits — it does not discard them and adopt a fresh strategy. Restarting doubles wall-clock and is only justified when a committed step is provably wrong; when it is, name the commit and the evidence before deviating.
- **Delete only on terminal success.** The doc stays on disk through retries / partial fixes / additional handoffs. It is removed only when the unit's terminal workflow action succeeds.
