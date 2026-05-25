---
name: memory-convention
description: "Reference doc for the per-consuming-project agent memory system. Defines where memory lives (`$TMPDIR/claude-memory/<project-slug>/`, auto-created, always-on), the schema of each signal file written by engineer/reviewer workflows, the runtime-telemetry signals captured per engineer/reviewer dispatch (agent identity, dispatch prompt, tool calls, skills loaded, token usage, duration), the shape of pattern-overlay markdown files loaded by pattern skills, and overlay precedence rules. Referenced by signal-capture steps in workflow skills, by overlay-load sections in pattern skills, by the runtime-telemetry hook scripts, and by `workflow-consolidate-memory`. Not invoked as a workflow — purely descriptive."
---

# memory-convention

The harness ships baseline pattern skills that every consuming project starts from. As an engineer or reviewer agent runs against a real codebase, every dispatch produces evidence: which findings stuck, which got rejected as false positives, which mistakes the engineer keeps making, how many cycles each finding category takes to close. That evidence is **per-consuming-project**, lives **only in the consuming project**, and **never flows back upstream into this plugin**.

This skill defines the contract three other skill families honor:

- **Workflow skills** (`workflow-engineer-*`, `workflow-reviewer-*`, `workflow-orchestrator-close-pr`) append rows to the signal store at the end of each dispatch.
- **Pattern skills** (`pattern-engineer-*`, `pattern-reviewer-*`) check for a per-skill overlay file at load time and treat its contents as additive guidance.
- **`workflow-consolidate-memory`** reads the signal store and proposes edits to the overlay files.

## Where memory lives

All memory lives under `$TMPDIR/claude-memory/<project-slug>/`. The slug is derived from the consuming project's **main working tree** absolute path, so every slice worktree of the same project resolves to the same memory root, and two unrelated projects with the same basename never collide.

To resolve it portably from inside any worktree:

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
PROJECT_SLUG="$(basename "$MAIN_ROOT")-$(printf '%s' "$MAIN_ROOT" | shasum -a 256 | cut -c1-8)"
MEMORY_ROOT="${TMPDIR:-/tmp}/claude-memory/$PROJECT_SLUG"
mkdir -p "$MEMORY_ROOT/signals" "$MEMORY_ROOT/patterns"
```

The directory is **auto-created on first use** — there is no opt-in step. Capture is always on for engineer / reviewer dispatches.

**Persistence caveat.** `$TMPDIR` is best-effort storage:

- On macOS, `$TMPDIR` is per-user under `/var/folders/…/T/` and survives reboots, but the OS periodically purges files untouched for ~3 days.
- On Linux, `/tmp` is typically tmpfs (cleared on reboot) unless the distro persists it.
- In containers / CI sandboxes, the temp dir usually disappears with the container.

Treat memory as a short-horizon evidence buffer. Run `workflow-consolidate-memory` regularly to distill signals into `patterns/<skill>.md` overlays before the underlying signal files age out. If you need durable storage, copy `$MEMORY_ROOT/patterns/` and any signal files you want to keep into version control or a persistent location yourself.

Directory layout:

```
$TMPDIR/claude-memory/<project-slug>/
  signals/
    reviews/<task#>.jsonl          ← findings from a task-level reviewer dispatch
    reviews/slice-<slice#>.jsonl   ← findings from a slice-level reviewer dispatch
    fixes/<task#>.jsonl            ← engineer responses on a task-level fix dispatch
    fixes/slice-<slice#>.jsonl     ← engineer responses on a slice-level fix dispatch
    missed/<slice#>.jsonl          ← findings caught downstream that an earlier stage missed
    cycles/<task#>.json            ← per-task summary written on task review:passed
    cycles/slice-<slice#>.json     ← per-slice summary written on PR merge
    runtime/<session-id>.meta.json ← per-session telemetry metadata (engineer / reviewer only)
    runtime/<session-id>.jsonl     ← per-session tool-call event stream (engineer / reviewer only)
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

## Runtime telemetry signals

