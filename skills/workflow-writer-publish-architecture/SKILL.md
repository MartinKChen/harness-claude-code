---
name: workflow-writer-publish-architecture
description: "Materialize and commit every artifact for an approved architectural design: ADRs under `docs/architecture-decision-record/`, the feature's `implement-detail.md`, C4 diagrams under `docs/architecture/`, OpenAPI 3.1 contracts under `docs/api-contract/`, ODCS v3.1 data models under `docs/data-model/`, and runbooks under `docs/runbooks/{ops,dev}/`. Commits on the current branch; no PR, no scaffold. Activate on '/workflow-writer-publish-architecture'."
---

# workflow-writer-publish-architecture

Materialize every output of an approved architectural design and commit them on the current branch. Owns: ADRs, the ADR index, the feature's implementation-detail doc, the C4-PlantUML diagrams, per-resource OpenAPI 3.1 contracts, per-entity ODCS v3.1 data models, the durable operational runbooks, the optional `CLAUDE.md` architecture-context update, and the inline commit on the current branch.

This skill **assumes the design is already settled and approved** with the user. It does not run a design interview, does not push, does not open a PR, and does not run any scaffold gate.

### The two-tier doc model this skill enforces

Artifacts split into two tiers, and this skill is where the split is enforced:

- **Transient build inputs** — only **`implement-detail.md` is feature-bounded**. Its entire job is to feed `create-feature-issues`; once that feature's issues exist, `create-feature-issues` archives it out of the live tree (see that skill's archive step). Nothing re-reads a shipped feature's `implement-detail.md` as a load-bearing input.
- **Durable contracts** — ADRs, C4 diagrams, API contracts, data models, **and runbooks** all live at the repo level under `docs/` and are read live across every feature. They survive archiving.

Two rules fall out of this split, both enforced here:

1. **Runbooks are durable, never transient.** Operational procedures go to `docs/runbooks/{ops,dev}/` (or the runbooks root for both-audience), **never** buried inside `implement-detail.md`. If you are asked to write a runbook-shaped section into `implement-detail.md`, **warn and redirect** it to `docs/runbooks/` (see step 2).
2. **Dependency direction is strictly one-way.** A canonical fact (a constraint, table, rule, state machine, rate-limit budget) has **exactly one home, in the durable tier**. `implement-detail.md` may point *up* at a durable home; **no durable artifact may point *down* into `requirement.md` or `implement-detail.md`** for the substance of a canonical fact. Materialize every canonical fact in its durable artifact, then let `implement-detail.md` link up to it. This is what makes `implement-detail.md` always-safe to archive — see step 2's self-containment check.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Publish architecture artifacts for <feature-name>` and the conversation history (or a referenced design note) already carries a settled, approved design.
- The user has explicitly approved a settled design in this conversation and asks to write it out.
- The user types `/workflow-writer-publish-architecture`, or phrases like 'generate the ADRs and implement-detail for this design', 'write the architecture artifacts', 'commit the architecture decisions we just settled'.

Do NOT activate when:

- The design is not yet settled — stop and surface that the design needs to be settled first; do not begin generating artifacts from a half-formed design.
- The user wants to revisit a decision — stop and surface that the design needs to change first.
- The unit of work is product framing (PRD, critical path, glossary) — that is the product owner's job.
- The user asks to open a PR — that is the orchestrator's job. This skill commits only.

## Workflow

Inputs from the dispatching orchestrator: a `<feature-name>`, the **trigger phrase** that selects your scope (see the **Scope** section below), and the **working directory** of the worktree on the feature branch. The substantive content (partitioned ADR decisions, supersession list, C4 changes, API specs, data-model specs, deferred-with-trigger items, whether `CLAUDE.md` topology section warrants an update) is **not** in the dispatch prompt — you pull it from `architect` in step 1. ADR partitioning and ID assignment happen upstream in `architect`'s interview — do **not** re-partition or re-number here.

Everything else (sibling PRD files, current `CLAUDE.md` shape, existing diagrams / contracts / data-model on disk that may need editing in place) you read from disk.

