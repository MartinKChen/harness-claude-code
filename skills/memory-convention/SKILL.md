---
name: memory-convention
description: "Reference doc for the per-consuming-project agent memory system. Defines where memory lives in the consuming project (`.claude/memory/`), the schema of each signal file written by engineer/reviewer workflows, the shape of pattern-overlay markdown files loaded by pattern skills, and overlay precedence rules. Referenced by signal-capture steps in workflow skills, by overlay-load sections in pattern skills, and by `workflow-consolidate-memory`. Not invoked as a workflow — purely descriptive."
---

# memory-convention

The harness ships baseline pattern skills that every consuming project starts from. As an engineer or reviewer agent runs against a real codebase, every dispatch produces evidence: which findings stuck, which got rejected as false positives, which mistakes the engineer keeps making, how many cycles each finding category takes to close. That evidence is **per-consuming-project**, lives **only in the consuming project**, and **never flows back upstream into this plugin**.

This skill defines the contract three other skill families honor:

- **Workflow skills** (`workflow-engineer-*`, `workflow-reviewer-*`, `workflow-orchestrator-close-pr`) append rows to the signal store at the end of each dispatch.
- **Pattern skills** (`pattern-engineer-*`, `pattern-reviewer-*`) check for a per-skill overlay file at load time and treat its contents as additive guidance.
- **`workflow-consolidate-memory`** reads the signal store and proposes edits to the overlay files.

## Where memory lives

All memory lives under `<consuming-project-root>/.claude/memory/`. The consuming-project root is the **main working tree** of the consuming project — never a slice worktree.

To resolve it portably from inside any worktree:

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
```

If `$MEMORY_ROOT` does not exist, **skip silently** — the consuming project has not opted in. Do not create it. Opt-in is the user's `mkdir`.

Directory layout once opted in:

```
.claude/memory/
  signals/
    reviews/<task#>.jsonl          ← findings from a task-level reviewer dispatch
    reviews/slice-<slice#>.jsonl   ← findings from a slice-level reviewer dispatch
    fixes/<task#>.jsonl            ← engineer responses on a task-level fix dispatch
    fixes/slice-<slice#>.jsonl     ← engineer responses on a slice-level fix dispatch
    missed/<slice#>.jsonl          ← findings caught downstream that an earlier stage missed
    cycles/<task#>.json            ← per-task summary written on task review:passed
    cycles/slice-<slice#>.json     ← per-slice summary written on PR merge
    .archive/                      ← consumed-and-archived signal files (optional)
  patterns/
    <pattern-skill-name>.md        ← per-skill project overlay, written by consolidation
  consolidation-log.md             ← audit trail: when consolidation ran, what it consumed, what it wrote
```

**File naming rule.** Task-scoped signal files are keyed by the bare task number (`<task#>.jsonl`); slice-scoped files use the `slice-` prefix (`slice-<slice#>.jsonl`) so a task and slice numbered identically never collide. Inside each row, both `task` and `slice` keys are populated where applicable — the prefix is purely a filesystem disambiguator.

## Signal file schemas

All signal files use **JSON Lines** except `cycles/<task#>.json` (single JSON object per file). Every row carries an ISO-8601 `ts` and the `task#` / `slice#` it pertains to.

### `signals/reviews/<task#>.jsonl` — one row per finding

Written by `workflow-reviewer-review-task` after the verdict comment is posted.

```json
{"ts": "2026-05-25T14:32:17Z", "task": 142, "slice": 138, "finding_handle": "F1", "pattern_skill": "pattern-reviewer-python", "category": "mutable-default-argument", "severity": "HIGH", "location": "src/api/users.py:42", "title": "mutable list default in append_item"}
```

Required keys: `ts`, `task`, `slice`, `finding_handle`, `pattern_skill`, `category`, `severity`, `location`, `title`.

`category` is a short kebab-case label the reviewer derives from the rule it triggered on (e.g. `f-string-sql`, `missing-type-annotation`, `narrow-except`). Categories are the unit of aggregation in consolidation.

### `signals/fixes/<task#>.jsonl` — one row per finding addressed

Written by `workflow-engineer-fix-task` and `workflow-engineer-fix-slice` after the fix push.

```json
{"ts": "2026-05-25T15:01:42Z", "task": 142, "slice": 138, "finding_handle": "F1", "pattern_skill": "pattern-reviewer-python", "category": "mutable-default-argument", "engineer_action": "fixed", "cycle_number": 1, "note": ""}
```

Required keys: `ts`, `task`, `slice`, `finding_handle`, `pattern_skill`, `category`, `engineer_action`, `cycle_number`.

`engineer_action` is one of:
- `fixed` — the engineer applied the suggested fix (or a semantically equivalent one).
- `rejected` — the engineer pushed back (rule does not apply here; finding is a false positive). `note` should explain why.
- `modified` — the engineer applied a different fix than suggested. `note` should explain the difference.

`cycle_number` is the 1-indexed fix cycle within the task (cycle 1 = first review→fix round, cycle 2 = second, etc.).