A separate signal family captures **per-dispatch operational telemetry** for `engineer` and `reviewer` subagent runs — agent identity, dispatch prompt, every tool call, every skill loaded, token usage, wall-clock duration, and stop reason. This is distinct from the review-evolution signals above: those answer *what did the review find?*, while runtime telemetry answers *how did this dispatch actually execute?*. Consolidation (`workflow-consolidate-memory`) does not consume runtime telemetry — it is for ad-hoc analysis only.

**Scope is intentionally narrow.** Only `engineer` and `reviewer` dispatches emit runtime telemetry. The orchestrator, `doc-writer`, `e2e-author`, `architect`, `product-owner`, and `sre` agents do **not**. The narrowing mechanism is mechanical and described under [Capture mechanism](#capture-mechanism) below: only those two agents run the bootstrap script that registers the session, and the hooks no-op when no session is registered.

### `signals/runtime/<session-id>.meta.json` — per-session metadata

One JSON object per dispatch. Written by `hooks/runtime-telemetry/bootstrap.sh` at session start, mutated incrementally by the PreToolUse hook (`skills_invoked`), and finalized by `hooks/runtime-telemetry/subagent-stop.sh` at session end.

```json
{
  "session_id": "0193f4a8-2c1b-7a3c-9def-deadbeef0001",
  "agent_type": "engineer",
  "agent_name": "harness-claude-code:engineer",
  "dispatch_prompt": "Implement GitHub task issue #142",
  "transcript_path": "",
  "cwd": "/tmp/git-worktree/feature-138-add-receipts",
  "started_at": "2026-05-25T14:32:17Z",
  "ended_at": "2026-05-25T14:58:03Z",
  "duration_ms": 1546000,
  "token_usage": {
    "input_tokens": 12340,
    "output_tokens": 4521,
    "cache_creation_input_tokens": 8200,
    "cache_read_input_tokens": 102000
  },
  "skills_invoked": [
    "operation-git",
    "pattern-engineer-coding-standard",
    "pattern-engineer-python",
    "workflow-engineer-implement-task"
  ],
  "stop_reason": "end_turn"
}
```

Required keys: `session_id`, `agent_type`, `agent_name`, `dispatch_prompt`, `started_at`. The remaining fields are written incrementally: `skills_invoked` accumulates as the agent loads skills; `ended_at`, `duration_ms`, `token_usage`, `stop_reason` are populated on `SubagentStop`.

`agent_type` is exactly one of `engineer` or `reviewer`. `session_id` is taken from the `CLAUDE_SESSION_ID` env var (bootstrap side) and the hook stdin payload's `session_id` (hook side) — both sides MUST agree on the same value or telemetry is not captured.

### `signals/runtime/<session-id>.jsonl` — tool-call event stream

One row per tool invocation, paired by sequence. The PreToolUse hook appends a `tool_use` row when a call starts; the PostToolUse hook appends a `tool_result` row when it ends. The N-th `tool_result` corresponds to the N-th `tool_use` (single-agent calls are serial, so positional pairing is unambiguous).

```json
{"ts": "2026-05-25T14:32:18Z", "event": "tool_use",    "tool": "Bash",  "input_summary": "gh issue view 142 --json title,body,labels", "session_id": "0193f4a8-..."}
{"ts": "2026-05-25T14:32:18Z", "event": "tool_result", "tool": "Bash",  "success": true,                                                "session_id": "0193f4a8-..."}
{"ts": "2026-05-25T14:32:19Z", "event": "tool_use",    "tool": "Read",  "input_summary": "/path/to/skills/operation-git/SKILL.md",     "session_id": "0193f4a8-..."}
{"ts": "2026-05-25T14:32:19Z", "event": "tool_result", "tool": "Read",  "success": true,                                                "session_id": "0193f4a8-..."}
```

Required keys on every row: `ts`, `event`, `tool`, `session_id`. `input_summary` is bounded to ~200 chars and reflects the first identifying argument of the call (command for `Bash`, file path for `Read` / `Edit` / `Write`, pattern for `Grep` / `Glob`, url/query for `WebFetch` / `WebSearch`, skill name for `Skill`, description / subject for `Agent` / `TaskCreate` / `TaskUpdate` / `SendMessage`). `success` is a heuristic derived from the PostToolUse payload's `tool_response.is_error` or `error` field.

### Capture mechanism

Three hook scripts under `hooks/runtime-telemetry/` and one bootstrap script implement the capture. The hooks are wired by the plugin's `hooks/hooks.json`:

| Component | Owner | Trigger | What it writes |
|-----------|-------|---------|----------------|
| `bootstrap.sh` | engineer / reviewer agent first execution step | Agent runs it explicitly | Creates `<session-id>.meta.json` with `agent_type`, `agent_name`, `dispatch_prompt`, `started_at`, `cwd`. **This is the gate** — without this file, the hooks below all no-op. |
| `pre-tool-use.sh` | plugin (PreToolUse hook, no matcher) | Every tool call | Appends `tool_use` row to `<session-id>.jsonl`; also extracts the skill name when the tool is `Read` against `*/skills/*/SKILL.md` or `Skill` with a `skill` parameter, and merges it into `meta.json#skills_invoked` (deduped). |
| `post-tool-use.sh` | plugin (PostToolUse hook, no matcher) | Every tool call | Appends `tool_result` row to `<session-id>.jsonl` with `success`. |
| `subagent-stop.sh` | plugin (SubagentStop hook) | Subagent terminates | Finalizes `meta.json` with `ended_at`, `duration_ms`, `token_usage` (parsed from the last assistant turn in `transcript_path`), and `stop_reason`. |

**Why this design limits capture to engineer + reviewer:**

1. Only `agents/engineer.md` and `agents/reviewer.md` carry the "Telemetry bootstrap" execution step that invokes `bootstrap.sh`.
2. Hooks fire for every tool call across every agent (orchestrator, doc-writer, e2e-author, architect, product-owner, sre) — but the very first thing they do is look up `<session-id>.meta.json`. Without that marker, they exit 0 immediately. So orchestrator and helper agents incur a microsecond of disk lookup per tool call and contribute zero telemetry rows.

**Always-on:** identical to the rest of the memory system. The memory root under `$TMPDIR/claude-memory/<project-slug>/` is auto-created on first use; runtime telemetry starts emitting on the next engineer / reviewer dispatch with no setup step. To clear telemetry for a project, delete the slug directory — it will be re-created on the next dispatch.

**Rotation:** completed session files accumulate forever otherwise. Move `<session-id>.meta.json` + `<session-id>.jsonl` pairs whose `meta.json#ended_at` is older than your chosen retention into `signals/.archive/` on whatever cadence you prefer; nothing in the plugin enforces a schedule.

### Cross-platform requirements

The hook + bootstrap scripts depend on `jq` and `git` being on PATH. `subagent-stop.sh` additionally needs either GNU `date -d` or BSD `date -j -f` for ISO-8601 → epoch conversion (handles both). If any of these is missing, telemetry silently no-ops for that hook — the agent's primary work is never affected.

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

## Always-on

Memory capture is always on for engineer / reviewer dispatches. The memory root under `$TMPDIR/claude-memory/<project-slug>/` is auto-created on first use; signal files and pattern overlays land there without any per-project setup step.

To clear memory for a project, `rm -rf "$TMPDIR/claude-memory/<project-slug>/"` — it will be re-created on the next dispatch. There is no flag or env-var off switch; disabling capture entirely requires removing the bootstrap step from the engineer / reviewer agent definitions in this plugin.

No per-project flags, no settings, no plugin config. The slug derived from the main worktree path is the contract.

## What this skill does NOT do

- Does not write code. Other skills consume this convention; this file is the spec they read.
- Does not get invoked as a workflow. Other skills reference it by name; agents may read it for context but never "execute" it.
- Does not modify baseline pattern skills in this plugin repo. Overlays live only in the consuming project; the upstream baseline ships unchanged.