### Scope

This skill is **scope-aware**. The dispatch prompt's trigger phrase selects which subset of artifacts to write. Recognized scopes:

| Trigger phrase | Scope | Artifacts |
|---|---|---|
| `Publish implement-detail for <feature-name>` | `implement-detail` | `docs/product-requirement-document/<feature-name>/implement-detail.md` only |
| `Publish ADRs for <feature-name>` | `adr` | ADR files + ADR index + C4 diagrams + optional `CLAUDE.md` architecture-context update |
| `Publish API contracts for <feature-name>` | `api-contract` | `docs/api-contract/_shared.yaml` (when missing) + per-resource `docs/api-contract/<entity>.yaml` |
| `Publish data models for <feature-name>` | `data-model` | per-entity `docs/data-model/<entity>.yaml` |
| `Publish runbooks for <feature-name>` | `runbooks` | durable runbooks under `docs/runbooks/{ops,dev}/` (or runbooks root for both-audience) |
| `Publish architecture lockin for <feature-name>` | `all` (legacy full-scope) | every artifact above, in a single batched commit |

In step 2, run only the artifact sub-block(s) that match the dispatched scope; skip the rest. In step 4, use the scope-appropriate Conventional Commits subject (template list lives in that step).

If the dispatched scope has nothing to write (e.g. `api-contract` scope dispatched but the feature exposes no API surface), do not write or commit anything — proceed to step 5 and report "scope no-op" with the reason. `architect`'s reply in step 1 is what tells you whether your scope is a no-op.

### 1. Request artifact-publishing info from `architect`

The `architect` agent ran the design interview and composed the per-scope artifact-publishing payloads in the final step of `workflow-architect-interview`. It is waiting on the team for your request — it will not send the payload unsolicited.

Send a `SendMessage(to=architect)` with:

- An identifying line stating who you are (`implement-detail-writer`, `adr-writer`, `api-contract-writer`, `data-model-writer`, or `runbook-writer`) and which scope you cover.
- The `<feature-name>` and your `<worktree_path>` so `architect` can resolve any `{worktree_path}` placeholder in its composed prompt.
- An explicit ask for the scope-appropriate artifact-publishing info:
  - `implement-detail-writer` — architecture summary (modules, key boundaries, integration points), list of ADR IDs to cross-reference, list of persistence entities and API resources to link, failure modes, observability hooks, rollout plan, deferred-with-trigger items.
  - `adr-writer` — the partitioned decisions each tagged with its assigned `ADR-{NNNN}` ID, draft Context / Decision / Consequences / Alternatives / Date bodies, the supersession list (existing ADR IDs each new ADR replaces), deferred-with-trigger items, whether `CLAUDE.md` architecture-context needs updating, and which C4 levels (context / container / component) need changes and what changes per level.
  - `api-contract-writer` — list of API resources to write or update (or "no API surface" if none), and for each resource the operations and their shapes (verbs, paths, parameters, request/response schemas). Whether `_shared.yaml` needs editing.
  - `data-model-writer` — list of persistence entities to write or update (or "no persistence changes" if none), and for each entity the columns, constraints, foreign-key behavior, invariants, and migration notes.
  - `runbook-writer` — list of durable operational procedures to write or update (or "no runbooks" if none), and for each: its audience (`ops` / `dev` / both), the trigger, prerequisites, the ordered steps, the verification signal, and rollback. Plus the durable artifacts (ADR / data-model / api-contract IDs) each runbook should link *up* to.

Wait for `architect`'s reply. If `architect` does not respond, or responds with anything other than the structured scope-appropriate payload, STOP and surface the gap — do not improvise content. If `architect`'s reply explicitly says your scope is a no-op, record the reason for step 5 and skip step 2 + step 4 entirely. If a piece of context is unclear once the payload arrives, send a follow-up `SendMessage(to=architect)` for clarification before generating artifacts.

### 2. Generate artifacts

