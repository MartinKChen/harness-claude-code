---
description: Author a Claude Code subagent under <agent-name>.md. Walks through naming, model choice, role, principles, and how to split invoked skills into always-on vs. conditional pattern/principle vs. conditional workflow. Conditional skills split into two distinct buckets so the agent loads pattern/principle skills based on what surface is touched and a workflow skill based on the dispatch verb. Agents follow a 2-step flow: load skills, then execute the loaded workflow.
argument-hint: [optional: agent name or short description]
---

# create-agent

Author a Claude Code subagent as a markdown file at `<agent-name>.md`. Each agent has YAML frontmatter (name, description, model, optional tools) and a body containing personality, role, best practices, an Available Skills section split into **Always on**, **Conditionally invoked — pattern / principle**, and **Conditionally invoked — workflow**, and a final Execution Flow section that fixes the 2-step contract every agent follows.

The agent body does NOT contain workflows or templates — those live in the skills the agent invokes. Skill workflows / artifacts are loaded on demand from the skill file; duplicating them in the agent is dead weight.

## Initial input

The user may have provided a seed (a name or a short description of the agent) in the slash-command arguments: `$ARGUMENTS`. Treat that as the starting point — if it looks like a kebab-case name use it as the agent name, otherwise treat it as a one-line role description and propose a name back to the user. If empty, ask what the agent is for before continuing.

## Required information

Before writing the file, collect these. If the user has already supplied a value (in `$ARGUMENTS` or the conversation), do not re-ask. Otherwise consolidate gaps into one AskUserQuestion call:

1. **Agent name** — kebab-case, becomes the filename (`<agent-name>.md`) and the `name:` field. If the user gave only a description, propose a name and confirm.
2. **Model** — REQUIRED. Always ask explicitly if not specified. Offer the current options:
   - `opus` — Claude Opus 4.7 (deepest reasoning, slowest, most expensive)
   - `sonnet` — Claude Sonnet 4.6 (balanced default)
   - `haiku` — Claude Haiku 4.5 (fast, cheap, good for narrow tasks)
   - `inherit` — use whatever model the parent conversation is running
3. **One-line description** — what the agent is for. Goes into the `description:` frontmatter field; this is what the dispatcher reads to decide when to delegate.
4. **Tools (optional)** — if omitted, the agent inherits all tools. Ask only if the agent's purpose suggests it should be restricted (e.g. a read-only reviewer should not get Edit/Write).
5. **Which skills the agent invokes**, split into three groups:
   - **Always on** — skills the agent invokes at the start of every dispatch, no matter what the user asked for. (Typical examples: a security guardrail skill, a TDD loop skill, an operation-git skill.) The agent does not decide whether to load these — they always load.
   - **Conditionally invoked — pattern / principle** — pattern or principle skills the agent invokes only when a stated trigger condition on the *touched surface* is met. (Typical examples: a database-pattern skill activated only when migrations land, a docker-pattern skill activated only when Dockerfiles are touched, a frontend pattern only when frontend files are touched.) Multiple may load in a single dispatch — they describe the *standards* the agent must apply to a given surface, and stack additively. For each, capture the trigger condition.
   - **Conditionally invoked — workflow** — workflow skills the agent invokes when a stated trigger condition on the *dispatch verb / unit of work* is met. Exactly one workflow loads per dispatch — the workflow defines the end-to-end procedure for that unit of work. For each, capture the trigger phrase / dispatch shape.

   Reference each skill by its bare name (`<skill-name>`) — never by file path. The generated agent file ships into projects that may not share our skill-folder layout (plugin installs use `.claude/skills/<name>/`, dev source repos may use `skills/<name>/`, etc.), so paths are not portable. Bare names are.

## The 2-step execution contract

Every agent built from this template follows the same fixed flow at runtime:

1. **Load skills.** Read every always-on skill, evaluate every conditional pattern/principle skill's trigger against the touched surface and load the matches, evaluate every conditional workflow skill's trigger against the dispatch verb / unit of work and load the single match.
2. **Execute the loaded workflow.** Run the workflow skill's procedure end-to-end against the loaded pattern/principle context. The pattern/principle skills are *lenses* the agent holds while executing; the workflow skill is the *procedure* the agent runs.

The agent does no work of its own beyond steps 1 and 2. If no workflow skill matches the dispatch, the agent stops and surfaces "no matching workflow" rather than improvising a procedure.

## File location & format

Write to `<agent-name>.md` in the current project. Use this exact frontmatter:

```yaml
---
name: <agent-name>
description: <one-line description used by the dispatcher>
model: <opus | sonnet | haiku | inherit>
tools: <comma-separated list>   # OPTIONAL — omit to inherit all tools
---
```

## Standard body sections

Every agent file must contain these sections, in this order, as `##` headings.

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

