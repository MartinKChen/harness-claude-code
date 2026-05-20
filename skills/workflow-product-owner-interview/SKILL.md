---
name: workflow-product-owner-interview
description: "Drive a depth-first product-requirement discovery interview for a single feature. Walks a one-question-per-turn conversation with a recommendation plus 1–2 alternatives, surfaces unstated assumptions, tracks glossary terms as they appear, classifies the new flow against existing critical paths (extend / supersede / brand new), requests explicit approval (lock requirements), then composes one scoped dispatch prompt for a writer teammate (named by the orchestrator at invocation time) to materialize the artifacts. Writes nothing. Activate on '/workflow-product-owner-interview'."
---

# workflow-product-owner-interview

Drive a depth-first product-requirement discovery interview against a single feature request. Walk a one-question-at-a-time conversation with the user until the feature's user, problem, scope boundaries, success metric, primary critical path, and domain vocabulary are all clarified. Once the user approves and the new flow has been classified against the existing critical paths, the interview is finished — a separate publisher skill materializes the artifacts.

This skill **writes nothing** — no PRD, no critical-path doc, no glossary entry, no `CLAUDE.md` edit, no commit. Classification (step 5) and the approval request (step 6) are bookkeeping in conversation context only; the artifacts themselves are written downstream by `workflow-writer-publish-requirement`.

## When to activate

Activate this skill whenever:

- A new feature/product requirement needs to be clarified before any artifact is written.
- The user types `/workflow-product-owner-interview`, or phrases like 'interview me on this requirement', 'start the product-owner interview', 'walk me through the PRD discovery for <feature>', 'help me clarify what we're actually building'.
- A re-entry: the user wants to extend or revise an in-flight requirement before approval has been given.

Do NOT activate when:

- The user wants to write or commit product artifacts (PRD, critical path, glossary) — that is downstream artifact-publishing work, not interview work.
- The unit of work is architectural design (system shape, ADRs, data model) — different lane.
- The unit of work is a feature task (backend / frontend / e2e) — different lane.
- The initial request is already a precise, well-scoped one-liner and the user has explicitly said "skip the interview, just write it" — in that case, hand directly to the publisher.

## Best practices

- **One question per turn.** Never batch questions. If multiple things are unclear, pick the most blocking one, ask it, wait for the answer, then move on.
- **Always recommend, then offer alternatives.** Each question must include the agent's recommended answer (labeled `(Recommended)`) plus 1–2 viable alternatives where they exist, with a one-line "why I prefer the recommendation" rationale.
- **Do NOT use the AskUserQuestion tool.** Print the question and options as plain text in the conversation. The user is in the loop and will reply directly.
- **No mid-loop summaries.** While interviewing, do not recap what's been said — the user is reading every turn. Save synthesis for the artifacts (which the publisher writes).
- **Surface assumptions.** When the user's answer implies an unstated assumption (about users, scale, edge cases, success metrics), name it and confirm before proceeding.
- **Explore the codebase instead of asking, whenever possible.** If a question can be answered by reading files, running `grep`, checking git history, or otherwise inspecting the repo, do that first. Only ask the user questions that require their judgment, intent, or knowledge that isn't in the code.
- **Walk the design tree depth-first.** Start at the root decision, resolve it, then move to the dependencies that decision unlocks. Don't jump branches until the current one is settled.
- **Resolve dependencies in order.** If decision B depends on decision A, settle A first. Surface the dependency explicitly when it matters ("answering this depends on what we decided about X").
- **Keep going until shared understanding is reached.** Don't stop early. When you think you're done, ask yourself what's still ambiguous, underspecified, or assumed — and grill the user on that too. Stop only when there is nothing meaningful left to clarify.
- **Be concise.** One question, one recommendation, one short rationale. No filler.
- **Track glossary terms as you go.** Whenever the user introduces a new domain term, ambiguous noun, or acronym, note it for the Glossary (the publisher uses these notes) — don't wait until the end.
- **Push back on solution-talk that hasn't been grounded in a real user problem.** Scope expansion needs justification, not enthusiasm. Be comfortable saying "I don't think we should build this yet" if the user-problem story is weak.
- **Stay on the product surface.** Technical concerns (stack choice, data model, infra) belong with the architect, not here. If a question is really an architecture question, defer it.

## Workflow

Inputs from the caller: a feature request from the user (free-form). Everything else (sibling files, prior critical paths, existing glossary, current product-context section of `CLAUDE.md`) you discover yourself.

### 1. Analyze the initial request

Read the user's message carefully. Identify: the intended user/persona, the problem being solved, the proposed solution shape, success criteria, and obvious unknowns. Do not respond with a summary — the user already knows what they wrote.