Write, update, or delete each of the following. Create parent directories as needed. Each sub-block is annotated with the scope(s) that include it — run a sub-block only when its scope tag matches the dispatched scope (or when scope is `all`).

Read each template from this skill's `templates/` directory (see the **Templates** section below for the full table). Then for each artifact:

For each new ADR (`docs/architecture-decision-record/ADR-{NNNN}.md`) — **scope: `adr`, `all`**:

- Start from `templates/adr.md`.
- Title each after its decision, **not** the feature.
- Name superseded ADR IDs in the Context section.
- Cross-reference sibling ADRs in the same feature where they constrain or inform each other.

For the ADR index (`docs/architecture-decision-record/README.md`) — **scope: `adr`, `all`**:

- **Always update.** Add a row for each new ADR. For each superseded ADR, fill its `Superseded by` column with the new ID, then **delete that ADR's `.md` file** from `docs/architecture-decision-record/` — a superseded decision should not linger as a half-truth; the README is its tombstone.
- Create the README from `templates/adr-index.md` if it does not yet exist.

For the stack manifest (`docs/stack.yaml`) — **scope: `adr`, `all`**:

- **Only touch when this feature's ADR set decides or changes the stack** — backend/frontend language, framework, rendering mode (CSR vs SSR), or the compose service topology. A feature whose ADRs leave the stack untouched leaves this file alone (the common case after the first lock-in).
- Start from `templates/stack-manifest.yaml` when the file doesn't exist; otherwise edit the affected fields in place.
- This is the **machine-readable mirror** of the ADRs' stack decision — consumed by engineer/reviewer pattern selection, the workflows' review-surface classifiers, the engineer pre-push hook, and `/scaffold-project`. It is derived, never decisive: every field traces to an ADR ID (cite it in the header comment), and it never introduces a choice an ADR didn't make.

For the implement-detail doc (`docs/product-requirement-document/{feature-name}/implement-detail.md`) — **scope: `implement-detail`, `all`**:

- Start from `templates/implement-detail.md`.
- `{feature-name}` matches the directory the requirement lives in.
- **This is the only feature-bounded (transient) architecture artifact**, and it gets archived once `create-feature-issues` slices the feature. Keep it to **build explanation only** — architecture rationale, the module/file-tree shape, repo layout, why-this-was-built reasoning. Cross-reference each ADR by ID rather than re-arguing the decision. Cross-reference the C4 diagrams under `docs/architecture/`, the per-resource OpenAPI files under `docs/api-contract/`, the per-entity ODCS files under `docs/data-model/`, and the runbooks under `docs/runbooks/` instead of duplicating their content.
- **Never the sole home of a canonical fact.** A constraint, table, integrity rule, state machine, or rate-limit budget must be **materialized in its durable artifact** (ADR / data-model / api-contract) and merely *linked up to* from here. If you find yourself writing the authoritative definition of such a fact into `implement-detail.md`, stop: it belongs in (or needs a freshly minted) durable artifact. Once that exists, leave a pointer here. This keeps `implement-detail.md` safe to archive — archiving it must never delete canon.
- **Warn and redirect runbook content.** If the payload hands you a section that is actually an operational procedure (enable prod, deploy, roll back, swap a provider, local-dev setup, a common dev task), do **not** write it into `implement-detail.md`. Surface a one-line warning ("`<section>` reads as a runbook — durable, not feature-bounded; routing it to `docs/runbooks/`") and emit it under the `runbooks` artifact block instead (it lands in the same commit when scope is `all`; under a single-scope dispatch, note it for the `runbook-writer`). Leave at most a pointer stub in `implement-detail.md`.

For the C4-PlantUML architecture diagrams (`docs/architecture/*.puml`) — **scope: `adr`, `all`**:

- These describe the **repo-wide** architecture, not a per-feature view. Open the existing files first; if a diagram already covers the area this design touches, **edit it in place** rather than starting a new file.
- Decide which C4 levels this design warrants:
  - **Context** (`templates/c4-context.puml`) → `docs/architecture/c4-context.puml`. Update only when the design changes who interacts with the system or which external systems it depends on.
  - **Container** (`templates/c4-container.puml`) → `docs/architecture/c4-container.puml`. Maintain whenever the system has more than one deployable unit.
  - **Component** (`templates/c4-component.puml`) → `docs/architecture/c4-component-<container>.puml`. One file per container whose internal modules need diagramming.
