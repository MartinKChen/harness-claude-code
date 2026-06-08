export const meta = {
  name: 'fix-bug',
  description: 'Drive one approved kind:bug issue through regression-test RED → fix GREEN → refactor → production-code review (gating fix loop, then one code-quality polish cycle + debt triage into enhancement issues) → open draft PR',
  whenToUse: 'Launched (background) by the unified implement command kickoff once per eligible kind:bug, after a human approved the `# Bug Analysis` comment and the orchestrator flipped status:ready-to-implement → status:in-progress (the bug lock). Owns the post-approval automatic half: it creates the fix branch, writes the regression test first, drives it green, runs the fan-out review (inlined as runReview()), loops the fix until APPROVE, opens a merge:manual draft PR, and releases the lock. Pass { issue, today }.',
  phases: [
    { title: 'Prep' },
    { title: 'Fix' },
    { title: 'Review' },
    { title: 'PR' },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs. The kickoff stage passes:
//   args.issue — the bug issue number (status:in-progress lock already set)
//   args.today — YYYY-MM-DD (Date.* is unavailable inside workflow scripts; used
//                only to stamp the draft-PR body's review-verdict line)
// `args` may arrive as a parsed object or, on a backgrounded run, the JSON string.
//
// fix-bug is the lighter sibling of implement-slice: no E2E-authoring phase and no
// coverage gate (the regression test IS the spec, and it is written inside the Fix
// phase). The fan-out review is the SAME machinery as implement-slice's
// runReviewSlice, ported here production-code-only (workflow scripts are
// self-contained — there is no shared import — so the review block is duplicated,
// matching the repo's inlined-review convention). The bug's defining discipline —
// the regression test fails-before / passes-after — is enforced by the review's
// deletable-code lens (pattern-test-coverage), not a bespoke gate.
// ─────────────────────────────────────────────────────────────────────────────
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const ISSUE = input.issue
const TODAY = input.today ?? 'unknown-date'
// Adversarial verify is OPT-IN, default OFF. The verify lenses re-judge the
// dimension reviewer's own findings — itself a form of self-review — so by
// default we trust the reviewer's severity and skip them (correctness + context
// bypassed). The orchestrator reads $HCC_VERIFY_LENSES (the workflow sandbox has
// no env access — same reason args.today is threaded in) and passes
// verifyLenses=true to turn the three lenses back on.
const VERIFY_ENABLED = input.verifyLenses === true || input.verifyLenses === 'true'
if (!/^\d+$/.test(String(ISSUE)))
  throw new Error(`fix-bug: args.issue must be a bug issue number; got ${typeof ISSUE}: ${JSON.stringify(ISSUE) ?? String(ISSUE)}`)

// Subagent types — the plugin's real agents (each loads its own skill stack).
const ENGINEER      = 'harness-claude-code:engineer'
const AXIS_REVIEWER = 'harness-claude-code:axis-reviewer'

// Review fan-out runs on Sonnet; mechanical prep / publish on Haiku. Retune here.
const AGENT_MODEL  = 'sonnet'
const WRITER_MODEL = 'haiku'

// ── Schemas ───────────────────────────────────────────────────────────────────
const PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:             { type: 'boolean' },
    haltReason:     { type: ['string', 'null'] },
    bugTitle:       { type: 'string' },
    fixBranch:      { type: 'string', description: 'fix/<issue#>-<kebab-intent>, created on origin if missing' },
    milestone:      { type: ['string', 'null'] },
    typeScope:      { type: 'string', description: 'conventional PR-title prefix, e.g. fix(auth)' },
    smokeHint:      { type: 'string', description: 'one-line manual smoke for the PR test plan' },
    regressionPlan: { type: 'string', description: 'the Regression-test plan section text from the approved # Bug Analysis comment' },
  },
  required: ['ok', 'haltReason', 'bugTitle', 'fixBranch', 'milestone', 'typeScope', 'smokeHint', 'regressionPlan'],
}
const SIDE_EFFECT = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, prNumber: { type: ['integer', 'null'] }, error: { type: ['string', 'null'] } },
  required: ['ok', 'prNumber', 'error'],
}

// ── Review schemas (ported from implement-slice runReviewSlice) ───────────────
const FINDING = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title:           { type: 'string', description: 'one-line, no leading #N' },
    severity:        { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] },
    effort:          { type: 'string', enum: ['L', 'M', 'H'], description: 'cost-to-fix-now: L localized ≲30min, M multi-file/new tests, H design/schema/contract rework' },
    file:            { type: 'string', description: 'path/to/file.ext:line' },
    impactStatement: { type: 'string', description: 'what breaks if this ships, one sentence' },
    effortStatement: { type: 'string', description: 'what fixing involves — files, tests, blast radius' },
    fix:             { type: 'string', description: 'concrete corrective action' },
    lang:            { type: 'string', description: 'code-fence language for the snippets' },
    bad:             { type: 'string', description: 'offending snippet' },
    good:            { type: 'string', description: 'corrected snippet' },
  },
  required: ['title', 'severity', 'effort', 'file', 'impactStatement', 'effortStatement', 'fix', 'lang', 'bad', 'good'],
}
const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  properties: { dimension: { type: 'string' }, findings: { type: 'array', items: FINDING } },
  required: ['dimension', 'findings'],
}
const REVIEW_PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:           { type: 'boolean', description: 'read-only worktree set up on the fix branch tip' },
    haltReason:   { type: ['string', 'null'] },
    worktreePath: { type: 'string' },
    scopeNote:    { type: ['string', 'null'], description: 'set only if diff scope had to fall back' },
    touchedPaths: { type: 'array', items: { type: 'string' }, description: 'raw `git diff --name-only origin/main..HEAD` paths, unclassified' },
  },
  required: ['ok', 'haltReason', 'worktreePath', 'scopeNote', 'touchedPaths'],
}
const SURFACES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    backend: { type: 'boolean' }, frontend: { type: 'boolean' }, python: { type: 'boolean' },
    typescript: { type: 'boolean' }, fastapi: { type: 'boolean' }, database: { type: 'boolean' },
    container: { type: 'boolean' }, vite: { type: 'boolean' }, hasContractFiles: { type: 'boolean' },
  },
  required: ['backend', 'frontend', 'python', 'typescript', 'fastapi', 'database', 'container', 'vite', 'hasContractFiles'],
}
const REFUTE_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}
const PUBLISH = {
  type: 'object',
  additionalProperties: false,
  properties: { posted: { type: 'boolean' }, error: { type: ['string', 'null'] } },
  required: ['posted', 'error'],
}
// Returned by the resume probe (reviewEntryAction) that runs ONCE before the Review
// loop. `review` = run the fan-out (the default — fresh fix, or a fix already landed
// since the last verdict). `fix-first` = a standing BLOCK verdict that nothing has
// been done about, so skip the redundant re-review and dispatch the fix straight
// away.
const REVIEW_ENTRY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action:      { type: 'string', enum: ['review', 'fix-first'] },
    lastVerdict: { type: ['string', 'null'], enum: ['APPROVE', 'BLOCK', null] },
    reason:      { type: 'string', description: 'one line citing the commit / comment timestamps compared' },
  },
  required: ['action', 'lastVerdict', 'reason'],
}

