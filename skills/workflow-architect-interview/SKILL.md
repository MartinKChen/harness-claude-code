---
name: workflow-architect-interview
description: "Drive a depth-first architectural design interview against a single requirement. Read `docs/product-requirement-document/<feature-name>/requirement.md` and the existing architecture context, walk a one-question-per-turn conversation with a recommendation plus alternatives and a trade-off block, surface unstated assumptions, request approval, partition decisions into ADR IDs, then emit a dispatch prompt for a separate publisher agent. Writes nothing. Activate on '/workflow-architect-interview'."
---

# workflow-architect-interview

Drive a depth-first architectural design interview against a single requirement. Read the requirement and the existing architecture context, then walk a one-question-at-a-time conversation with the user until the system is ship-ready. Once the user approves, partition the settled decisions into ADR identifiers and compose a dispatch prompt for the publisher agent that will materialize the artifacts.

This skill **writes nothing** — no ADRs, no implement-detail doc, no per-entity files, no diagrams, no commits. The final two steps (partitioning decisions into ADR IDs, composing the publisher's dispatch prompt) are bookkeeping in conversation context only; the artifacts themselves are written by a separate publisher agent named by the orchestrator at invocation time.

## When to activate

Activate this skill whenever:

- A requirement file at `docs/product-requirement-document/<feature-name>/requirement.md` needs an architectural design and the design has not yet been settled with the user.
- The user types `/workflow-architect-interview`, or phrases like 'design the architecture for this PRD', 'interview me on the architecture for <feature>', 'start the architect interview', 'walk me through the architecture decisions for this requirement'.
- A re-entry: the user wants to extend or revise an in-flight architectural decision before approval has been given.

Do NOT activate when:

- The user wants to write or commit architecture artifacts (ADRs, implement-detail, data-model, api-contract, C4 diagrams) — that is downstream artifact-publishing work, not interview work.
- The requirement itself is unclear or contested — surface that to the user and stop. Product framing is the product owner's job.
- The unit of work is a feature task (backend / frontend / e2e) — different lane.
- The user asks to scaffold a worktree directly — different lane.

## Best practices

- **One question per turn.** Never batch. If multiple things are unclear, pick the most blocking one, ask it, wait, and move on.
- **Always recommend, then offer 1–2 alternatives.** Each question must include a recommended answer (labeled `(Recommended)`) plus 1–2 viable alternatives where they exist, with a one-line "why I prefer the recommendation" rationale grounded in current scale and constraints.
- **Do NOT use the AskUserQuestion tool.** Print the question and options as plain text in the conversation. The user is in the loop and will reply directly.
- **No mid-loop summaries.** While interviewing, do not recap what's been said — the user has been reading every turn. Save synthesis for whatever downstream flow writes the artifacts.
- **Right-size for now, leave a door for later.** When you reject a layer/service/abstraction, name the trigger that would justify adding it later (e.g. "add a cache when p95 read latency exceeds X", "split this into a service when team B owns it"). The trigger belongs in the ADR's Consequences/Future-triggers section downstream — surface it explicitly during the interview so it isn't lost.
- **Walk the design tree depth-first.** Start at the root decision (sync vs async, monolith vs separate service, SQL vs document store, etc.) and resolve it before drilling into the dependencies it unlocks. Don't jump branches until the current one is settled.
- **Resolve dependencies in order.** If decision B depends on decision A, settle A first. Surface the dependency explicitly when it matters ("this depends on whether we decided X is sync or async").
- **Surface unstated assumptions.** When the user's answer implies an unstated assumption (about traffic, consistency, multi-tenancy, failure tolerance, deployment model), name it and confirm before proceeding.
- **Explore the codebase instead of asking, whenever possible.** Existing stack, services, conventions, and infra are answers, not questions. Read `docs/architecture-decision-record/README.md`, `docs/architecture/`, `package.json` / `go.mod` / equivalents, and obvious entry points before assuming anything.
- **Read the ADR index, not every ADR.** Always read `docs/architecture-decision-record/README.md` first to discover prior decisions. Only open an individual ADR file when the index entry tells you it constrains, conflicts with, or might be superseded by the decision under discussion. Do not bulk-load every ADR upfront — it pollutes context and slows the interview.
- **Stop only when the design is ship-ready.** Data model, API/contract surface, integration points, failure modes, observability hooks, and rollout plan must all be specified or explicitly deferred with a reason.
- **Be concise.** One question, one recommendation, one short rationale. No filler.

## Workflow

Inputs from the caller: a `<feature-name>` (so the requirement file path can be resolved) and the working directory of the worktree the caller already set up. Everything else (sibling files, prior ADRs, existing system shape, dependent decisions) you discover yourself.

### 1. Read the requirement

Read `docs/product-requirement-document/<feature-name>/requirement.md` in full. Then list the sibling files in the same directory and read anything related — critical path, glossary, prior implement-detail if one exists. Do not respond with a summary; the user already knows what's there.

Identify what the system must do, who calls it, what it integrates with, and what's already decided.

### 2. Survey the existing system

Read in this order, stopping as soon as you have enough context:

- `docs/GLOSSARY.md` (if the file exists) — domain vocabulary already locked in by the PRD lane, so questions land using the same terms the user has already settled on.
- `docs/architecture-decision-record/README.md` — the index of prior decisions. **Do not bulk-open ADR files.** Open an individual ADR only when its index summary suggests overlap with the decision under discussion.
- `docs/architecture/` — the existing C4-PlantUML diagrams (context / container / component) that describe the system's current shape. Open whichever level matches the question you are about to ask first.
- Codebase entry points and manifests (`package.json`, `pyproject.toml`, `go.mod`, etc.) for the current stack, services, and shared infra.

Note what already exists vs. what this feature would add, and note any candidates for supersession.

### 3. Identify the most blocking architectural unknown

Rank gaps by how much downstream design they block. Examples of root-level decisions:

- Sync vs async processing.
- Where this feature lives (existing service vs new).
- Data ownership and storage choice.
- Public-vs-internal API surface.

Pick the single highest-leverage question to ask first.

### 4. Ask one question, with recommendation + alternatives

Plain text, not AskUserQuestion. For each architectural question handed to you, produce, at minimum:

**a. High-level architecture sketch** (ASCII or Mermaid) showing modules, seams, and data flow — only when the question is structural enough to need one.

**b. Module responsibilities** — for each module touched, one or two sentences describing what it owns and what it explicitly does *not* own. Keep interfaces narrow and implementations deep; place seams where behaviour actually varies (one adapter ⇒ no seam yet; two adapters ⇒ real seam).

**c. Integration patterns** — how modules communicate across seams (sync vs async, request/response vs event-driven, contracts, retry/idempotency expectations). When the seam is an API endpoint (HTTP, RPC, or event contract), settle the request/response shape, verbs, status codes, auth, and idempotency before moving on.

**d. Trade-off analysis and recommendation.** For every meaningful design choice, document inline:

- **Pros**: Benefits and advantages.
- **Cons**: Drawbacks and limitations.
- **Alternatives**: Other options considered (and *why* they were not chosen — "we didn't pick X because Y").
- **Recommendation**: Final choice and rationale, with the recommended option labeled `(Recommended)`.

**e. Supersession callout (if any).** If your recommendation would supersede one or more existing ADRs, list the IDs explicitly and summarize what changes for the system as a result. Surface this list at approval time so the downstream artifact-publishing flow can mark the index and delete the superseded files.

### 5. Iterate

After each answer, re-rank remaining unknowns and ask the next single most-blocking question. Continue until the design is ship-ready: data model, API/integration surface, failure handling, observability, deploy/rollout, and any deferred-with-trigger items are all settled.

When the user's answer triggers a need to revisit an earlier decision, name the dependency and re-open the earlier branch — do not silently change a prior settlement.

### 6. Request approval to proceed

Once the design is settled, ask the user — in plain text, not as a summary — for explicit approval. Use exactly this phrasing:

> The architecture is settled. Approve?

Do **NOT** recap the design; the user has been in the loop.

If the user does not approve and asks to revisit, treat it as a return to step 5 — re-rank, ask the next single most-blocking question. **Only proceed to step 7 after explicit approval.**

### 7. Partition decisions into ADRs and assign IDs

A feature usually yields **multiple ADRs** — one per coherent decision that could plausibly be superseded on its own (stack, data model, mutation semantics, security, API conventions, module shape, observability, etc.).

Heuristic for partitioning:

- **One ADR per coherent decision, not per feature.** If the supersession story for a future change cannot be captured by replacing one ADR file, the ADR is probably too broad.
- **Greenfield is not a license to consolidate.** It is the moment when granular ADRs are easiest to write because every decision is fresh.
- **Mechanical failure-mode decisions that are direct applications of an earlier decision** should be folded into the relevant ADR rather than spun out as their own record.

Discover the highest existing ADR ID:

```bash
ls docs/architecture-decision-record/ADR-*.md 2>/dev/null | sort | tail -1
```

Assign new IDs sequentially. If `docs/architecture-decision-record/` does not exist or is empty, start at `0001`. IDs are zero-padded 4-digit (e.g. `ADR-0007`).

For each partitioned decision, also pin down which existing ADRs (by ID) it supersedes — the publisher will use that list to mark the index and delete the superseded `.md` files.

This step is **bookkeeping only**; nothing is written to disk.

### 8. Compose 4 scoped dispatch prompts and dispatch the writers

The interview ends here. Architecture artifacts get written by **four writer teammates**, each scoped to one artifact type:

| Writer name | Scope | Owns |
|---|---|---|
| `implement-detail-writer` | `implement-detail` | the feature's `implement-detail.md` |
| `adr-writer` | `adr` | the ADR files, the ADR index, the C4 diagrams, and the optional `CLAUDE.md` architecture-context update |
| `api-contract-writer` | `api-contract` | the OpenAPI 3.1 contracts (shared + per-resource) |
| `data-model-writer` | `data-model` | the ODCS v3.1 data-model files |

Compose **4 separate dispatch prompts** — one per writer — and surface them all in the same turn. Each prompt is plain text and must include:

- The trigger phrase the writer's routing table will match (use exactly):
  - `Publish implement-detail for <feature-name>`
  - `Publish ADRs for <feature-name>`
  - `Publish API contracts for <feature-name>`
  - `Publish data models for <feature-name>`
- The `<feature-name>`.
- The working directory of the worktree.
- The scoped context the writer needs (per the breakdown below). A writer that has nothing to write for its scope (e.g. `api-contract-writer` when the feature exposes no API surface) still gets a dispatch — it must say so explicitly so the writer can no-op cleanly rather than guess.

**Per-writer context:**

`implement-detail-writer` needs:

- An architecture summary (modules, key boundaries, integration points) suitable for the `Architecture` and `Modules` sections of `implement-detail.md`.
- The list of ADR IDs to cross-reference (the ADRs themselves will be written by `adr-writer`; the cross-references resolve once the files land).
- The list of persistence entities (with file names like `<entity>.yaml`) to link from the Data Model section.
- The list of API resources (with file names) to link from the API Surface section.
- Failure modes, observability hooks, rollout plan, any deferred-with-trigger items.

`adr-writer` needs:

- The partitioned decisions from step 7, each tagged with its assigned `ADR-{NNNN}` ID, a one-line title, and a draft body (Context / Decision / Consequences / Alternatives Considered / Date).
- The supersession list — every existing ADR ID whose row should be marked `Superseded` and whose `.md` file should be deleted, paired with the new ADR ID that replaces it.
- Any deferred-with-trigger items so they land in the relevant ADR's Consequences/Future-triggers section.
- Whether the high-level topology shifted, so the writer knows whether to update the architecture-context section of `CLAUDE.md`.
- Which C4 levels need updating (context / container / component) and what changes per level.

`api-contract-writer` needs:

- The list of API resources to write or update (or "no API surface" when the feature exposes none).
- For each resource, the operations (list / read / create / update / delete / custom) and their shapes (verbs, paths, parameters, request/response schemas).
- Whether `_shared.yaml` needs editing (typically only when introducing a genuinely new shared element).

`data-model-writer` needs:

- The list of persistence entities to write or update (or "no persistence changes" when the feature touches none).
- For each entity, the columns (with logical/physical types, nullability, defaults), constraints (with `pk_/fk_/idx_/uq_` prefixes), foreign-key behavior, invariants, and migration notes.

**Output and wait.** Surface all 4 dispatch prompts in the same turn, then stop. The orchestrator will invite the 4 writer teammates and message back to confirm they are ready, naming them with the exact names listed in the table above.

**On readiness signal, send.** When the orchestrator confirms readiness, send each scoped dispatch prompt to its matching writer via `SendMessage(to=<writer-name>)` — verbatim, do not modify. Send all 4 dispatches; do not skip a writer just because its scope is a no-op (the dispatch itself tells the writer to no-op).

**Do not** assume default names, do not pick a name yourself, do not send to the user. If the orchestrator never confirms readiness, leave the 4 prompts on screen and stop — the orchestrator's flow has stalled and surfacing it is the right response.

The skill **never spawns a new agent** — the orchestrator owns invites; this skill only messages teammates the orchestrator already invited.
