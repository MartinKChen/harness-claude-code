export const meta = {
  name: 'implement-slice',
  description: 'Drive one slice through author-E2E → coverage gate → plan → implement → pass-E2E → slice-review → fix to an open draft PR',
  whenToUse: 'Launched (background) by the /implement-feature Stage-1 kickoff once per eligible slice, after the orchestrator flips status:ready-to-implement → status:in-progress (the slice lock). Owns the WHOLE inner cycle; the outer /loop only handles the PR (fix-pr / close-pr). Pass { slice, today }.',
  phases: [
    { title: 'Prep' },
    { title: 'Author E2E' },
    { title: 'Coverage gate' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Pass E2E' },
    { title: 'Slice review' },
    { title: 'PR' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs. The Stage-1 kickoff passes:
//   args.slice — the slice issue number (status:in-progress lock already set)
//   args.today — YYYY-MM-DD (Date.* is unavailable inside workflow scripts; used
//                only to stamp the draft-PR body's review-verdict line)
//   args.reviewScriptPath — absolute path to the sibling review-slice.mjs. The
//                harness resolves a CHILD workflow by scriptPath; a plugin-shipped
//                workflow is NOT registered as a resolvable name (calling
//                workflow('review-slice') throws "no workflow with that name"),
//                and a workflow script has no filesystem/env access to derive its
//                own directory — so the orchestrator must pass the path in.
// `args` may arrive as a parsed object or, on a backgrounded run, the JSON string.
// ─────────────────────────────────────────────────────────────────────────────
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const SLICE = input.slice
const TODAY = input.today ?? 'unknown-date'
const REVIEW_SCRIPT = input.reviewScriptPath
if (!/^\d+$/.test(String(SLICE)))
  throw new Error(`implement-slice: args.slice must be a slice issue number; got ${typeof SLICE}: ${JSON.stringify(SLICE) ?? String(SLICE)}`)

// FIX_CAP is the circuit breaker that replaces the deleted engineer budget gate's
// "stop a runaway loop" role: each gate/review fix loop gets at most this many
// rounds before the slice halts to a human.
const FIX_CAP = 4

// Subagent types — the plugin's real agents (each loads its own skill stack and
// resumes from the slice checklist), not the default workflow dimension agent.
const E2E_AUTHOR = 'harness-claude-code:e2e-author'
const ENGINEER = 'harness-claude-code:engineer'

// ── Schemas ───────────────────────────────────────────────────────────────────
const TASK = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id:        { type: 'string', description: 'static checklist id, short form e.g. e2e.1 / be.1 / fe.2' },
    type:      { type: 'string', enum: ['e2e', 'backend', 'frontend'] },
    done:      { type: 'boolean', description: 'true iff the checkbox is [x]' },
    blockedBy: { type: 'array', items: { type: 'string' }, description: 'task ids this one waits on (intra-slice)' },
    delivery:  { type: 'string', description: 'the one-line delivery text from the checklist entry' },
  },
  required: ['id', 'type', 'done', 'blockedBy', 'delivery'],
}
const PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:          { type: 'boolean' },
    haltReason:  { type: ['string', 'null'] },
    sliceTitle:  { type: 'string' },
    sliceBranch: { type: 'string' },
    milestone:   { type: ['string', 'null'] },
    typeScope:   { type: 'string', description: 'conventional PR-title prefix inferred from the slice, e.g. feat(auth)' },
    smokeHint:   { type: 'string', description: 'one-line manual smoke for the PR test plan' },
    tasks:       { type: 'array', items: TASK },
  },
  required: ['ok', 'haltReason', 'sliceTitle', 'sliceBranch', 'milestone', 'typeScope', 'smokeHint', 'tasks'],
}
const DISPATCH_PLAN = {
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      description: 'ordered engineer-dispatch groups; earlier groups must complete before later ones (DAG-respecting)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          groupId: { type: 'string' },
          taskIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
        required: ['groupId', 'taskIds'],
      },
    },
  },
  required: ['groups'],
}
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: { verdict: { type: 'string', enum: ['APPROVE', 'BLOCK'] } },
  required: ['verdict'],
}
const E2E_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['green', 'need-attention'] },
    reason: { type: ['string', 'null'], description: 'set only when status=need-attention (the test-case constraint)' },
  },
  required: ['status', 'reason'],
}
const SIDE_EFFECT = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, prNumber: { type: ['integer', 'null'] }, error: { type: ['string', 'null'] } },
  required: ['ok', 'prNumber', 'error'],
}
// Returned by the post-Implement completion check: the queried task ids whose
// `## Tasks` checkbox is still `[ ]` (an engineer killed mid-run leaves its tasks
// only partially ticked). Empty array = the whole group is done.
const COMPLETION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    openIds: { type: 'array', items: { type: 'string' }, description: 'subset of the queried ids whose checkbox is still [ ] (not yet [x])' },
  },
  required: ['openIds'],
}

