---
name: memory-convention
description: "How agents consume per-project summarized memory: durable improvement overlays at `$MAIN_ROOT/.claude/memory/patterns/<skill>.md`, written by the `dream-summary-memory` pass and loaded additively by every pattern skill. Defines where the overlays live, their file shape, and the precedence rules for applying overlay rules on top of a baseline pattern skill. (Runtime telemetry signals are written and owned entirely by the plugin's `hooks/runtime-telemetry/` scripts — not this skill's concern.)"
---

# memory-convention

Each consuming project grows durable, curated memory from its own review/fix/CI history. This skill defines how agents **consume** that memory: the per-skill overlay files a pattern skill reads at load time and applies on top of its baseline rules.

It is purely descriptive — agents read it for context but never "execute" it, and it never modifies the baseline pattern skills shipped by this plugin.

> Runtime telemetry (per-dispatch timing, tokens, tool calls) is a separate concern, written and owned entirely by the plugin's `hooks/runtime-telemetry/` scripts. The hook scripts are self-documenting; none of it is needed to read memory, so it is out of scope here.

## Where summarized memory lives

```
$MAIN_ROOT/.claude/memory/
  patterns/<pattern-skill-name>.md   ← per-skill improvement overlay, written by dreaming
  dream-log.md                       ← audit trail of dreaming runs (informational)
```

`$MAIN_ROOT` is the consuming project's **main working tree** root, so every slice worktree resolves to the same location:

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
```

The directory is auto-created (by `dream-summary-memory`); it is a gitignored working dir, never committed. Overlays are produced by the `dream-summary-memory` pass — see that skill for how they are generated; the contract for *reading* them is below.

## Overlay file shape

`$MAIN_ROOT/.claude/memory/patterns/<pattern-skill-name>.md` mirrors the structural shape of the baseline pattern skill it overlays. The canonical skeleton is [`templates/pattern-overlay.md`](templates/pattern-overlay.md) — four sections: `## Sharpened triggers`, `## Project-specific carve-outs`, `## New rules`, `## Examples worth pinning`.

Any of the four sections may be empty; only populated sections need exist. Each item under a section is a bulleted rule plus an optional fenced code block for BAD/GOOD examples — the same shape pattern skills use today.

## Overlay precedence

When a pattern skill loads, it reads its own SKILL.md first, then checks `$MAIN_ROOT/.claude/memory/patterns/<this-skill-name>.md`. If present:

1. **Treat overlay rules as additive.** A new rule in the overlay is a new rule the agent must check; a sharpened trigger narrows or widens when an existing rule fires; a carve-out is a documented "do not flag in this context" instruction.
2. **Never silently override.** If an overlay rule contradicts a baseline rule (e.g. baseline says HIGH, overlay says LOW for the same situation), surface the conflict in output rather than picking one. A conflict means dreaming has drifted from baseline and a human needs to reconcile — either by editing the overlay or by sending the rule upstream to the plugin.
3. **Overlay severity cannot exceed baseline severity.** An overlay can downgrade a baseline rule's severity for a specific carve-out (LOW for a documented internal-only API) but cannot upgrade a LOW rule to CRITICAL — that's a new rule, not an overlay.

If the overlay file is absent, the pattern skill proceeds on its baseline alone. Reading memory is always optional and never blocks the agent's primary work.