// ── Review catalogue + verify lenses (production-code scope) ──────────────────
// `gate: true` marks a SHIP-BLOCKING dimension — a confirmed I:H finding from one of
// these holds the verdict (BLOCK) and drives the fix loop. The three gating dimensions
// are the things a draft PR must not silently carry: spec compliance (here, that the
// regression test actually locks the fix in), contract conformance (don't break
// consumers), and security (don't ship a hole). Every OTHER dimension is code-quality
// DEBT: its findings are posted and classified `Defer` (for a periodic whole-codebase
// quality sweep) but NEVER block the fix — so the loop stops churning on idiom / polish
// and converges on the trio that genuinely must not ship. See scoreFinding() + the
// verdict predicate below.
const DIMENSIONS = [
  // Phase 1 — GATING dimensions (spec compliance + security). Always walk first; a
  // surviving I:H here BLOCKs and SKIPS Phase 2. For a bug, test-coverage gates that
  // the regression test actually locks the fix in. These are cheap (≤3 dims), so the
  // fix loop converges WITHOUT paying for the code-quality fan-out each round — the
  // debt dims run only on the round that clears the gate (and the polish re-review).
  { key: 'test-coverage', phase: 'spec', gate: true, skill: 'pattern-reviewer-test-coverage', extraSkill: 'pattern-test-coverage', applies: () => true },
  { key: 'contract',      phase: 'spec', gate: true, skill: 'pattern-reviewer-contract',      applies: s => s.hasContractFiles },
  { key: 'security',      phase: 'spec', gate: true, skill: 'pattern-reviewer-security',      applies: s => s.backend || s.frontend },
  // Phase 2 — code-quality DEBT (walk only if the gate stays open). None of these gate;
  // every finding is deferred-as-debt (posted, classified `Defer`, never blocking).
  { key: 'coding-standard',   phase: 'quality', skill: 'pattern-reviewer-coding-standard',   applies: s => s.backend || s.frontend },
  { key: 'observability',     phase: 'quality', skill: 'pattern-reviewer-observability',     applies: s => s.backend || s.frontend },
  { key: 'non-functional',    phase: 'quality', skill: 'pattern-reviewer-non-functional',    applies: s => s.backend || s.frontend },
  { key: 'backend-standard',  phase: 'quality', skill: 'pattern-reviewer-backend-standard',  applies: s => s.backend },
  { key: 'database',          phase: 'quality', skill: 'pattern-reviewer-database',          applies: s => s.database },
  { key: 'frontend-standard', phase: 'quality', skill: 'pattern-reviewer-frontend-standard', applies: s => s.frontend },
  { key: 'container',         phase: 'quality', skill: 'pattern-reviewer-container',         applies: s => s.container },
  { key: 'fastapi',           phase: 'quality', skill: 'pattern-reviewer-fastapi',           applies: s => s.fastapi },
  { key: 'python',            phase: 'quality', skill: 'pattern-reviewer-python',            applies: s => s.python },
  { key: 'typescript',        phase: 'quality', skill: 'pattern-reviewer-typescript',        applies: s => s.typescript },
  { key: 'vite',              phase: 'quality', skill: 'pattern-reviewer-vite',              applies: s => s.vite },
]

// Build the gating set from the catalogue above so the policy stays co-located with
// the rows (no second hardcoded list to drift). A finding is gating if its OWN
// dimension — or any dimension that also flagged it after dedup — is gating; the
// alsoFlaggedBy clause keeps a security/contract finding gating even when dedup
// folded it into a non-gating representative of equal severity.
const GATING_DIMS = new Set(DIMENSIONS.filter(d => d.gate).map(d => d.key))
const isGating = f => GATING_DIMS.has(f.dimension) || (f.alsoFlaggedBy || []).some(d => GATING_DIMS.has(d))

// The three adversarial verify lenses — applied ONLY when VERIFY_ENABLED. With
// verify OFF (default) none of them run: correctness + context are bypassed and
// the dimension reviewer's own severity stands unchallenged.
const VERIFY_LENSES = [
  { key: 'correctness', ask: 'Is the claimed defect actually present in THIS code? Read the cited file:line and its surroundings. If the code does not in fact do what the finding claims, it is refuted.' },
  { key: 'context',     ask: 'Did the finder miss surrounding code — a guard, an early return, a caller-side check, an existing test, a framework default — that already neutralises this? If such context exists, it is refuted.' },
  { key: 'severity',    ask: 'Would this actually break in production at the stated impact, or is the severity inflated? If it cannot realistically cause the claimed harm, treat it as refuted (severity does not justify a HIGH).' },
]