Three groupings — **Always on**, **Conditionally invoked — pattern / principle**, and **Conditionally invoked — workflow**. Any may be empty (omit the table entirely in that case), but a non-trivial agent will have at least one entry in *Always on* and one entry under *workflow*.

**Always on**

- `<skill-name>`
- `<skill-name>`

The agent invokes every skill in this list at the start of every dispatch; the agent does not decide whether to invoke, so no per-skill trigger is needed.

**Conditionally invoked — pattern / principle**

| Skill | When to invoke |
|-------|----------------|
| `<skill-name>` | <trigger condition on the touched surface — e.g. "when the change touches Python files", "when migrations land", "when reviewing frontend code"> |

Multiple may load in a single dispatch — they stack additively. The agent reads the touched files / labels / surface and decides which apply.

**Conditionally invoked — workflow**

| Skill | When to invoke |
|-------|----------------|
| `<skill-name>` | <trigger phrase / dispatch shape — e.g. "Dispatch prompt opens with `Implement GitHub task issue #<n>`"> |

Exactly one workflow loads per dispatch. The agent reads the dispatch verb / unit of work and picks the one matching row. If no row matches, the agent stops and surfaces "no matching workflow".

**Reference skills by bare name only.** Never include a path like `.claude/skills/<skill>/SKILL.md` or `skills/<skill>/SKILL.md` — paths vary across project layouts (plugin installs vs. dev source) and break portability. The harness resolves bare names against whatever skill structure the host project uses.

### 5. Execution Flow

A fixed, two-step block that closes every agent file. Do not customize beyond filling the placeholders the template surfaces.

```markdown
1. **Load skills.**
   - Read every skill listed under **Always on**.
   - For each row in **Conditionally invoked — pattern / principle**, evaluate the trigger against the touched surface (files, labels, language, framework) and load it if the trigger matches. Multiple may load.
   - For each row in **Conditionally invoked — workflow**, evaluate the trigger against the dispatch verb / unit of work and load the single match. If no row matches, stop and surface "no matching workflow for this dispatch".
2. **Execute the loaded workflow.** Run the workflow skill's procedure end-to-end. Hold the loaded pattern/principle skills as the lens that shapes every decision inside the procedure.
```

The agent body stops here. Workflows and templates the agent might call upon belong inside the invoked skills, not in the agent file.

## Workflow

1. **Parse the request.** Extract whatever the user already provided in `$ARGUMENTS` and the conversation (name, role, model, tools, the always-on, conditional pattern/principle, and conditional workflow skill lists).
2. **Ask for the rest.** Use one AskUserQuestion call to fill gaps. Always confirm the model — it is required and there is no safe default. If the user just says "you pick", recommend `sonnet` and confirm. Confirm the three-way split for each invoked skill (always-on vs. conditional pattern/principle vs. conditional workflow), and the trigger for each conditional skill.
3. **Draft the file in memory.** Fill each section with content tailored to the agent's purpose. Do not ship boilerplate; if a section has nothing meaningful to say for this agent, push back and ask the user for more detail rather than padding. Reference skills by bare name only — no paths. Always emit the **Execution Flow** section verbatim from the template.
4. **Write the file** with Write at `<agent-name>.md`.
5. **Confirm.** Report the path written and the model chosen, in one or two sentences. Mention how to invoke (the dispatcher will pick up the file automatically; the user can also reference it by name).

## Template

Use this skeleton when drafting the agent file. Replace every `<…>` placeholder; omit a whole table when there are no rows for that grouping. Always emit the **Execution Flow** section verbatim — it is the contract every agent shares.

```markdown
---
name: <agent-name>
description: <one-line description for the dispatcher>
model: <opus | sonnet | haiku | inherit>
---

<2–4 sentences to describe the agent, starts with "You are a ...">

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

**Always on**

- `<skill>`
- `<skill>`

**Conditionally invoked — pattern / principle**

| Skill | When to invoke |
|-------|----------------|
| `<skill>` | <trigger condition on the touched surface> |

**Conditionally invoked — workflow**

| Skill | When to invoke |
|-------|----------------|
| `<skill>` | <trigger phrase / dispatch shape> |

## Execution Flow

1. **Load skills.**
   - Read every skill listed under **Always on**.
   - For each row in **Conditionally invoked — pattern / principle**, evaluate the trigger against the touched surface (files, labels, language, framework) and load it if the trigger matches. Multiple may load.
   - For each row in **Conditionally invoked — workflow**, evaluate the trigger against the dispatch verb / unit of work and load the single match. If no row matches, stop and surface "no matching workflow for this dispatch".
2. **Execute the loaded workflow.** Run the workflow skill's procedure end-to-end. Hold the loaded pattern/principle skills as the lens that shapes every decision inside the procedure.
```
