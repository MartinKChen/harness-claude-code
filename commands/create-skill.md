---
description: Author a Claude Code skill under <skill-name>/SKILL.md. Walks through naming, summary, trigger phrases, and which optional sections apply (workflow, pattern, templates, scripts), then writes SKILL.md and any sibling files under <skill-name>/templates and <skill-name>/scripts.
argument-hint: [optional: skill name or short description]
---

# create-skill

Author a Claude Code skill as a directory containing `SKILL.md` plus optional `templates/` and `scripts/` subdirectories. Each skill has YAML frontmatter (`name`, `description`) and a body composed of a fixed core (summary + when to activate) plus opt-in sections (workflow, pattern, templates pointer, scripts pointer) included only when they apply.

Skills no longer chain into other skills — do not generate a "sub-skill routing" section. Each skill stands on its own; the invoking agent decides which skills to load.

## Initial input

The user may have provided a seed (a name or a short description of the skill) in the slash-command arguments: `$ARGUMENTS`. Treat that as the starting point — if it looks like a kebab-case name use it as the skill name, otherwise treat it as a one-line summary and propose a name back to the user. If empty, ask what the skill is for before continuing.

## Required information

Before writing the files, collect these. If the user already supplied a value (in `$ARGUMENTS` or the conversation), do not re-ask. Otherwise consolidate gaps into one AskUserQuestion call:

1. **Skill name** — kebab-case. Becomes the directory name (`<skill-name>/`) and the `name:` frontmatter field.
2. **Summary** — 1–3 sentences: what the skill does and what problem it solves. Becomes the opening paragraph of the body.
3. **Activation triggers** — verbs, nouns, file types, or phrases that should make the dispatcher reach for this skill. Folded into the `description:` field for auto-invoke and listed under `## When to activate`. The `description:` value MUST stay **under 500 characters** total — pack triggers densely; pick verbs over adjectives; trim prose before you trim trigger words.
4. **Which optional sections apply** — confirm one-by-one whether the skill needs:
   - **Workflow (optional)** — does the skill walk through ordered steps? (Yes → include `## Workflow`.)
   - **Pattern (optional)** — does the skill standardize a coding style or design pattern? (Yes → include `## Pattern`.)
   - **Templates (optional)** — does the skill produce structured artifacts? (Yes → generate each artifact as a sibling file under `<skill-name>/templates/<artifact>.md` and reference it from SKILL.md.)
   - **Scripts (optional)** — does the skill ship shell commands or helper scripts? (Yes → generate each as a sibling file under `<skill-name>/scripts/<name>.sh` (or `.py`, …) and reference it from SKILL.md.)

   Only include sections the user confirms apply. Empty placeholders are forbidden. Do not auto-include any section just because the original draft had one.

## File location & format

Write `<skill-name>/SKILL.md`. Create the `templates/` and `scripts/` subdirectories only when the user confirms those sections apply — do not create empty directories.

Use this exact frontmatter:

```yaml
---
name: <skill-name>
description: "<one-paragraph description that bakes in WHEN to activate — verbs, nouns, file types, example phrases. STRICT: under 500 characters total. The dispatcher reads this for auto-invoke, so be concrete and trigger-rich.>"
---
```

The `description` field is the single most important line in the file — it is what the harness uses to decide auto-invocation. Pack it with concrete trigger words (verbs the user might say, file extensions the skill applies to, example phrases). Generic descriptions like "helps with code" will not auto-invoke reliably. **Stay under 500 characters; trim adjectives before you trim triggers.**

## Standard body sections

Sections appear in this fixed order. Required sections always appear; optional sections appear only when they apply.

### 1. Summary (required)

The first paragraph(s) under the `# <skill-name>` heading. 1–3 sentences explaining what the skill is for and the problem it solves. No heading — it sits directly under the title.

### 2. When to activate (required)

Header: `## When to activate`. A bulleted list of concrete trigger conditions, plus a "Do NOT activate when…" clause. This duplicates intent with the `description:` field but in a longer, more readable form for the model once the skill is loaded.

### 3. Workflow (optional)

Header: `## Workflow`. Include only if the skill walks through ordered steps. Numbered list. Each step should bottom out in a concrete action ("write the file", "ask the user", "run the command"). If the skill has multiple distinct workflows, give each a `### <Workflow name>` subsection with its own numbered steps.