- Create the `docs/architecture/` directory if it does not exist.

For the API surface (`docs/api-contract/`) — **scope: `api-contract`, `all`**:

The surface is split into a **shared components file** plus **one file per resource**, all at the repo level. The split keeps the auth scheme, common error responses, pagination / idempotency / concurrency parameters, and the canonical `Error` schema defined once — and lets each resource file stay slim.

- **Shared components** — `docs/api-contract/_shared.yaml`. Start from `templates/api-contract-shared.yaml` (OpenAPI 3.1 fragment). One file repo-wide. If the file already exists, **reuse it as-is** and only edit when introducing a genuinely new shared element. Do not duplicate it across resources.
- **Per-resource files** — `docs/api-contract/{entity}.yaml`. **One file per resource.** Start from `templates/api-contract.yaml` (OpenAPI 3.1). Group every operation for that resource (list / read / create / update / delete / custom) under `paths:`. Reference shared components via `$ref: "./_shared.yaml#/components/<bucket>/<name>"`. Keep resource-specific schemas (e.g. `<Resource>`, `<Resource>Create`, `<Resource>List`) under this file's `components.schemas` — promote one into `_shared.yaml` only when a second resource starts depending on it.
- Name each resource file after the resource (e.g. `user.yaml`, `session.yaml`).
- If the design adds operations to an **existing** resource, **edit the existing file in place** by appending the operation block to its `paths:`. New resources only get new files.
- Validation: lint/validate the **bundled** spec (e.g. `redocly bundle docs/api-contract/*.yaml`), not each fragment in isolation — the `bearerAuth` name in `security:` only resolves after bundling.

For each persistence entity (`docs/data-model/{entity}.yaml`) — **scope: `data-model`, `all`**:

- One file per entity (table, collection, or aggregate root) at the **repo level**, not per-feature.
- Start from `templates/data-model.yaml` (Open Data Contract Standard v3.1).
- Name the file after the entity in the casing the codebase uses (e.g. `user.yaml`, `order_item.yaml`).
- If the design adds columns or constraints to an **existing** entity, **edit the existing file in place** rather than spawning a new file. New entities only get new files.
- Conventions: code-first modeling (models are the source of truth, migrations are generated from them — never the reverse), plural `physicalName`, descriptive column names, `pk/fk/idx/uq/vw` constraint prefixes inside the `constraints` block.

For each durable operational runbook (`docs/runbooks/{ops,dev}/<procedure>.md`, or `docs/runbooks/<procedure>.md` for both-audience) — **scope: `runbooks`, `all`**:

- Start from `templates/runbook.md`.
- **The directory is the audience signal** — `ops/` for SRE / release operators, `dev/` for engineers and dev-facing agents, the runbooks root for a both-audience procedure. There is no `audience:` frontmatter tag; nothing routes on one. Create `docs/runbooks/`, `docs/runbooks/ops/`, and `docs/runbooks/dev/` as needed.
- One file per procedure. If a runbook for this procedure already exists, **edit it in place** rather than spawning a duplicate.
- A runbook is a procedure executed *after* the feature ships and is feature-agnostic in spirit (enable prod, deploy, roll back, swap a provider, local-dev setup, a common dev task). Build explanation ("why we built it this way") is **not** a runbook — it stays in `implement-detail.md`. Project-wide standards (e.g. logging conventions) are neither — they belong with the relevant `pattern-*` skill or an ADR.
- Each runbook links *up* to the durable artifacts that define the canonical facts it touches (ADR / data-model / api-contract). It must **never** reference a feature's `requirement.md` / `implement-detail.md` — those are transient and get archived.

