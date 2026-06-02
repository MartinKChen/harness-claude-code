# Runbook — <procedure name>

> **Durable, repo-level operational procedure.** Lives under `docs/runbooks/`, not inside any feature's `implement-detail.md`. A runbook is a procedure someone executes *after* a feature ships and is feature-agnostic in spirit (enable prod, deploy, roll back, swap a provider, set up local dev, run a common dev task). It survives the archiving of any single feature's build docs.
>
> **Audience is the directory.** `ops/` → SRE / release operators. `dev/` → engineers and dev-facing agents. A both-audience runbook lives at the runbooks root. There is no `audience:` frontmatter tag — the directory *is* the signal.
>
> **Not a runbook:** why-this-was-built reasoning (that is build explanation — keep it in `implement-detail.md`) and project-wide standards (those belong with the relevant `pattern-*` skill or an ADR). If you cannot execute it as a procedure after the feature ships, it does not belong here.

## When to run this

<The trigger. What situation or schedule calls for this procedure. One or two sentences.>

## Prerequisites

- <access / credential / tool needed>
- <state the system must be in before starting>

## Procedure

1. <step — exact command or action, copy-pasteable where possible>
2. <step>
3. <step — how to confirm the step worked>

## Verification

<How to confirm the whole procedure succeeded. The concrete signal to look for (a status, a metric, a returned value).>

## Rollback / recovery

<How to undo this, or what to do if a step fails partway. Empty only if genuinely irreversible — say so.>

## References

<Link *up* to the durable artifacts that define the canonical facts this procedure touches — ADRs, `docs/data-model/<entity>.yaml`, `docs/api-contract/<entity>.yaml`. Never link to a feature's `requirement.md` / `implement-detail.md`: those are transient build inputs and get archived once the feature's issues are created.>