// ── halt(): the only path to a human ────────────────────────────────────────────
// Flip the slice to status:need-attention (the durable, user-owned halt) and post
// a diagnostic comment. The outer /loop never recovers this — the user does.
async function halt(reason) {
  log(`HALT slice #${SLICE}: ${reason}`)
  await agent(
    `The slice #${SLICE} implementation cannot proceed without a human. Do exactly this and nothing else:
1. Write this reason to /tmp/implement-slice-${SLICE}-halt.md: "${reason}".
2. Post it: \`bash skills/operation-git/scripts/post-comment.sh ${SLICE} /tmp/implement-slice-${SLICE}-halt.md\`.
3. Flip the label: \`gh issue edit ${SLICE} --remove-label "status:in-progress" --add-label "status:need-attention"\`.
Return ok=true (or error set on failure). prNumber=null.`,
    { label: 'halt', phase: 'PR', schema: SIDE_EFFECT },
  )
  return { slice: SLICE, status: 'need-attention', reason }
}

// ── reviewSlice(): run review-slice.mjs as a CHILD workflow ──────────────────────
// review-slice is plugin-shipped, so the harness can only resolve it by scriptPath
// (not by name) — the orchestrator hands us its absolute path in REVIEW_SCRIPT.
// Any launch/resolution failure is caught and surfaced as { error } so the caller
// can halt() to a human; an uncaught throw here would kill the whole run before
// halt() could fire (the v0.40.0 coverage-gate crash). On success this returns
// review-slice's verdict object: { verdict: 'APPROVE'|'BLOCK', ... }.
async function reviewSlice(scope) {
  try {
    return await workflow({ scriptPath: REVIEW_SCRIPT }, { slice: SLICE, scope })
  } catch (e) {
    return { error: `review-slice child workflow failed to launch: ${e?.message || String(e)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Prep — one agent reads the slice body, parses the `## Tasks` checklist
// (the durable task ledger), and returns the resume state. A ticked `[x]` box is
// a DONE task; a cold restart re-reads it here, so done work is skipped below.
// ─────────────────────────────────────────────────────────────────────────────
phase('Prep')
const prep = await agent(
  `Read slice issue #${SLICE} and return its resume state. Use the plugin's operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`). Do NOT edit code, push, or flip labels.

Steps:
1. Fetch the slice: \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,title,body,labels,url,milestone\`. If closed/unreadable, return ok=false + haltReason; best-effort the rest.
2. Parse the \`## Tasks\` checklist from the body. Each line looks like:
   \`- [ ] \\\`be.1\\\` · **backend** · blocked-by: \\\`e2e.1\\\` · "POST /widgets …"\` (or \`[x]\` when done).
   For each task return { id (short form, e.g. be.1), type (e2e|backend|frontend), done (true iff [x]), blockedBy (the ids in the blocked-by field, [] if "—"), delivery (the quoted text) }.
3. Resolve the slice branch: \`bash skills/operation-git/scripts/resolve-slice-branch.sh ${SLICE}\` → sliceBranch.
4. typeScope = the conventional PR-title prefix you infer from the slice (e.g. feat(auth)). smokeHint = one short manual smoke a reviewer would run. milestone = the slice's milestone title (or null).

Return the PREP object.`,
  { phase: 'Prep', schema: PREP },
)
if (!prep || !prep.ok) return halt(prep?.haltReason || 'prep could not read the slice body')

// review-slice runs at the coverage gate (Phase B) and the slice review (Phase F),
// so it is always needed. Bail to a human NOW — before the expensive author /
// implement phases — if the orchestrator did not pass its path, rather than
// authoring specs and crashing ~7 min later at the gate.
if (!REVIEW_SCRIPT)
  return halt('args.reviewScriptPath was not provided by the /implement-feature Stage-1 kickoff — implement-slice cannot locate review-slice.mjs to run the coverage gate / slice review. Update the kickoff to pass `reviewScriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/review-slice.mjs"`.')

// In-memory done-tracking, seeded from the durable checklist and updated as each
// dispatch completes. (Agents also tick the boxes in the body — the durable copy
// — but within this run we trust our local model for skip decisions.)
const done = new Set(prep.tasks.filter(t => t.done).map(t => t.id))
const e2eTasks = prep.tasks.filter(t => t.type === 'e2e')
const implTasks = prep.tasks.filter(t => t.type !== 'e2e')

// ─────────────────────────────────────────────────────────────────────────────
// PHASE A: Author E2E — one e2e-author dispatch for every not-yet-authored e2e task.
// ─────────────────────────────────────────────────────────────────────────────
phase('Author E2E')
const pendingE2E = e2eTasks.filter(t => !done.has(t.id))
if (pendingE2E.length) {
  const ids = pendingE2E.map(t => t.id).join(',')
  await agent(
    `Author E2E for slice #${SLICE} tasks ${ids}.`,
    { agentType: E2E_AUTHOR, phase: 'Author E2E', label: `author:${ids}` },
  )
  pendingE2E.forEach(t => done.add(t.id))
} else {
  log(e2eTasks.length ? 'Author E2E: all e2e tasks already authored — skipping.' : 'Author E2E: slice has no e2e tasks — skipping.')
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE B: Coverage gate — review-slice (scope:coverage) as a CHILD workflow,
// looping to an e2e-author fix until the specs cover every AC + non-happy-path.
// Skipped when the slice has no e2e tasks (nothing to gate).
// ─────────────────────────────────────────────────────────────────────────────
phase('Coverage gate')
if (e2eTasks.length) {
  let passed = false
  for (let i = 0; i < FIX_CAP; i++) {
    const r = await reviewSlice('coverage')
    if (r?.error) return halt(`E2E coverage gate could not run review-slice: ${r.error}`)
    // A set publishError means the verdict comment never reached GitHub (e.g. the
    // Haiku publisher narrated a "post by hand later" workaround instead of running
    // post-comment.sh). The gate's findings would then be invisible to the fix loop —
    // halt to a human rather than loop blind or APPROVE on an unposted verdict.
    if (r?.publishError) return halt(`E2E coverage gate verdict was not posted to #${SLICE}: ${r.publishError}`)
    if (r?.verdict === 'APPROVE') { passed = true; break }
    if (i === FIX_CAP - 1) break
    await agent(
      `Fix E2E coverage feedback on slice #${SLICE}.`,
      { agentType: E2E_AUTHOR, phase: 'Coverage gate', label: `coverage-fix:${i + 1}` },
    )
  }
  if (!passed) return halt(`E2E coverage gate did not converge within ${FIX_CAP} rounds`)
} else {
  log('Coverage gate: no e2e tasks — skipping.')
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE C: Plan — one planner groups the implementation tasks into ordered
// engineer dispatches (respect blocked-by; cap each group to one DAG chain /
// ≤3 tasks so a single engineer dispatch stays small — the deleted budget gate's
// "bound the context" job is covered by this size cap + small-task scoping).
// ─────────────────────────────────────────────────────────────────────────────
phase('Plan')
let groups = []
if (implTasks.length) {
  const plan = await agent(
    `Group these slice #${SLICE} implementation tasks into ordered engineer-dispatch groups. Rules:
- Respect blocked-by: a task's group must come after every group containing a task it is blocked by.
- Cap each group to a single DAG chain and at most 3 tasks (keep each engineer dispatch small).
- Independent siblings may share a group only if that keeps the group ≤3 and one chain; otherwise split.
- Cover EVERY task exactly once.

Tasks (JSON): ${JSON.stringify(implTasks.map(t => ({ id: t.id, type: t.type, blockedBy: t.blockedBy, delivery: t.delivery })))}

Return { groups: [{ groupId, taskIds: [...] }] } in dependency order (earliest-first).`,
    { phase: 'Plan', schema: DISPATCH_PLAN },
  )
  groups = plan?.groups ?? []
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE D: Implement — groups run SERIALLY (all tasks share one slice worktree,
// so two authors can't run at once). Skip a group whose tasks are all done.
//
// Dispatch → VERIFY against the durable checklist → re-dispatch the remainder.
// An engineer killed mid-run (memory pressure) returns control here with its
// tasks only partially ticked; an `await agent()` that simply RETURNS is not
// proof the work finished — trusting it blindly would carry an unfinished slice
// into Pass E2E / review (and Pass E2E is skipped entirely on e2e-less slices,
// leaving no net). The engineer's own done-signal is the ticked `## Tasks` box,
// so re-reading those boxes is the completion proof. A re-dispatch resumes from
// the slice branch's WIP commits, so retrying an interrupted group is cheap.
// FIX_CAP bounds the retries (same circuit breaker the gate / review loops use);
// a group still unticked after that halts to a human. (A mid-run kill that throws
// instead of returning crashes the whole run — recovered separately by the
// reconcile reaper relaunching implement-slice, whose Prep re-reads the live
// checklist. This loop covers the silent partial-completion case.)
// ─────────────────────────────────────────────────────────────────────────────
phase('Implement')
for (const g of groups) {
  let todo = g.taskIds.filter(id => !done.has(id))
  if (!todo.length) { log(`Implement: group ${g.groupId} already done — skipping.`); continue }
  for (let attempt = 0; attempt < FIX_CAP; attempt++) {
    const ids = todo.join(',')
    await agent(
      `Implement slice #${SLICE} tasks ${ids}.`,
      { agentType: ENGINEER, phase: 'Implement', label: attempt ? `implement:${ids}:retry${attempt}` : `implement:${ids}` },
    )
    const check = await agent(
      `Read slice #${SLICE} and report which of these tasks are NOT yet done. Do NOT edit code, push, or flip labels.
Steps:
1. \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,body\`.
2. Parse the \`## Tasks\` checklist. For each id in [${ids}], a box ticked \`[x]\` is DONE; \`[ ]\` is still open.
Return openIds = the subset of [${ids}] whose checkbox is still \`[ ]\` (empty array if every one is ticked).`,
      { phase: 'Implement', label: `verify:${ids}`, schema: COMPLETION, model: 'haiku' },
    )
    // A missing / garbled verification keeps the whole group open (re-dispatch)
    // rather than falsely advancing on an unconfirmed result.
    const open = check ? todo.filter(id => check.openIds.includes(id)) : todo
    todo.filter(id => !open.includes(id)).forEach(id => done.add(id))
    todo = open
    if (!todo.length) break
    log(`Implement: group ${g.groupId} left ${todo.join(',')} unticked after dispatch ${attempt + 1}/${FIX_CAP} — re-dispatching the remainder.`)
  }
  if (todo.length)
    return halt(`Implement: group ${g.groupId} tasks ${todo.join(',')} never reached [x] after ${FIX_CAP} engineer dispatches — likely repeated mid-run termination (memory pressure). A human should inspect the slice branch's WIP commits and finish or re-scope these tasks.`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE E: Pass E2E — one engineer runs the slice's E2E specs against a booted
// stack and drives PRODUCTION code (never the specs) to GREEN. An unfixable
// test-case constraint halts the slice to a human.
// ─────────────────────────────────────────────────────────────────────────────
phase('Pass E2E')
if (e2eTasks.length) {
  const e2e = await agent(
    `Pass E2E acceptance for slice #${SLICE}.`,
    { agentType: ENGINEER, phase: 'Pass E2E', label: 'pass-e2e', schema: E2E_RESULT },
  )
  if (!e2e || e2e.status === 'need-attention') return halt(e2e?.reason || 'E2E acceptance could not be reached without editing a spec')
} else {
  log('Pass E2E: no e2e tasks — skipping.')
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE F: Slice review — review-slice (scope:full) as a CHILD workflow, looping
// to an engineer fix-slice until APPROVE.
// ─────────────────────────────────────────────────────────────────────────────
phase('Slice review')
let reviewPassed = false
for (let i = 0; i < FIX_CAP; i++) {
  const r = await reviewSlice('full')
  if (r?.error) return halt(`slice review could not run review-slice: ${r.error}`)
  // Unposted verdict (see the coverage-gate note above): the findings never reached
  // #${SLICE}, so a BLOCK would loop blind and an APPROVE would open a PR whose
  // "see the # Slice Review comment" body points at a comment that doesn't exist.
  if (r?.publishError) return halt(`slice review verdict was not posted to #${SLICE}: ${r.publishError}`)
  if (r?.verdict === 'APPROVE') { reviewPassed = true; break }
  if (i === FIX_CAP - 1) break
  await agent(
    `Fix the review feedback on slice #${SLICE}.`,
    { agentType: ENGINEER, phase: 'Slice review', label: `fix:${i + 1}` },
  )
}
if (!reviewPassed) return halt(`slice review did not converge within ${FIX_CAP} rounds`)

// ─────────────────────────────────────────────────────────────────────────────
// PHASE G (terminal): open the idempotent draft PR and RELEASE the slice lock.
// The outer /loop's fix-pr / close-pr stages take it from here (CI, merge
// conflicts, the final merge). Releasing status:in-progress on success is what
// keeps the reconcile reaper from relaunching a slice that already finished.
// ─────────────────────────────────────────────────────────────────────────────
phase('PR')
const prBody = [
  `Closes #${SLICE}`, '', '## Summary', '',
  prep.sliceTitle, '',
  '## Review verdict', '', `Slice review passed on ${TODAY}. See the \`# Slice Review\` comment on #${SLICE} for finding-level detail.`, '',
  '## Test plan', '', '- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green', `- [ ] Manual smoke: ${prep.smokeHint}`,
].join('\n')

const pr = await agent(
  `Open the terminal draft PR for slice #${SLICE}. Do exactly this and nothing else:
1. Write the PR body (below) to /tmp/implement-slice-${SLICE}-pr.md.
2. Create the idempotent draft PR:
   \`bash skills/operation-git/scripts/create-draft-pr.sh ${prep.sliceBranch} "${prep.typeScope}: ${prep.sliceTitle}" /tmp/implement-slice-${SLICE}-pr.md --label merge:manual${prep.milestone ? ` --milestone "${prep.milestone}"` : ''}\`
   The script prints the PR number (new or existing). Capture it.
3. Release the slice lock now that the cycle is complete: \`gh issue edit ${SLICE} --remove-label "status:in-progress"\`. The OPEN DRAFT PR is now the durable artifact; the outer /loop's fix-pr / close-pr stages carry it to merge, and the PR's \`Closes #${SLICE}\` line closes the slice on merge. (Releasing the lock here is what stops the reconcile reaper from relaunching an already-finished slice.)
Return ok=true, prNumber=<the number>, error=null (or error set on failure).

--- PR BODY (verbatim, write to /tmp/implement-slice-${SLICE}-pr.md) ---
${prBody}
--- END PR BODY ---`,
  { label: 'open-draft-pr', phase: 'PR', schema: SIDE_EFFECT },
)

return { slice: SLICE, status: 'pr-open', prNumber: pr?.prNumber ?? null, error: pr?.error ?? null }
