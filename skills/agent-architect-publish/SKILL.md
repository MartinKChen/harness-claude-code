---
name: agent-architect-publish
description: "Materialize and commit every artifact for an approved architectural design: ADRs under `docs/architecture-decision-record/`, the feature's `implement-detail.md` under `docs/product-requirement-document/<feature-name>/`, C4 diagrams under `docs/architecture/`, OpenAPI 3.1 contracts under `docs/api-contract/`, ODCS v3.1 data models under `docs/data-model/`. Commits on the current branch; no PR, no scaffold. Activate on '/agent-architect-publish'."
---

# agent-architect-publish

Materialize every output of an approved architectural design and commit them on the current branch. Owns: ADRs, the ADR index, the feature's implementation-detail doc, the C4-PlantUML diagrams, per-resource OpenAPI 3.1 contracts, per-entity ODCS v3.1 data models, the optional `CLAUDE.md` architecture-context update, and the inline commit on the current branch.

This skill **assumes the design is already settled and approved** with the user. It does not run a design interview, does not push, does not open a PR, and does not run any scaffold gate. Only **`implement-detail.md` is feature-bounded**; ADRs, C4 diagrams, API contracts, and data models all live at the repo level so they survive across features.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Publish architecture artifacts for <feature-name>` and the conversation history (or a referenced design note) already carries a settled, approved design.
- The user has explicitly approved a settled design in this conversation and asks to write it out.
- The user types `/agent-architect-publish`, or phrases like 'generate the ADRs and implement-detail for this design', 'write the architecture artifacts', 'commit the architecture decisions we just settled'.

Do NOT activate when:

- The design is not yet settled — stop and surface that the design needs to be settled first; do not begin generating artifacts from a half-formed design.
- The user wants to revisit a decision — stop and surface that the design needs to change first.
- The unit of work is product framing (PRD, critical path, glossary) — that is the product owner's job.
- The user asks to open a PR — that is the orchestrator's job. This skill commits only.

## Workflow

Inputs from the caller (typically forwarded from the interviewer's dispatch prompt): a `<feature-name>`, the **partitioned decisions** already tagged with their assigned `ADR-{NNNN}` IDs, the **supersession list** (existing ADR IDs each new ADR replaces), any deferred-with-trigger items, whether the high-level topology shifted (so the architecture-context section of `CLAUDE.md` can be updated when warranted), and the working directory of the worktree on the feature branch. ADR partitioning and ID assignment happen upstream — do **not** re-partition or re-number here.

Everything else (sibling PRD files, current `CLAUDE.md` shape, existing diagrams / contracts / data-model on disk that may need editing in place) you read from disk.

### Scope

This skill is **scope-aware**. The dispatch prompt's trigger phrase selects which subset of artifacts to write. Recognized scopes:

| Trigger phrase | Scope | Artifacts |
|---|---|---|
| `Publish implement-detail for <feature-name>` | `implement-detail` | `docs/product-requirement-document/<feature-name>/implement-detail.md` only |
| `Publish ADRs for <feature-name>` | `adr` | ADR files + ADR index + C4 diagrams + optional `CLAUDE.md` architecture-context update |
| `Publish API contracts for <feature-name>` | `api-contract` | `docs/api-contract/_shared.yaml` (when missing) + per-resource `docs/api-contract/<entity>.yaml` |
| `Publish data models for <feature-name>` | `data-model` | per-entity `docs/data-model/<entity>.yaml` |
| `Publish architecture lockin for <feature-name>` | `all` (legacy full-scope) | every artifact above, in a single batched commit |

In step 1, run only the artifact sub-block(s) that match the dispatched scope; skip the rest. In step 3, use the scope-appropriate Conventional Commits subject (template list lives in that step).

If the dispatched scope has nothing to write (e.g. `api-contract` scope dispatched but the feature exposes no API surface), do not write or commit anything — proceed to step 4 and report "scope no-op" with the reason.

### 1. Generate artifacts

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

For the implement-detail doc (`docs/product-requirement-document/{feature-name}/implement-detail.md`) — **scope: `implement-detail`, `all`**:

- Start from `templates/implement-detail.md`.
- `{feature-name}` matches the directory the requirement lives in.
- **This is the only feature-bounded architecture artifact.** Cross-reference each ADR by ID rather than re-arguing the decision. Cross-reference the C4 diagrams under `docs/architecture/`, the per-resource OpenAPI files under `docs/api-contract/`, and the per-entity ODCS files under `docs/data-model/` instead of duplicating their content.

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

For `CLAUDE.md` — **scope: `adr`, `all`**:

- **Only update if** the design adds a service, datastore, external dependency, or otherwise shifts the high-level topology.
- Start from `templates/claude-md-architecture-context.md` for the section shape, then edit `CLAUDE.md`'s architecture-context section in place; **do not** append a per-feature changelog.
- Goal: a new agent reading this should know the system's shape at a glance.

### 2. Hand artifacts back for iteration

Tell the user which files were written, which were deleted (superseded ADRs), and whether `docs/architecture-decision-record/README.md` and `CLAUDE.md` were updated. Then ask whether to iterate or confirm.

Do **NOT** summarize the contents — the user can read the files.

If the user asks to iterate, treat each request as a localized rewrite of the affected file(s). If the user's edit invalidates a settled decision (i.e. is a *design* change, not a wording or formatting fix), STOP and surface that the design itself needs to change first — do not silently re-litigate the architecture inside this skill.

### 3. On confirmation, commit on the current branch with inline `git`

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
| `all` (legacy full-scope) | `docs(adr): ADR-{NNNN}..{MMMM} <feature-name> architecture` |

Capture the commit hash — step 4 reports it.

If the dispatched scope had nothing to write (the "scope no-op" case flagged in the **Scope** section above), skip the `git` calls and proceed to step 4.

### 4. Report final status

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
| `templates/implement-detail.md` | `docs/product-requirement-document/{feature-name}/implement-detail.md` | The **only** feature-bounded architecture artifact. Companion to the feature's `requirement.md`. Cross-reference each ADR by ID, the C4 diagrams under `docs/architecture/`, the OpenAPI files under `docs/api-contract/`, and the ODCS files under `docs/data-model/` rather than inlining their content. |
| `templates/c4-context.puml` | `docs/architecture/c4-context.puml` | C4-PlantUML system-context diagram (level 1). Repo-wide. Update only when the design changes who interacts with the system or which external systems it depends on. |
| `templates/c4-container.puml` | `docs/architecture/c4-container.puml` | C4-PlantUML container diagram (level 2). Repo-wide. Maintain whenever the system has more than one deployable unit. |
| `templates/c4-component.puml` | `docs/architecture/c4-component-<container>.puml` | C4-PlantUML component diagram (level 3). Repo-wide, one file per container whose internal modules warrant diagramming. |
| `templates/api-contract-shared.yaml` | `docs/api-contract/_shared.yaml` | OpenAPI 3.1 fragment that defines the shared auth scheme, pagination / idempotency / concurrency parameters, rate-limit headers, common error responses (`BadRequest` / `Unauthorized` / `Forbidden` / `NotFound` / `Conflict` / `PreconditionFailed` / `RateLimited`), and the canonical `Error` schema. **One file repo-wide.** Per-resource files `$ref` into this. |
| `templates/api-contract.yaml` | `docs/api-contract/{entity}.yaml` | OpenAPI 3.1 per-resource contract — **one file per resource, repo-wide**, with every operation (list / read / create / update / delete / custom) under `paths:`. References shared components via `$ref: "./_shared.yaml#/components/<bucket>/<name>"`. Resource-specific schemas live under this file's `components.schemas`. Validate the bundled spec, not each fragment in isolation. |
| `templates/data-model.yaml` | `docs/data-model/{entity}.yaml` | Open Data Contract Standard (ODCS) v3.1 — one file per persistence entity, repo-wide. Self-contained: a reader should not have to chase any other file to know the entity's shape. Code-first modeling, plural `physicalName`, descriptive column names, `pk/fk/idx/uq/vw` constraint prefixes inside the `constraints` block. |
| `templates/claude-md-architecture-context.md` | `CLAUDE.md` (the `## Architecture context` section) | **Only when the design adds a service, datastore, external dependency, or otherwise shifts the high-level topology.** Edit the architecture-context section in place; never append a per-feature changelog. The goal: a new agent reading this should know the system's shape at a glance. |