// ── Pure helpers ─────────────────────────────────────────────────────────────
const sevToImpact = s => (s === 'CRITICAL' || s === 'HIGH') ? 'H' : s === 'MEDIUM' ? 'M' : 'L'

function classify(impact, effort) {
  if (impact === 'H') return 'Fix'
  if (impact === 'M') return effort === 'L' ? 'Fix' : 'Defer'
  return effort === 'L' ? 'Nit' : 'Drop' // impact === 'L'
}

const fileNoLine = f => String(f).replace(/:\d+(?::\d+)?$/, '')
const tokenize = s => new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || [])
function jaccard(a, b) {
  const A = tokenize(a), B = tokenize(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

// ── Uncapped-loop instrumentation (parity with implement-slice) ──────────────
// The Review loop below is UNCAPPED. A per-round COST METER (budget.spent() delta)
// makes the spend visible, and the OSCILLATION GUARD halts to a human only on NO
// PROGRESS — the SAME I:H blocker surviving its own targeted engineer fix for
// STALL_ROUNDS rounds — never on round count. A loop that keeps retiring blockers
// runs uncapped.
const STALL_ROUNDS = 3
const kb = n => Math.round(n / 1000)
const verifyNote = VERIFY_ENABLED ? 'survived verification' : 'kept (verify off)'
const tokensSpent = () => { try { return budget?.spent?.() ?? 0 } catch { return 0 } }
const sameBlocker = (a, b) => fileNoLine(a.file) === fileNoLine(b.file) && jaccard(a.title, b.title) >= 0.5
const trackStall = (prev, blockers) => blockers.map(b => {
  const carried = prev.find(p => sameBlocker(p, b))
  return { file: b.file, title: b.title, streak: carried ? carried.streak + 1 : 1 }
})
const stuckBlockers = stall => stall.filter(s => s.streak >= STALL_ROUNDS)
const fmtStuck = stuck => stuck.map(s => `\`${s.file}\` — ${s.title} (survived ${s.streak} rounds)`).join('; ')

const SEV_RANK = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 }
function dedupeFindings(all) {
  const kept = []
  let merged = 0
  for (const f of all) {
    const hit = kept.find(k => fileNoLine(k.file) === fileNoLine(f.file) && jaccard(k.title, f.title) >= 0.5)
    if (!hit) { kept.push({ ...f, alsoFlaggedBy: [] }); continue }
    merged++
    if (!hit.alsoFlaggedBy.includes(f.dimension)) hit.alsoFlaggedBy.push(f.dimension)
    if (SEV_RANK[f.severity] > SEV_RANK[hit.severity]) {
      const trail = hit.alsoFlaggedBy.concat(hit.dimension).filter(d => d !== f.dimension)
      Object.assign(hit, f, { alsoFlaggedBy: Array.from(new Set(trail)) })
    }
  }
  return { kept, merged }
}

function scoreFinding(f) {
  const impact = sevToImpact(f.severity)
  const gating = isGating(f)
  // Non-gating findings are code-quality debt: a would-be `Fix` is downgraded to
  // `Defer` (recorded for the periodic quality sweep) so it never holds the fix.
  // Defer/Nit/Drop are already non-blocking, so they pass through unchanged.
  const base = classify(impact, f.effort)
  const cls = gating ? base : (base === 'Fix' ? 'Defer' : base)
  return { ...f, impact, gating, cls }
}

function composeComment(scored, { phase2Skipped, scopeNote, dedupMerged, verdict }) {
  const shown = scored.filter(f => f.cls !== 'Drop')
  const count = (i, e) => shown.filter(f => f.impact === i && f.effort === e).length
  const fixNow = shown.filter(f => f.cls === 'Fix').length
  const deferred = shown.filter(f => f.cls === 'Defer').length
  const nits = shown.filter(f => f.cls === 'Nit').length
  const blocked = verdict === 'BLOCK'

  const matrix = [
    '| Impact \\ Effort | E:H (High) | E:M (Medium) | E:L (Low) |',
    '|-----------------|------------|--------------|-----------|',
    `| **I:H** (High)  | ${count('H', 'H')} | ${count('H', 'M')} | ${count('H', 'L')} |`,
    `| **I:M** (Medium)| ${count('M', 'H')} | ${count('M', 'M')} | ${count('M', 'L')} |`,
    `| **I:L** (Low)   | ${count('L', 'H')} | ${count('L', 'M')} | ${count('L', 'L')} |`,
  ].join('\n')

  const renderFinding = f => {
    const also = f.alsoFlaggedBy?.length ? ` _(also flagged by: ${f.alsoFlaggedBy.join(', ')})_` : ''
    const snippets = (f.bad || f.good)
      ? `\n\n\`\`\`${f.lang}\n// BAD\n${f.bad}\n\`\`\`\n\n\`\`\`${f.lang}\n// GOOD\n${f.good}\n\`\`\``
      : ''
    return [
      `### [${f.cls} · I:${f.impact}/E:${f.effort}] ${f.title}${also}`,
      `**File:** \`${f.file}\``,
      `**Impact (${f.impact}):** ${f.impactStatement}`,
      `**Effort/Risk (${f.effort}):** ${f.effortStatement}`,
      `**Fix:** ${f.fix}${snippets}`,
    ].join('\n')
  }
  const section = (label, items, emptyText) =>
    `### ${label}\n\n` + (items.length ? items.map(renderFinding).join('\n\n') : `_${emptyText}_`)

  const specFindings = shown.filter(f => f.reviewPhase === 'spec')
  const qualFindings = shown.filter(f => f.reviewPhase === 'quality')
  const qualBlock = phase2Skipped
    ? '### Phase 2 — Code quality findings\n\n_Phase 2 (code-quality debt) skipped: a gating (spec / contract / security) `I:H` is still open. Re-review will run the debt dimensions once the gate clears._'
    : section('Phase 2 — Code quality findings', qualFindings, 'No code-quality findings.')

  return [
    '# Bug Fix Review',
    '',
    '## Review Summary',
    '',
    matrix,
    '',
    `**Fix now:** ${fixNow}  •  **Deferred:** ${deferred}  •  **Nits:** ${nits}`,
    dedupMerged ? `\n_Deduplicated ${dedupMerged} overlapping finding(s) reported by more than one dimension._` : '',
    scopeNote ? `\n**Note:** ${scopeNote}` : '',
    '',
    `**Verdict:** ${blocked ? 'BLOCK' : 'APPROVE'}`,
    '',
    '_Verdict holds on spec-compliance, contract, and security findings only. Any code-quality finding is recorded as **deferred debt** for the periodic quality sweep and never blocks the fix._',
    '',
    '## Findings',
    '',
    section('Phase 1 — Spec & security findings (gating)', specFindings, 'No spec or security findings.'),
    '',
    qualBlock,
  ].filter(s => s !== '').join('\n')
}

function dimensionPrompt(dim, diffCtx) {
  const extra = dim.extraSkill ? `\n- Grading catalogue: \`skills/${dim.extraSkill}/SKILL.md\`` : ''
  return `${diffCtx}

Apply ONE review dimension to the bug-fix diff for issue #${ISSUE} and nothing else.
- Dimension key: ${dim.key}  (set dimension="${dim.key}" on every finding)
- Pattern skill to apply: \`skills/${dim.skill}/SKILL.md\`${extra}
- Scope: production-code

Follow your single-axis review contract exactly — read that one skill, apply ONLY its catalogue, honor the production-code framing, the recall-over-precision stance, and the honesty floor (zero findings is valid; never fabricate). For the test-coverage dimension specifically, the regression test MUST fail-before / pass-after the fix and assert the bug's observable — a fix without a locking regression test is a HIGH coverage gap.`
}

async function verifyFindings(list, tag, diffCtx, phaseTitle) {
  // Verify OFF (default): no self-review pass — trust each finding exactly as the
  // dimension reviewer graded it (its severity drives the gate/verdict downstream).
  if (!VERIFY_ENABLED) return list.map(f => ({ ...f, survives: true }))
  return parallel(list.map(f => () =>
    parallel(VERIFY_LENSES.map(lens => () =>
      agent(
        `${diffCtx}

Adversarially verify a code-review finding. REFUTE it through the "${lens.key}" lens — be a skeptic, not a rubber stamp. ${lens.ask}

If you are uncertain after reading the actual code, default to refuted=true: an unproven finding must not block a fix.

Finding under scrutiny:
- dimension: ${f.dimension}
- title: ${f.title}
- severity: ${f.severity}
- file: ${f.file}
- claim (impact): ${f.impactStatement}
- proposed fix: ${f.fix}
- BAD snippet the finder cited:
${f.bad}

Read \`${f.file}\` (and its surroundings) in the worktree yourself before deciding. Return refuted + a one-line reason.`,
        { label: `verify:${tag}:${f.dimension}:${lens.key}`, phase: phaseTitle, schema: REFUTE_VERDICT, model: AGENT_MODEL },
      ),
    )).then(votes => {
      const v = votes.filter(Boolean)
      return { ...f, survives: v.filter(x => !x.refuted).length >= 2 }
    }),
  ))
}

async function runDimensions(dims, reviewPhase, phaseTitle, diffCtx) {
  return (await parallel(dims.map(d => () =>
    agent(dimensionPrompt(d, diffCtx), { agentType: AXIS_REVIEWER, label: `${reviewPhase}:${d.key}`, phase: phaseTitle, schema: FINDINGS, model: AGENT_MODEL }),
  ))).filter(Boolean).flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension, reviewPhase })))
}

