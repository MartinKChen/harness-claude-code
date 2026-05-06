---
description: Author a Claude Code subagent under .claude/agents/<name>.md. Walks through naming, model choice, role, and section content, then writes the file.
argument-hint: [optional: agent name or short description]
---

# create-agent

Author a Claude Code subagent as a markdown file under `.claude/agents/<agent-name>.md`. Each agent has YAML frontmatter (name, description, model, optional tools) and a body with a standard set of instruction sections.

## Initial input

The user may have provided a seed (a name or a short description of the agent) in the slash-command arguments: `$ARGUMENTS`. Treat that as the starting point — if it looks like a kebab-case name use it as the agent name, otherwise treat it as a one-line role description and propose a name back to the user. If empty, ask what the agent is for before continuing.

## Required information

Before writing the file, collect these. If the user has already supplied a value (in `$ARGUMENTS` or the conversation), do not re-ask. Otherwise consolidate gaps into one AskUserQuestion call:

1. **Agent name** — kebab-case, becomes the filename (`.claude/agents/<name>.md`) and the `name:` field. If the user gave only a description, propose a name and confirm.
2. **Model** — REQUIRED. Always ask explicitly if not specified. Offer the current options:
   - `opus` — Claude Opus 4.7 (deepest reasoning, slowest, most expensive)
   - `sonnet` — Claude Sonnet 4.6 (balanced default)
   - `haiku` — Claude Haiku 4.5 (fast, cheap, good for narrow tasks)
   - `inherit` — use whatever model the parent conversation is running
3. **One-line description** — what the agent is for. Goes into the `description:` frontmatter field; this is what the dispatcher reads to decide when to delegate.
4. **Tools (optional)** — if omitted, the agent inherits all tools. Ask only if the agent's purpose suggests it should be restricted (e.g. a read-only reviewer should not get Edit/Write).
5. **Whether the agent produces artifacts** — if yes, include a `## Template` section; if no, omit it.

## File location & format

Write to `.claude/agents/<agent-name>.md` in the current project (create the directory if it doesn't exist). Use this exact frontmatter:

```yaml
---
name: <agent-name>
description: <one-line description used by the dispatcher>
model: <opus | sonnet | haiku | inherit>
tools: <comma-separated list>   # OPTIONAL — omit to inherit all tools
---
```

## Standard body sections

Every agent file must contain these sections, in this order, as `##` headings:

### 1. Personality

2–4 sentences describing tone and disposition. Concrete, not generic. Examples: "Skeptical reviewer who assumes the diff is wrong until proven otherwise." / "Patient teacher who explains tradeoffs before recommending."

Avoid empty filler like "helpful and friendly" — every agent is helpful. Say what makes *this* agent distinct.

### 2. Role

What the agent is responsible for and — equally important — what it is NOT responsible for. Two short paragraphs or a "Does / Does not" list. The dispatcher uses the `description:` field to route work; this section tells the agent itself how to scope its replies.

### 3. Best Practices & Principles

A bulleted list of operating rules specific to this role. Examples:
- "Cite file paths with line numbers when referring to code."
- "Never run destructive git commands; suggest them for the user to run."
- "Prefer reading the failing test before reading the implementation."

Aim for 4–8 bullets. Skip generic advice that applies to every agent.

### 4. Available Skills

A markdown table listing skills the agent should consider invoking. Columns:

| Skill | When to invoke |
|-------|----------------|
| `<skill-name>` | <trigger condition> |

Only list skills that genuinely apply. If none apply, write "No specialized skills required for this agent." instead of an empty table. Skills marked Required must be invoked whenever their trigger condition is met; optional skills are at the agent's discretion.

### 5. Workflows

Numbered step-by-step procedures for the agent's main tasks. If the agent has multiple distinct workflows (e.g. "review a PR" vs "review a single file"), give each its own `### <Workflow name>` subsection with its own numbered steps.

Each workflow should bottom out in a concrete deliverable ("post a summary", "write the file", "return a checklist").

### 6. Template (optional)

Include this section ONLY when the agent produces structured artifacts (reports, reviews, plans, specs). Provide a fenced markdown block showing the exact output structure the agent should populate. Omit the section entirely otherwise — do not include an empty placeholder.

## Workflow

1. **Parse the request.** Extract whatever the user already provided in `$ARGUMENTS` and the conversation (name, role, model, tools).
2. **Ask for the rest.** Use one AskUserQuestion call to fill gaps. Always confirm the model — it is required and there is no safe default. If the user just says "you pick", recommend `sonnet` and confirm.
3. **Draft the file in memory.** Fill each section with content tailored to the agent's purpose. Do not ship boilerplate; if a section has nothing meaningful to say for this agent, push back and ask the user for more detail rather than padding.
4. **Create the directory if needed** (`.claude/agents/`) and write the file with Write.
5. **Confirm.** Report the path written and the model chosen, in one or two sentences. Mention how to invoke (the dispatcher will pick up the file automatically; the user can also reference it by name).

## Template

Use this skeleton when drafting the agent file. Replace every `<…>` placeholder; delete the Template section if the agent produces no artifacts.

```markdown
---
name: <agent-name>
description: <one-line description for the dispatcher>
model: <opus | sonnet | haiku | inherit>
---

<2-4 sentences to describe the agent, starts with "You are a ...">

## Personality

<2–4 sentences. Concrete disposition, not generic friendliness.>

## Role

<What this agent owns. What it explicitly does NOT own.>

## Best Practices & Principles

- <rule 1>
- <rule 2>
- <rule 3>
- <rule 4>

## Available Skills

| Skill | When to invoke | Required? |
|-------|----------------|-----------|
| `<skill>` | <trigger> | <Yes/No> |

## Workflows

### <Workflow name>

1. <step>
2. <step>
3. <step>

## Template

​```markdown
<artifact structure the agent fills in>
​```
```