### 4. Pattern (optional)

Header: `## Pattern`. Include only if the skill standardizes a coding style or design pattern. Show the canonical form with a fenced code block, then bullet the rules. Include a "Bad" / "Good" pair when contrast clarifies the rule.

For a `pattern-engineer-X` / `pattern-reviewer-X` pair, the split is **same rules on both sides; engineer gets the imperative, reviewer gets the apparatus**. The engineer skill stacks with up to ~11 others in one dispatch, so each rule is a terse one-liner — no rationale essays, no "warning signs" checklists, no rationalization-rebuttal tables (those are reviewer apparatus). The reviewer skill loads alone (one axis per dispatch), so it carries the detection method (where to look / what to grep), severity calibration, BAD/GOOD pairs, and false-positive guards for the *same* rule set. Never let a rule exist only on the reviewer side — that converts cheap authoring-time prevention into a review-fix round-trip. Coverage *substance* goes in the shared role-neutral `pattern-test-coverage` so it reaches both sides at once.

### 5. Templates (optional)

Header: `## Templates`. Include only if the skill produces structured artifacts. Reference each template by its relative path; do NOT paste the artifact structure inline — the file under `templates/` is the source of truth.

| Template | Purpose |
|----------|---------|
| `templates/<artifact>.md` | <what the artifact is + when to use it> |

Generate each template as a sibling file under `<skill-name>/templates/`. The file contains the actual structure (with `<…>` placeholders); SKILL.md only points at it.

### 6. Scripts (optional)

Header: `## Scripts`. Include only if the skill ships executable helpers. Reference each script by its relative path; document parameters / expected output / failure modes inside the script as header comments, not inline in SKILL.md.

| Script | What it does |
|--------|--------------|
| `scripts/<name>.sh` | <one-line description> |

Generate each script as a sibling file under `<skill-name>/scripts/`. Mark it executable (`chmod +x`).

## Workflow

1. **Parse the request.** Extract whatever the user already provided in `$ARGUMENTS` and the conversation (name, summary, triggers, which optional sections apply, which template / script files).
2. **Ask for the rest.** Use one AskUserQuestion call to fill gaps. At minimum, confirm name, summary, triggers, and which optional sections apply. If the user is vague about triggers, push back — a description without concrete trigger words will not auto-invoke. Confirm the description fits under 500 characters before writing.
3. **Draft the files in memory.** Fill the required sections (summary, when to activate) and only the optional sections the user confirmed. Tailor every line to the specific skill — no boilerplate. For each template / script the user confirmed, draft its sibling file alongside SKILL.md.
4. **Create the directory tree** (`<skill-name>/`, and `<skill-name>/templates/` / `<skill-name>/scripts/` as needed) and write the files with Write. Run `chmod +x` on each generated script.
5. **Confirm.** Report the paths written (SKILL.md, every template, every script) in one or two sentences. Mention that the skill is auto-loaded on next session start and can also be invoked manually as `/<skill-name>`.

## Template

Use this skeleton when drafting SKILL.md. Required sections are unmarked; optional sections are flagged — delete the ones that don't apply rather than shipping empty headers.

```markdown
---
name: <skill-name>
description: "<trigger-rich one-paragraph description for auto-invoke — STRICT: under 500 characters>"
---

# <skill-name>

<1–3 sentence summary of what this skill is for and the problem it solves.>

## When to activate

Activate this skill whenever the user:

- <concrete trigger 1>
- <concrete trigger 2>
- <concrete trigger 3>

Do NOT activate when <out-of-scope condition>.

<!-- OPTIONAL: include only if the skill walks through ordered steps -->
## Workflow

1. <step>
2. <step>
3. <step>

<!-- OPTIONAL: include only if the skill standardizes a pattern -->
## Pattern

​```<lang>
<canonical example>
​```

- <rule 1>
- <rule 2>

<!-- OPTIONAL: include only if the skill produces artifacts under templates/ -->
## Templates

| Template | Purpose |
|----------|---------|
| `templates/<artifact>.md` | <when + why> |

<!-- OPTIONAL: include only if the skill ships executable helpers under scripts/ -->
## Scripts

| Script | What it does |
|--------|--------------|
| `scripts/<name>.sh` | <one-line description> |
```