### 2. Identify the most blocking unknown

Rank the gaps by how much downstream ambiguity they create. Examples of root-level unknowns:

- Who exactly is the user, and what specifically can't they do today?
- What does "success" look like for this feature — what metric or outcome?
- What scope is in, and what's explicitly out?
- Which existing flow (if any) does this touch or replace?

Pick the single highest-leverage question to ask first.

### 3. Ask one question, with recommendation + alternatives

Plain text, not AskUserQuestion. For each question:

- Phrase the question concretely.
- Provide the recommended answer first, labeled `(Recommended)`, with a one-line rationale.
- Provide 1–2 viable alternatives where they exist, each with its own one-line "why not this one" note.
- If the question surfaces an unstated assumption, name the assumption explicitly so the user can confirm or reject it.

### 4. Iterate

After each answer, re-rank remaining unknowns and ask the next single most-blocking question. Continue until both of the following are true:

- The feature's **user, problem, scope boundaries, success metric, and primary critical path** can all be described without making up details.
- The **glossary** has every domain term the user has used.

When the user's answer triggers a need to revisit an earlier decision, name the dependency and re-open the earlier branch — do not silently change a prior settlement.

### 5. Classify the critical path against existing ones

Before requesting approval, list `docs/critical-path/` and read any file whose name, entry point, or steps overlap with the new flow. Decide which case applies — and if it's not obvious from the files alone, ask the user with a recommendation:

- **Extend** — the new requirement adds to an existing critical path. The publisher will edit that file in place and append a History entry.
- **Supersede** — the new requirement replaces an existing critical path (flow rewrite, pivot, deprecated feature). The publisher will write the new file AND delete the superseded one. Name the superseded file in the approval request so the user can object before deletion.
- **Brand new** — no related critical path exists. The publisher will create a new file.

Capture the classification (and, if superseding, the file to be deleted) so the next step can include it in the approval request.

### 6. Request approval to proceed

Once the requirement is clarified and the critical path classified, ask the user — in plain text, not a summary — for explicit approval. Include the critical-path classification and (if superseding) the file to be deleted.

Use phrasing along these lines:

> Ready to generate the PRD, Critical Path (<extend / supersede / brand new>: `<file>`), and Glossary updates. Approve?

Do **NOT** recap the requirement; the user has been in the loop.

If the user does not approve and asks to revisit, treat it as a return to step 4 — re-rank, ask the next single most-blocking question. **Only when the user explicitly approves does the interview proceed to step 7.**

### 7. Compose one scoped dispatch prompt and dispatch the writer

The interview ends here. The PRD, critical-path file, glossary updates, and the optional `CLAUDE.md` product-context update get written by **one writer teammate** named by the orchestrator at invocation time (typically `requirement-writer`, `subagent_type = doc-writer`).

Compose **one dispatch prompt** as plain text. It must include:

- The trigger phrase the writer's routing table will match (use exactly):
  - `Publish product requirement for <feature-name>`
- The proposed kebab-case `<feature-name>` (derived from the feature; normalize spaces / capitals / special chars to kebab-case).
- The working directory of the worktree (the orchestrator will surface this at readiness signal time — leave it as a `{worktree_path}` placeholder until then).
- The **clarified requirement** content (problem from the user's perspective, solution from the user's perspective, the full list of user stories collected during the interview, what's explicitly out of scope, any further notes).
- The **critical-path classification** — `extend` / `supersede` / `brand new` — plus the target file name. If superseding, name the file to be deleted so the writer can drop it.
- The **list of glossary terms** collected during the interview, each with the definition you and the user settled on.
- Whether the **product-context section of `CLAUDE.md`** warrants an update (product pivot, scope expansion, new core user, or shift in success criteria) — and if so, the proposed wording.

**Output and wait.** Surface the dispatch prompt and the proposed `<feature-name>` in the same turn, then stop. The orchestrator will create the milestone + worktree using the proposed name, invite the writer teammate, and message back to confirm it is ready, naming it explicitly (typically `requirement-writer`) and providing the worktree path.

**On readiness signal, send.** When the orchestrator confirms readiness, replace the `{worktree_path}` placeholder with the orchestrator-provided path and send the dispatch prompt to the named writer via `SendMessage(to=<writer-name>)` — otherwise verbatim, do not modify.

**Do not** assume a default name, do not pick a name yourself, do not send to the user. If the orchestrator never confirms readiness, leave the prompt on screen and stop — the orchestrator's flow has stalled and surfacing it is the right response.

The skill **never spawns a new agent** — the orchestrator owns invites; this skill only messages teammates the orchestrator already invited.