// ─────────────────────────────────────────────────────────────────────────────
// runReview — production-code fan-out review over the bug-fix diff. Sets up a
// read-only worktree on the fix branch tip, fans out the applicable dimensions,
// dedups, adversarially verifies, composes ONE `# Bug Fix Review` verdict comment,
// posts it on the bug ISSUE, and RETURNS the verdict. Flips no label, opens no PR.
// Returns { verdict, publishError } on success or { error } on infra failure.
// ─────────────────────────────────────────────────────────────────────────────
async function runReview(phaseTitle, fixBranch) {
  try {
    const rprep = await agent(
      `You are setting up a READ-ONLY production-code review of the bug-fix branch for issue #${ISSUE}. Do NOT edit, push, or run destructive git. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`).

Steps:
1. Set up the read-only worktree on the fix branch \`${fixBranch}\`: \`bash skills/operation-git/scripts/setup-worktree.sh ${fixBranch}\` (NO --merge-main). Capture the printed worktreePath. If it fails, return ok=false with a haltReason.
2. Compute the touched paths vs origin/main inside the worktree: \`git -C <worktreePath> diff --name-only origin/main..HEAD\`. If that is empty, set scopeNote explaining the fallback; otherwise scopeNote=null.
3. Return those touched paths verbatim as touchedPaths (the raw list) — do NOT classify or interpret them.

Return the REVIEW_PREP object. The worktreePath you return is handed verbatim to every downstream dimension agent — make sure it is correct and on the fix branch tip.`,
      { label: 'review-prep', phase: phaseTitle, schema: REVIEW_PREP, model: WRITER_MODEL },
    )
    if (!rprep || !rprep.ok)
      return { error: rprep?.haltReason || `review could not set up a read-only worktree on ${fixBranch}` }

    const surfaces = await agent(
      `Classify the touched paths of the bug-fix for issue #${ISSUE} into review surfaces. These files changed on the fix branch, checked out READ-ONLY at \`${rprep.worktreePath}\`. Read paths (and, where the spelling is ambiguous, the file contents in the worktree) before deciding — do NOT guess from extensions alone.

Touched paths:
${rprep.touchedPaths.map(p => `- ${p}`).join('\n') || '- (none)'}

Return these booleans:
- backend: server-side application code (handlers, services, domain logic).
- frontend: client UI code.
- python: any .py file touched.
- typescript: any .ts/.tsx file touched.
- fastapi: FastAPI routes/deps/middleware or create_app wiring touched.
- database: ORM models or alembic migrations touched.
- container: Dockerfile/compose/.dockerignore/nginx/entrypoint touched.
- vite: vite.config/vitest.config or import.meta.env usage touched.
- hasContractFiles: any docs/api-contract/*.yaml or docs/data-model/*.yaml exists in the repo (check with \`ls\` in the worktree — a repo-existence check, not a touched-path check).

When a path could plausibly belong to a surface, prefer setting the boolean true: a false negative silently skips that review dimension, which is worse than running one extra lens.`,
      { label: 'review-surfaces', phase: phaseTitle, schema: SURFACES, model: AGENT_MODEL },
    ) ?? { backend: true, frontend: true, python: true, typescript: true, fastapi: true, database: true, container: true, vite: true, hasContractFiles: true }

    const diffCtx = `Review the bug-fix branch \`${fixBranch}\` checked out READ-ONLY at \`${rprep.worktreePath}\`. The diff under review is \`git -C ${rprep.worktreePath} diff origin/main..HEAD\`. Read the changed files and their surrounding context inside that worktree. Do NOT edit anything.`

    // Spec: fan out phase-1 dimensions, dedup, VERIFY before the gate.
    const specDims = DIMENSIONS.filter(d => d.phase === 'spec' && d.applies(surfaces))
    const specDedup = dedupeFindings(await runDimensions(specDims, 'spec', phaseTitle, diffCtx))
    const specConfirmed = (await verifyFindings(specDedup.kept, 'spec', diffCtx, phaseTitle)).filter(f => f.survives)
    log(`${phaseTitle}: spec ${specDedup.kept.length} deduped, ${specConfirmed.length} ${verifyNote}.`)

    // A gating (spec + security) I:H means the fix will be reworked — skip the
    // ~10-dim code-quality debt fan-out this round (it would be wasted work; the debt
    // dims run only on the round that clears the gate, plus the polish re-review).
    const gateTripped = specConfirmed.some(f => sevToImpact(f.severity) === 'H')

    let qualConfirmed = []
    let qualMerged = 0
    if (!gateTripped) {
      const qualDims = DIMENSIONS.filter(d => d.phase === 'quality' && d.applies(surfaces))
      log(`${phaseTitle}: quality dimensions ${qualDims.map(d => d.key).join(', ') || '(none)'}`)
      const qualDedup = dedupeFindings(await runDimensions(qualDims, 'quality', phaseTitle, diffCtx))
      qualMerged = qualDedup.merged
      qualConfirmed = (await verifyFindings(qualDedup.kept, 'quality', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: quality ${qualDedup.kept.length} deduped, ${qualConfirmed.length} ${verifyNote}.`)
    }

    const finalDedup = dedupeFindings([...specConfirmed, ...qualConfirmed])
    const confirmed = finalDedup.kept.map(scoreFinding)
    const dedupMerged = specDedup.merged + qualMerged + finalDedup.merged
    const phase2Skipped = gateTripped

    const blocked = confirmed.some(f => f.impact === 'H' && f.gating)
    const verdict = blocked ? 'BLOCK' : 'APPROVE'
    // The gating I:H survivors that drive the BLOCK — returned so the caller's loop
    // can fingerprint them across rounds (oscillation guard). A high-impact
    // code-quality finding is deferred debt, not a blocker.
    const blockers = confirmed.filter(f => f.impact === 'H' && f.gating).map(f => ({ file: f.file, title: f.title }))
    log(`${phaseTitle}: verdict ${verdict} (${confirmed.length} confirmed finding(s)).`)

    const body = composeComment(confirmed, { phase2Skipped, scopeNote: rprep.scopeNote, dedupMerged, verdict })

    const publish = await agent(
      `You are the terminal publisher for the bug #${ISSUE} fix review. You perform the ONLY write in this review: posting the verdict comment.

CRITICAL — #${ISSUE} is a GitHub ISSUE (a bug), NOT a pull request. There is NO PR for this fix yet. Do NOT look up a PR, do NOT run \`git log\`, do NOT use \`gh pr comment\`, do NOT add/remove any label, do NOT open a PR, do NOT re-review or edit code. The verdict comment goes on the bug ISSUE.

Do EXACTLY these two steps and nothing else — run the second command verbatim:
1. Write the verdict comment body (below) to /tmp/fix-bug-${ISSUE}-review.md.
2. Post it: \`bash skills/operation-git/scripts/post-comment.sh ${ISSUE} /tmp/fix-bug-${ISSUE}-review.md\` (this wraps \`gh issue comment ${ISSUE}\`).
Set posted=true ONLY if that command exited 0; otherwise set posted=false and put the command's actual stderr in error. Never report a "post by hand later" workaround as success or as a non-error — if you did not run the command, that is an error.

--- VERDICT COMMENT BODY (verbatim, write to /tmp/fix-bug-${ISSUE}-review.md) ---
${body}
--- END VERDICT COMMENT BODY ---`,
      { label: 'publish', phase: phaseTitle, schema: PUBLISH, model: WRITER_MODEL },
    )

    // `findings` is the full scored, deduped, confirmed list (each carrying `gating`
    // + `cls`). The caller uses the NON-gating subset for the one-shot quality polish
    // pass and the debt-triage step; gating findings already drove the verdict.
    return { verdict, publishError: publish?.error ?? null, blockers, findings: confirmed }
  } catch (e) {
    return { error: `bug-fix review crashed: ${e?.message || String(e)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reviewEntryAction — the resume probe that runs ONCE before the Review loop and
// decides whether to run the (expensive) fan-out review or skip straight to a fix.
//
// On a FRESH fix there is no prior verdict → review. But on a RELAUNCH (the
// reconcile reaper restarted a dead run), the bug may already carry a standing
// BLOCK verdict that NOTHING has been done about: no commit and no fix-summary
// comment landed on the fix branch after it. Re-running the whole fan-out there
// only reproduces the identical BLOCK and burns the fan-out cost, so we dispatch
// the fix first and let the next loop iteration re-review the landed fix.
//
// A PARTIAL fix that DID land (a commit on origin after the BLOCK) → review: the
// re-review re-evaluates the CURRENT diff and naturally catches whatever remains
// undone. Because every setup-worktree.sh hard-resets the worktree to
// origin/<branch>, the ONLY durable proof a fix landed is a PUSHED commit — a
// partial-or-complete fix that was never committed+pushed is gone on relaunch, so
// "no commit after the BLOCK" is the correct trigger to (re)dispatch the fix.
// Returns { action, lastVerdict, reason }; a missing/garbled probe defaults to the
// pre-existing behavior (review).
// ─────────────────────────────────────────────────────────────────────────────
async function reviewEntryAction(phaseTitle, fixBranch) {
  const r = await agent(
    `Decide how to RESUME the production-code review of the bug-fix for issue #${ISSUE}: re-run the review, or dispatch a fix first. This is a READ-ONLY probe — do NOT edit code, push, run destructive git, or flip labels.

Steps:
1. Read what has landed on the fix branch \`${fixBranch}\`:
   - \`git fetch origin ${fixBranch}\` (ignore failure if the branch is missing — treat as no commits).
   - Branch tip commit date: \`git log -1 --format=%cI origin/${fixBranch}\`.
   - Dates of the bug's own commits: \`git log --format=%cI --grep "Refs #${ISSUE}" origin/${fixBranch}\`.
2. Read the issue comments: \`gh issue view ${ISSUE} --comments\`. Find the NEWEST comment whose body begins with the header \`# Bug Fix Review\` — the latest verdict. Parse its verdict from the \`**Verdict:**\` line (APPROVE or BLOCK) and note its timestamp. Set lastVerdict to that verdict, or null if NO such review comment exists.
3. Decide the action:
   - No prior \`# Bug Fix Review\` comment → action="review" (first pass; nothing reviewed yet).
   - Newest verdict is APPROVE → action="review" (let the loop re-confirm and break).
   - Newest verdict is BLOCK → check whether ANYTHING has been done about it since that comment:
     • a commit on \`origin/${fixBranch}\` authored AFTER the BLOCK comment's timestamp (compare the ISO dates from step 1), OR
     • a later comment that is a fix / work summary (NOT itself a \`# Bug Fix Review\` review comment, and not a halt / need-attention notice).
     If NEITHER exists → action="fix-first" (the BLOCK stands unaddressed; re-reviewing would only reproduce it). If EITHER exists → action="review" (a fix — possibly partial — landed; re-evaluate the current diff).

Return { action, lastVerdict, reason } where reason is one line citing the timestamps / commit you compared.`,
    { label: 'review-entry', phase: phaseTitle, schema: REVIEW_ENTRY, model: AGENT_MODEL },
  )
  return r ?? { action: 'review', lastVerdict: null, reason: 'resume probe returned nothing — defaulting to review' }
}

// ── halt(): the only path to a human ─────────────────────────────────────────
async function halt(reason) {
  log(`HALT bug #${ISSUE}: ${reason}`)
  await agent(
    `The bug #${ISSUE} fix cannot proceed without a human. Do exactly this and nothing else:
1. Write this reason to /tmp/fix-bug-${ISSUE}-halt.md: "${reason}".
2. Post it: \`bash skills/operation-git/scripts/post-comment.sh ${ISSUE} /tmp/fix-bug-${ISSUE}-halt.md\`.
3. Flip the label: \`gh issue edit ${ISSUE} --remove-label "status:in-progress" --add-label "status:need-attention"\`.
Return ok=true (or error set on failure). prNumber=null.`,
    { label: 'halt', phase: 'PR', schema: SIDE_EFFECT },
  )
  return { issue: ISSUE, status: 'need-attention', reason }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Prep — read the bug body + the approved `# Bug Analysis` comment, and
// create-or-reuse the fix branch on origin (idempotent, so a relaunch resumes on
// the same branch with its WIP commits). The regression-test plan from the
// analysis comment is carried forward as the Fix phase's spec.
// ─────────────────────────────────────────────────────────────────────────────
phase('Prep')
const prep = await agent(
  `Prepare the fix for bug issue #${ISSUE}. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`). You may create the fix branch (a write); do NOT edit code, push commits, or open a PR.

Steps:
1. Fetch the bug: \`bash skills/operation-git/scripts/issue-body.sh ${ISSUE} number,title,body,labels,url,milestone\`. If closed/unreadable, return ok=false + haltReason.
2. Read the issue comments and find the NEWEST comment whose header is \`# Bug Analysis\`. This is the approved analysis. If none exists, return ok=false + haltReason ("no approved # Bug Analysis comment"). If its Reproduction verdict is NOT-REPRODUCED, return ok=false + haltReason. If its Contract impact is REQUIRES-CHANGE, return ok=false + haltReason ("bug requires a contract change — reclassify to feature"). Otherwise extract the "Regression-test plan" section text verbatim into regressionPlan.
3. Derive fixBranch = \`fix/${ISSUE}-<intent>\` where <intent> is a short kebab-case slug (≤6 words) from the bug title.
4. Create the fix branch on origin if it does not already exist (idempotent):
   \`git fetch origin main\`
   then if \`git ls-remote --heads origin <fixBranch>\` prints nothing: \`git push origin origin/main:refs/heads/<fixBranch>\`
   (If it already exists, leave it — a prior run may carry WIP commits.)
5. typeScope = the conventional PR-title prefix (e.g. fix(auth)). smokeHint = one short manual smoke a reviewer would run to confirm the bug is gone. milestone = the bug's milestone title (or null).

Return the PREP object.`,
  { phase: 'Prep', schema: PREP },
)
if (!prep || !prep.ok) return halt(prep?.haltReason || 'prep could not read the bug body / approved analysis')

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Fix — one engineer writes the regression test FIRST (RED, per the
// analysis plan), drives it GREEN, refactors, and pushes. The engineer loads
// workflow-engineer-fix-bug; it reads the approved # Bug Analysis comment itself
// for the root cause + regression-test plan (dispatch stays minimal).
// ─────────────────────────────────────────────────────────────────────────────
phase('Fix')
await agent(
  `Fix bug #${ISSUE}.`,
  { agentType: ENGINEER, phase: 'Fix', label: 'fix' },
)

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Review — runReview() fan-out + engineer fix loop until APPROVE. The
// test-coverage dimension is what enforces the regression test fails-before /
// passes-after; full review blocks only on a surviving GATING-dimension I:H
// (spec-compliance / contract / security) — code-quality I:H is deferred debt.
// ─────────────────────────────────────────────────────────────────────────────
phase('Review')
{
  let stall = []
  let lastSpent = tokensSpent()
  let lastReview = null
  // One bounded code-quality polish cycle runs AFTER the gating gate is clean: the
  // first APPROVE dispatches a single engineer fix over the non-gating (deferred-debt)
  // findings, then re-reviews once. `qualityPolished` makes it strictly one cycle — a
  // gating regression introduced by the polish is converged away by the normal BLOCK
  // path (oscillation guard still applies) without re-polishing.
  let qualityPolished = false
  // Resume optimization (see reviewEntryAction): a relaunch onto a bug that already
  // carries a standing BLOCK fix-review with no landed fix skips the redundant
  // re-review and dispatches the engineer fix first; the loop below then re-reviews.
  // A partial fix that DID land falls through to review, which catches the remainder.
  const entry = await reviewEntryAction('Review', prep.fixBranch)
  if (entry.action === 'fix-first') {
    log(`Review: standing BLOCK with no landed fix — ${entry.reason}. Dispatching an engineer fix before the first review.`)
    await agent(
      `Fix the review feedback on bug #${ISSUE}.`,
      { agentType: ENGINEER, phase: 'Review', label: 'fix:resume' },
    )
  }
  for (let round = 1; ; round++) {
    const r = await runReview('Review', prep.fixBranch)
    if (r?.error) return halt(`bug-fix review could not run: ${r.error}`)
    if (r?.publishError) return halt(`bug-fix review verdict was not posted to #${ISSUE}: ${r.publishError}`)
    lastReview = r
    const spent = tokensSpent()
    log(`Review: round ${round} — ${r.verdict}, ${r.blockers.length} gating I:H blocker(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    if (r?.verdict === 'APPROVE') {
      // Gating is clean. Run ONE code-quality polish pass over the non-gating
      // (deferred-debt) findings, then `continue` to re-review exactly once.
      const debt = (r.findings || []).filter(f => !f.gating && f.cls !== 'Drop')
      if (!qualityPolished && debt.length) {
        qualityPolished = true
        log(`Review: gating APPROVE — one code-quality polish pass over ${debt.length} non-blocking finding(s), then re-review.`)
        await agent(
          `Address the code-quality feedback on bug #${ISSUE}. This is the one-shot polish pass AFTER the fix's regression / contract / security gate already APPROVED — fix the non-blocking code-quality findings (the \`Defer\` / \`Nit\` items) in the newest \`# Bug Fix Review\` comment. Production code only, behavior-preserving (existing tests stay green). Whatever you don't get to this pass is fine — it will be triaged into enhancement issues afterward.`,
          { agentType: ENGINEER, phase: 'Review', label: 'fix:quality-polish' },
        )
        continue
      }
      break
    }
    // Oscillation guard: halt if a gating I:H blocker survives STALL_ROUNDS dedicated
    // engineer fixes — structurally stuck, not slow.
    stall = trackStall(stall, r.blockers)
    const stuck = stuckBlockers(stall)
    if (stuck.length)
      return halt(`Bug-fix review stalled — ${stuck.length} gating I:H blocker(s) survived ${STALL_ROUNDS} consecutive engineer fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
    log(`Review: round ${round} returned BLOCK — dispatching an engineer fix and re-reviewing.`)
    await agent(
      `Fix the review feedback on bug #${ISSUE}.`,
      { agentType: ENGINEER, phase: 'Review', label: `fix:${round}` },
    )
  }

  // ── Debt triage: file residual non-gating findings for the /ship maintenance lane,
  // ROUTED BY DIMENSION. After the one polish pass, leftover debt is recorded as issues
  // at `status:ready-to-review` (the human gate — they do NOT auto-implement until a
  // human flips them to `status:ready-to-implement`), rather than holding this fix:
  //   • `non-functional` findings → `kind:enhancement` — they add observable behavior, so
  //     they earn a feature-shaped body with ACs + an e2e task and full E2E coverage.
  //   • every OTHER non-gating dimension → `kind:refactor` — behavior-preserving, so the
  //     body is a `## Tasks` checklist of backend/frontend tasks with NO e2e tasks and NO
  //     ACs (implement-slice then skips all E2E machinery); new tests are unit-only.
  // One issue per dimension in each bucket, deduped against open issues of that kind.
  const debt = (lastReview?.findings || []).filter(f => !f.gating && f.cls !== 'Drop')
  if (debt.length) {
    const groupByDim = (arr) => {
      const m = new Map()
      for (const f of arr) { if (!m.has(f.dimension)) m.set(f.dimension, []); m.get(f.dimension).push(f) }
      return m
    }
    const render = (m) => [...m.entries()].map(([dim, fs]) =>
      `### dimension \`${dim}\` (${fs.length} finding(s))\n` +
      fs.map(f => `  - (I:${f.impact}/E:${f.effort}) ${f.title}\n    file: ${f.file}\n    impact: ${f.impactStatement}\n    fix: ${f.fix}`).join('\n'),
    ).join('\n\n')
    const reDims = groupByDim(debt.filter(f => f.dimension !== 'non-functional'))
    const nfDims = groupByDim(debt.filter(f => f.dimension === 'non-functional'))
    log(`Review: triaging debt — ${reDims.size} group(s) → kind:refactor, ${nfDims.size} → kind:enhancement.`)
    await agent(
      `Triage residual code-quality debt from bug #${ISSUE}'s fix (branch \`${prep.fixBranch}\`) into tracking issues. The fix's regression / contract / security gate already APPROVED and a one-shot polish pass already ran; the findings below are the NON-blocking debt that remains, grouped by review dimension. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`). Do NOT edit code, push, open a PR, or touch bug #${ISSUE}'s \`status:*\` labels.

Create ONE issue per dimension group, deduped FIRST against open issues of the SAME kind (\`gh issue list --label <kind> --state open --limit 100\`; skip a group an open issue already captures and note the skip). Intent = a short kebab slug, e.g. \`<dimension>-debt-bug-${ISSUE}\`.

=== REFACTOR groups -> \`kind:refactor\` (behavior-preserving) ===
For each group below, write a body to \`/tmp/refactor-${ISSUE}-<dim>.md\` containing:
  - a one-line **Context** (behavior-preserving \`<dimension>\` debt surfaced by the fix for bug #${ISSUE});
  - a \`## Tasks\` section — ONE checklist task per finding, in this EXACT shape (NO e2e tasks, NO \`covers:\`, NO \`scenario:\`, NO acceptance criteria):
      \`- [ ] \\\`be.1\\\` · **backend** · blocked-by: — · "<imperative fix, citing file:line>"\`
    (use \`fe.N\` · **frontend** for client-side files; number per type starting at 1; infer backend vs frontend from each finding's file path);
  - a \`## Don't break\` section with one line: "Behavior is preserved — the existing test suite MUST stay green; add unit tests only for any newly-extracted seam."
Then create it: \`bash skills/operation-git/scripts/create-refactor.sh --title "<dimension> debt from bug #${ISSUE}" --body-file /tmp/refactor-${ISSUE}-<dim>.md --intent <kebab-intent>\`.

${reDims.size ? render(reDims) : '(no refactor groups)'}

=== NON-FUNCTIONAL group -> \`kind:enhancement\` (adds observable behavior) ===
For the non-functional group below (if any), write a FEATURE-shaped body to \`/tmp/enh-${ISSUE}-non-functional.md\` containing **Context**, **Proposed change**, a \`## Acceptance criteria (EARS)\` section enumerating the new behavior as \`AC1 …\`, and a \`## Tasks\` checklist that INCLUDES an \`e2e.1\` task plus the backend/frontend tasks (same task shape as above, but the e2e task carries its \`covers:\` + \`scenario:\`). Then create it: \`bash skills/operation-git/scripts/create-enhancement.sh --title "<concise title> (bug #${ISSUE})" --body-file /tmp/enh-${ISSUE}-non-functional.md --intent <kebab-intent>\`.

${nfDims.size ? render(nfDims) : '(no non-functional group)'}

Set ok=true if every group was either filed or intentionally skipped (put any per-group failure in error). prNumber=null.`,
      { label: 'triage-debt', phase: 'Review', schema: SIDE_EFFECT, model: AGENT_MODEL },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE (terminal): open the idempotent draft PR and RELEASE the bug lock. The
// unified command's fix-pr / close-pr stages take it to merge. The PR's
// `Closes #${ISSUE}` line closes the bug on merge.
// ─────────────────────────────────────────────────────────────────────────────
phase('PR')
const prBody = [
  `Closes #${ISSUE}`, '', '## Summary', '',
  `Fix: ${prep.bugTitle}`, '',
  '## Review verdict', '', `Bug-fix review passed on ${TODAY}. See the \`# Bug Fix Review\` comment on #${ISSUE} for finding-level detail. The regression test added with this fix fails on the pre-fix code and passes after.`, '',
  '## Test plan', '', '- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green', `- [ ] Manual smoke: ${prep.smokeHint}`,
].join('\n')

const pr = await agent(
  `Open the terminal draft PR for the bug #${ISSUE} fix. Do exactly this and nothing else:
1. Write the PR body (below) to /tmp/fix-bug-${ISSUE}-pr.md.
2. Create the idempotent draft PR:
   \`bash skills/operation-git/scripts/create-draft-pr.sh ${prep.fixBranch} "${prep.typeScope}: ${prep.bugTitle}" /tmp/fix-bug-${ISSUE}-pr.md --label merge:manual${prep.milestone ? ` --milestone "${prep.milestone}"` : ''}\`
   The script prints the PR number (new or existing). Capture it.
3. Release the bug lock now that the fix is complete: \`gh issue edit ${ISSUE} --remove-label "status:in-progress"\`. The OPEN DRAFT PR is now the durable artifact; the unified command's fix-pr / close-pr stages carry it to merge, and the PR's \`Closes #${ISSUE}\` line closes the bug on merge. (Releasing the lock here is what stops the reconcile reaper from relaunching an already-finished bug.)
Return ok=true, prNumber=<the number>, error=null (or error set on failure).

--- PR BODY (verbatim, write to /tmp/fix-bug-${ISSUE}-pr.md) ---
${prBody}
--- END PR BODY ---`,
  { label: 'open-draft-pr', phase: 'PR', schema: SIDE_EFFECT },
)

return { issue: ISSUE, status: 'pr-open', prNumber: pr?.prNumber ?? null, error: pr?.error ?? null }