**Durable self-containment check (scopes `adr`, `api-contract`, `data-model`, `runbooks`, `all`).** Before committing any durable artifact, scan its body for a reference to `requirement.md` or `implement-detail.md` as the *source* of a canonical definition (a constraint, table, rule, state machine, rate-limit budget — phrasings like "see implement-detail §N for the rules", "described in requirement.md"). If you find one, the canon is in the wrong tier:

- **Materialize the fact here**, in this durable artifact (inline the rule/table into the ADR, define the constraint in the data-model YAML, spell the policy out in `_shared.yaml`).
- If the fact has **no natural durable home today**, that is a signal to **mint one** (e.g. a new `ADR-{NNNN}` for a state machine that currently only lives as an enum) — surface this to the user rather than leaving canon in the transient tier.
- A durable artifact may cross-reference *another durable artifact*; it may **never** cite the PRD pair for substance. Cross-references *up* from `implement-detail.md` to a durable artifact are the correct direction and are fine.

For `CLAUDE.md` — **scope: `adr`, `all`**:

- **Only update if** the design adds a service, datastore, external dependency, or otherwise shifts the high-level topology.
- Start from `templates/claude-md-architecture-context.md` for the section shape, then edit `CLAUDE.md`'s architecture-context section in place; **do not** append a per-feature changelog.
- Goal: a new agent reading this should know the system's shape at a glance.

### 3. Hand artifacts back for iteration

Tell the user which files were written, which were deleted (superseded ADRs), and whether `docs/architecture-decision-record/README.md`, `docs/stack.yaml`, and `CLAUDE.md` were updated. Then ask whether to iterate or confirm.

Do **NOT** summarize the contents — the user can read the files.

If the user asks to iterate, treat each request as a localized rewrite of the affected file(s). If the user's edit invalidates a settled decision (i.e. is a *design* change, not a wording or formatting fix), STOP and surface that the design itself needs to change first — do not silently re-litigate the architecture inside this skill.

### 4. On confirmation, commit on the current branch with inline `git`

Do **NOT** create a new branch, do **NOT** push, do **NOT** open a PR.

The caller has already created and checked out the feature branch (typically inside a worktree) before handing control to you — your job is just to stage and commit.

Run, in the working directory you were briefed with:

```bash
git add <changed-and-deleted-files>      # include any deleted superseded ADR .md files
git commit -m "<scope-appropriate subject>"
```

Use the Conventional Commits subject that matches the dispatched scope:

| Scope | Commit subject template |
|---|---|
| `implement-detail` | `docs(prd): <feature-name> implement-detail` |
| `adr` (single ADR) | `docs(adr): ADR-{NNNN} <short decision title>` |
| `adr` (multiple ADRs from one feature) | `docs(adr): ADR-{NNNN}..{MMMM} <feature-name> architecture` |
| `api-contract` | `docs(api): <feature-name> api contracts` |
| `data-model` | `docs(data): <feature-name> data models` |
| `runbooks` | `docs(runbooks): <feature-name> operational runbooks` |
| `all` (legacy full-scope) | `docs(adr): ADR-{NNNN}..{MMMM} <feature-name> architecture` |

Capture the commit hash — step 5 reports it.

If the dispatched scope had nothing to write (the "scope no-op" case flagged in the **Scope** section above), skip the `git` calls and proceed to step 5.

### 5. Report final status

One or two sentences. Include:

- The commit hash.
- The artifact paths written (and deleted — superseded ADRs).

Do **NOT** summarize the design — the artifacts are on disk and the user can read them.

## Templates

Each artifact has a template under `templates/` in this skill's directory. Copy the template, replace every `<…>` / `{…}` placeholder, and delete sections that genuinely don't apply rather than leaving them blank.