### `signals/missed/<slice#>.jsonl` — caught-by-downstream

Written by `workflow-reviewer-review-slice` and `workflow-orchestrator-close-pr` when they surface a finding that an earlier stage should have caught.

```json
{"ts": "2026-05-25T16:22:09Z", "slice": 138, "parent_task": 142, "caught_by": "slice-review", "missed_by": "task-review", "pattern_skill": "pattern-reviewer-python", "category": "narrow-except", "location": "src/api/users.py:88", "title": "broad except Exception swallows DB error"}
```

Required keys: `ts`, `slice`, `parent_task`, `caught_by`, `missed_by`, `pattern_skill`, `category`, `location`, `title`.

`caught_by` ∈ {`slice-review`, `pr-review`, `human-review`}; `missed_by` ∈ {`task-review`, `slice-review`}.

### `signals/cycles/<task#>.json` — per-task time-to-green summary

Written by `workflow-reviewer-review-task` on the terminal `review:passed` flip. One file per task (overwritten if a task is re-opened, which is rare).

```json
{
  "ts": "2026-05-25T17:14:33Z",
  "task": 142,
  "slice": 138,
  "total_cycles": 2,
  "by_pattern": {
    "pattern-reviewer-python": {"findings": 3, "cycles_to_resolve": 2},
    "pattern-reviewer-security": {"findings": 1, "cycles_to_resolve": 1}
  }
}
```

`cycles_to_resolve` per pattern = the cycle number at which the last finding from that pattern was resolved.

### `signals/cycles/slice-<slice#>.json` — per-slice lifetime summary

Written by `workflow-orchestrator-close-pr` when the slice PR merges. Captures the slice's churn from first task implementation to merge.

```json
{
  "ts": "2026-05-25T19:42:11Z",
  "slice": 138,
  "task_count": 5,
  "task_review_cycles_sum": 7,
  "slice_review_cycles": 1,
  "pr_review_cycles": 0
}
```

`task_review_cycles_sum` = sum of `total_cycles` across the slice's tasks (read from `signals/cycles/<task#>.json`). `slice_review_cycles` = count of `Refs #<slice-#>` commits on the slice branch produced after the first slice review. `pr_review_cycles` = count of distinct user comments on the PR matching `^# (Review|Code Review)` (proxy for human PR-level reviews).

## Overlay file shape

`.claude/memory/patterns/<pattern-skill-name>.md` mirrors the structural shape of the baseline pattern skill it overlays:

```markdown
# <pattern-skill-name> — project overlay

Generated and maintained by `workflow-consolidate-memory`. Hand-edit if you must,
but prefer letting consolidation propose changes.

## Sharpened triggers
<rule additions that narrow or widen when the baseline rule applies in this project>

## Project-specific carve-outs
<false-positive contexts confirmed across N+ cycles — rule does NOT apply when ...>

## New rules
<rules discovered from missed-catch signals that the baseline does not yet cover>

## Examples worth pinning
<BAD/GOOD snippets from this project's own history that make a rule clearer than the baseline's generic examples>
```

Any of the four sections may be empty; only populated sections need exist. Each item under a section is a bulleted rule plus an optional fenced code block for BAD/GOOD examples — same shape pattern skills use today.

## Overlay precedence

When a pattern skill loads, it reads its own SKILL.md first, then checks `$MEMORY_ROOT/patterns/<this-skill-name>.md`. If present:

1. **Treat overlay rules as additive.** A new rule in the overlay is a new rule the reviewer must check; a sharpened trigger narrows or widens when an existing rule fires; a carve-out is a documented "do not flag in this context" instruction.
2. **Never silently override.** If an overlay rule contradicts a baseline rule (e.g. baseline says HIGH, overlay says LOW for the same situation), the agent must surface the conflict in its output rather than picking one. A conflict means consolidation has drifted from baseline and a human needs to reconcile — either by editing the overlay or by sending the rule upstream to the plugin.
3. **Overlay severity cannot exceed baseline severity.** An overlay can downgrade a baseline rule's severity for a specific carve-out (LOW for a documented internal-only API) but cannot upgrade a LOW rule to CRITICAL — that's a new rule, not an overlay.

## Opt-in / opt-out

- **Opt in:** `mkdir -p .claude/memory/signals .claude/memory/patterns` in the consuming project root. The next engineer / reviewer dispatch starts writing signals; the next pattern-skill load starts checking for overlays.
- **Opt out:** `rm -rf .claude/memory/` in the consuming project root. All signal capture and overlay loading silently no-ops.

No flags, no settings, no plugin config. Presence of the directory is the contract.

## What this skill does NOT do

- Does not write code. Other skills consume this convention; this file is the spec they read.
- Does not get invoked as a workflow. Other skills reference it by name; agents may read it for context but never "execute" it.
- Does not modify baseline pattern skills in this plugin repo. Overlays live only in the consuming project; the upstream baseline ships unchanged.
