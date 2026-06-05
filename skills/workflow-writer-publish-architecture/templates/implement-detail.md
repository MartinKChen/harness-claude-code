# <Feature Name> — Implementation Detail

> Companion to `requirement.md`. Captures *how* the feature will be built, given the decisions in ADR-{NNNN}. The **only** feature-bounded architecture artifact — every other artifact referenced below lives at the repo level under `docs/`.
>
> **Transient build input.** This file (and its sibling `requirement.md`) exists to feed `create-feature-issues`. Once that feature's issues are created, `create-feature-issues` archives this pair out of the live doc tree. Two rules follow:
> - **Build explanation only.** Architecture rationale, module/file-tree shape, repo layout — *why* this was built. Operational procedures (enable prod, deploy, roll back, swap a provider, local-dev setup, common dev tasks) are **runbooks**: they live under `docs/runbooks/`, not here. Link to them from the Runbooks section below.
> - **Never the sole home of a canonical fact.** A constraint, table, integrity rule, state machine, or rate-limit budget is defined in its durable artifact (ADR / `docs/data-model/` / `docs/api-contract/`) and merely *linked up to* from here. This file may point *up* at a durable home; archiving it must never delete canon.

## Overview

<2–4 sentences. Where the feature lives in the system, which services/modules it touches, what it depends on.>

## Architecture

<Describe the runtime shape in prose, then point to the repo-level C4-PlantUML diagrams that show it. Sync vs async edges, ownership boundaries, who calls whom. Reference ADR-{NNNN} for the decisions behind this shape rather than re-arguing them.>

- [`../../architecture/c4-context.puml`](../../architecture/c4-context.puml) — system-context diagram (level 1). *Reference only when this feature changed it.*
- [`../../architecture/c4-container.puml`](../../architecture/c4-container.puml) — container diagram (level 2). *Reference whenever the feature touches more than one deployable unit.*
- [`../../architecture/c4-component-<container>.puml`](../../architecture/c4-component-<container>.puml) — component diagram (level 3) for `<container>`. *Reference one per container whose internal modules this feature changes.*

## Modules

<The modules that will be built or modified. For each, name what it owns and what it explicitly does *not* own. Prefer small interfaces with large implementations. Cross-reference the C4 component diagram above when one exists.>

## Data Model

<List the entities this feature touches and link to their per-entity ODCS v3.1 files under `docs/data-model/`. Do NOT inline columns/types/constraints — those live in the per-entity files. Call out migrations and ordering concerns here, since they span multiple entities.>

- [`{entity}`](../../data-model/{entity}.yaml) — <one-line role of this entity in the feature>
- [`{entity}`](../../data-model/{entity}.yaml) — <one-line role>

## API / Interface Surface

<List the API resources this feature exposes or consumes and link to their per-resource OpenAPI 3.1 files under `docs/api-contract/`. Do NOT inline method/URI/body/status — those live in the per-resource files. Note cross-cutting concerns (versioning strategy, shared auth scheme, global rate-limit tier) here, then point at `_shared.yaml` for the canonical definitions.>

- [`_shared.yaml`](../../api-contract/_shared.yaml) — auth scheme, common error responses, pagination / idempotency / concurrency parameters, rate-limit headers, canonical `Error` schema. Every resource file `$ref`s into this.
- [`{entity}`](../../api-contract/{entity}.yaml) — <one-line role of this resource>
- [`{entity}`](../../api-contract/{entity}.yaml) — <one-line role>

## Integration Points

<External systems, internal services, or shared libraries touched. Note contracts, rate limits, and failure semantics for each.>

## Failure Modes & Handling

- <failure mode> — <how the system responds; what the user sees>
- <failure mode> — <how the system responds; what the user sees>

## Observability

<Metrics, logs, and traces to add. Name the specific signal and where it lives — be concrete enough that the next agent can wire them up without re-deciding.>

## Rollout Plan

<Migration order, feature flags, backfill steps, and how to roll back *for this rollout*. Keep it short — one numbered list of steps. A repeatable operational procedure (deploy, rollback, enable prod) is a **runbook** — define it under `docs/runbooks/` and link it from the Runbooks section below, don't inline the procedure here.>

## Runbooks

<Link to the durable operational runbooks under `docs/runbooks/` that this feature introduces or touches. Procedures live in those files, not here — this section is just the index of pointers. Empty is fine if the feature adds no operational procedure.>

- [`runbooks/ops/<procedure>.md`](../../runbooks/ops/<procedure>.md) — <one-line: when an SRE runs it>
- [`runbooks/dev/<procedure>.md`](../../runbooks/dev/<procedure>.md) — <one-line: when an engineer runs it>

## Out of Scope (deferred with trigger)

- <item> — defer until <trigger>. Tracked in ADR-{NNNN} under "Future triggers".

## Open Questions

<Anything still unresolved that doesn't block shipping but should be revisited. Empty is fine.>
