---
description: Author a Claude Code skill under .claude/skills/<name>/SKILL.md. Walks through naming, summary, trigger phrases, and which optional sections apply, then writes SKILL.md.
argument-hint: [optional: skill name or short description]
---

# create-skill

Author a Claude Code skill as a markdown file under `.claude/skills/<skill-name>/SKILL.md`. Each skill has YAML frontmatter (`name`, `description`) and a body composed of a fixed core (summary + when to activate) plus opt-in sections (sub-skill routing, workflow, pattern, template, command) included only when they apply.

## Initial input

The user may have provided a seed (a name or a short description of the skill) in the slash-command arguments: `$ARGUMENTS`. Treat that as the starting point — if it looks like a kebab-case name use it as the skill name, otherwise treat it as a one-line summary and propose a name back to the user. If empty, ask what the skill is for before continuing.

## Required information

Before writing the file, collect these. If the user already supplied a value (in `$ARGUMENTS` or the conversation), do not re-ask. Otherwise consolidate gaps into one AskUserQuestion call:

1. **Skill name** — kebab-case, becomes the directory name (`.claude/skills/<name>/`) and the `name:` frontmatter field.
2. **Summary** — 1–3 sentences: what the skill does and what problem it solves. Becomes the opening paragraph of the body.
3. **Activation triggers** — verbs, nouns, file types, or phrases that should make the dispatcher reach for this skill. Folded into the `description:` field for auto-invoke and listed under `## When to activate`.
4. **Which optional sections apply** — confirm one-by-one whether the skill needs:
   - **Sub-skill routing** — does this skill delegate to other skills? (Yes → include `## Sub-skill routing`)
   - **Workflow** — does the skill walk through ordered steps? (Yes → include `## Workflow`)
   - **Pattern** — does the skill standardize a coding style or design pattern? (Yes → include `## Pattern`)
   - **Template** — does the skill produce structured artifacts? (Yes → include `## Template`)
   - **Command** — does the skill expose CLI interaction or run shell commands? (Yes → include `## Command`)

   Only include sections the user confirms apply. Empty placeholders are forbidden.

## File location & format

Write to `.claude/skills/<skill-name>/SKILL.md` in the current project. Create the directory if it doesn't exist. Use this exact frontmatter:

```yaml
---
name: <skill-name>
description: "<one-paragraph description that bakes in WHEN to activate — verbs, nouns, file types, example phrases. The dispatcher reads this for auto-invoke, so be concrete and trigger-rich.>"
---
```

The `description` field is the single most important line in the file — it is what the harness uses to decide auto-invocation. Pack it with concrete trigger words (verbs the user might say, file extensions the skill applies to, example phrases). Generic descriptions like "helps with code" will not auto-invoke reliably.

## Standard body sections

Sections appear in this fixed order. Required sections always appear; optional sections appear only when they apply.

### 1. Summary (required)

The first paragraph(s) under the `# <skill-name>` heading. 1–3 sentences explaining what the skill is for and the problem it solves. No heading — it sits directly under the title.

### 2. When to activate (required)

Header: `## When to activate`. A bulleted list of concrete trigger conditions, plus a "Do NOT activate when…" clause. This duplicates intent with the `description:` field but in a longer, more readable form for the model itself once the skill is loaded.

### 3. Sub-skill routing (optional)

Header: `## Sub-skill routing`. Include only if this skill delegates to other skills. Use a table:

| Sub-skill | When to route to it |
|-----------|---------------------|
| `<skill-name>` | <trigger> |

### 4. Workflow (optional)

Header: `## Workflow`. Include only if the skill walks through ordered steps. Numbered list. Each step should bottom out in a concrete action ("write the file", "ask the user", "run the command"). If the skill has multiple distinct workflows, give each a `### <Workflow name>` subsection with its own numbered steps.

### 5. Pattern (optional)

Header: `## Pattern`. Include only if the skill standardizes a coding style or design pattern. Show the canonical form with a fenced code block, then bullet the rules. Include a "Bad" / "Good" pair when contrast clarifies the rule.

### 6. Template (optional)

Header: `## Template`. Include only if the skill produces structured artifacts (reports, configs, file scaffolds). Provide a fenced code block with the exact structure to populate. Use `<…>` placeholders.

### 7. Command (optional)

Header: `## Command`. Include only if the skill involves CLI interaction. Document each command in its own subsection: the exact invocation, what it does, expected output, and common failure modes. Mention any required permissions.

## Workflow

1. **Parse the request.** Extract whatever the user already provided in `$ARGUMENTS` and the conversation (name, summary, triggers, which sections apply).
2. **Ask for the rest.** Use one AskUserQuestion call to fill gaps. At minimum, confirm name, summary, triggers, and which optional sections apply. If the user is vague about triggers, push back — a description without concrete trigger words will not auto-invoke.
3. **Draft the file in memory.** Fill the required sections (summary, when to activate) and only the optional sections the user confirmed. Tailor every line to the specific skill — no boilerplate. If a section has nothing meaningful to say, omit it instead of padding.
4. **Create the directory** (`.claude/skills/<skill-name>/`) and write `SKILL.md` with Write.
5. **Confirm.** Report the path written and which optional sections were included, in one or two sentences. Mention that the skill is auto-loaded on next session start and can also be invoked manually as `/<skill-name>`.

## Template

Use this skeleton when drafting the SKILL.md. Required sections are unmarked; optional sections are flagged — delete the ones that don't apply rather than shipping empty headers.

```markdown
---
name: <skill-name>
description: "<trigger-rich one-paragraph description for auto-invoke>"
---

# <skill-name>

<1–3 sentence summary of what this skill is for and the problem it solves.>

## When to activate

Activate this skill whenever the user:

- <concrete trigger 1>
- <concrete trigger 2>
- <concrete trigger 3>

Do NOT activate when <out-of-scope condition>.

<!-- OPTIONAL: include only if the skill delegates to other skills -->
## Sub-skill routing

| Sub-skill | When to route to it |
|-----------|---------------------|
| `<skill>` | <trigger> |

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

<!-- OPTIONAL: include only if the skill produces artifacts -->
## Template

​```<lang>
<artifact structure to populate>
​```

<!-- OPTIONAL: include only if the skill involves CLI interaction -->
## Command

### `<command name>`

<exact invocation, what it does, expected output, failure modes>
```
