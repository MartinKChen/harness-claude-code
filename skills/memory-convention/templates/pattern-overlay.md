# <pattern-skill-name> — project overlay

Generated and maintained by `dream-summary-memory`. Hand-edit if you must,
but prefer letting the dreaming pass propose changes.

## Sharpened triggers
<rule additions that narrow or widen when the baseline rule applies in this project>

## Project-specific carve-outs
<false-positive contexts confirmed across the project's history — rule does NOT apply when ...>

## New rules
<rules discovered from repeated misses that the baseline does not yet cover>

## Examples worth pinning
<BAD/GOOD snippets from this project's own history that make a rule clearer than the baseline's generic examples>

## Hard-gate candidates
<advisory to humans, NOT an agent-consumed rule — does not participate in overlay precedence.
Recurring, mechanically-checkable mistakes that should graduate from a soft overlay rule into the
project's deterministic gate. Each entry names: the tool + exact rule code / config key, the target
config file (pyproject.toml ruff `select`, biome.json, tsconfig.json), and one BAD example from history.
dream-summary records these; a human (or a follow-up engineer task) makes the actual config change in
lockstep with the scaffold template and the matching pattern-engineer-* skill. dream-summary never edits
the gate config itself.>
- e.g. `ruff E711` (`== None` → `is None`) — enable in `[tool.ruff.lint] select`; seen 4× across #123, #131, #140.