| Asset | Target path on disk | Purpose |
|-------|---------------------|---------|
| `templates/adr.md` | `docs/architecture-decision-record/ADR-{NNNN}.md` | One file per coherent decision. Title each after its decision, not the feature. Name superseded ADR IDs in the Context section. Cross-reference sibling ADRs by ID where they constrain or inform each other. |
| `templates/adr-index.md` | `docs/architecture-decision-record/README.md` | The canonical index of accepted ADRs. **Always update.** Add a row per new ADR. For each superseded ADR, change its `Status` to `Superseded`, fill its `Superseded by` column with the new ID, and delete the superseded `.md` file. IDs are immutable; rows sort ascending by ADR ID; append new rows at the bottom. |
| `templates/stack-manifest.yaml` | `docs/stack.yaml` | Machine-readable mirror of the ADRs' stack decision (backend/frontend language + framework, rendering mode, compose services), consumed by pattern selection, review-surface classification, the pre-push hook, and `/scaffold-project`. **Only touch when this feature's ADRs decide or change the stack.** Derived, never decisive — every field traces to an ADR ID cited in the header comment. |
| `templates/implement-detail.md` | `docs/product-requirement-document/{feature-name}/implement-detail.md` | The **only** feature-bounded (transient) architecture artifact — archived by `create-feature-issues` once the feature is sliced. Build explanation only. Companion to the feature's `requirement.md`. Cross-reference each ADR by ID, the C4 diagrams under `docs/architecture/`, the OpenAPI files under `docs/api-contract/`, the ODCS files under `docs/data-model/`, and the runbooks under `docs/runbooks/` rather than inlining their content. Never the sole home of a canonical fact. |
| `templates/c4-context.puml` | `docs/architecture/c4-context.puml` | C4-PlantUML system-context diagram (level 1). Repo-wide. Update only when the design changes who interacts with the system or which external systems it depends on. |
| `templates/c4-container.puml` | `docs/architecture/c4-container.puml` | C4-PlantUML container diagram (level 2). Repo-wide. Maintain whenever the system has more than one deployable unit. |
| `templates/c4-component.puml` | `docs/architecture/c4-component-<container>.puml` | C4-PlantUML component diagram (level 3). Repo-wide, one file per container whose internal modules warrant diagramming. |
| `templates/api-contract-shared.yaml` | `docs/api-contract/_shared.yaml` | OpenAPI 3.1 fragment that defines the shared auth scheme, pagination / idempotency / concurrency parameters, rate-limit headers, common error responses (`BadRequest` / `Unauthorized` / `Forbidden` / `NotFound` / `Conflict` / `PreconditionFailed` / `RateLimited`), and the canonical `Error` schema. **One file repo-wide.** Per-resource files `$ref` into this. |
| `templates/api-contract.yaml` | `docs/api-contract/{entity}.yaml` | OpenAPI 3.1 per-resource contract — **one file per resource, repo-wide**, with every operation (list / read / create / update / delete / custom) under `paths:`. References shared components via `$ref: "./_shared.yaml#/components/<bucket>/<name>"`. Resource-specific schemas live under this file's `components.schemas`. Validate the bundled spec, not each fragment in isolation. |
| `templates/data-model.yaml` | `docs/data-model/{entity}.yaml` | Open Data Contract Standard (ODCS) v3.1 — one file per persistence entity, repo-wide. Self-contained: a reader should not have to chase any other file to know the entity's shape. Code-first modeling, plural `physicalName`, descriptive column names, `pk/fk/idx/uq/vw` constraint prefixes inside the `constraints` block. |
| `templates/runbook.md` | `docs/runbooks/{ops,dev}/<procedure>.md` (or `docs/runbooks/<procedure>.md` for both-audience) | Durable, repo-level operational procedure executed *after* a feature ships — enable prod, deploy, roll back, swap a provider, local-dev setup, common dev tasks. Directory is the audience signal (`ops/` = SRE, `dev/` = engineers, root = both); no `audience:` tag. Links *up* to ADR / data-model / api-contract for canonical facts; never references `requirement.md` / `implement-detail.md`. |
| `templates/claude-md-architecture-context.md` | `CLAUDE.md` (the `## Architecture context` section) | **Only when the design adds a service, datastore, external dependency, or otherwise shifts the high-level topology.** Edit the architecture-context section in place; never append a per-feature changelog. The goal: a new agent reading this should know the system's shape at a glance. |
