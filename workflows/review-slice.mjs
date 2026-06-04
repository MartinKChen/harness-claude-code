export const meta = {
  name: 'review-slice',
  description: 'Fan-out slice review: spec-gate → quality dims → dedup → adversarial verify → one verdict comment + returned verdict (no label flip, no PR)',
  whenToUse: 'Called as a CHILD workflow by `implement-slice` for both the E2E coverage gate (scope:"coverage", pre-implementation) and the post-implementation slice review (scope:"full"). It posts the verdict comment and RETURNS the verdict object — it flips no label and opens no PR (the parent implement-slice owns those). Pass { slice, scope }.',
  phases: [
    { title: 'Prep', detail: 'worktree + diff + dimension selection (1 agent)', model: 'haiku' },
    { title: 'Spec', detail: 'phase-1 spec-compliance dimensions, fanned out', model: 'sonnet' },
    { title: 'Quality', detail: 'phase-2 code-quality dimensions, fanned out (full scope only, gated)', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial refutation of each deduped finding', model: 'sonnet' },
    { title: 'Publish', detail: 'post verdict comment + return verdict (1 agent)', model: 'haiku' },
  ],
}

// The review fan-out (Spec / Quality / Verify) runs on Sonnet — not the
// orchestrator's inherited model. This workflow is a parallel re-implementation
// of the `reviewer` agent (agents/reviewer.md), which is itself `model: sonnet`;
// pinning here keeps the judgement-bearing fan-out faithful to the single-agent
// reviewer it replaces (and off Opus). Retune in one place via AGENT_MODEL.
const AGENT_MODEL = 'sonnet'

// Prep and Publish carry no review judgement — Prep is tool-orchestration
// (worktree, diff, surface booleans) and Publish is a pure executor (write the
// composed body to a file and post the verdict comment). Both run on Haiku.
// Retune in one place via WRITER_MODEL.
const WRITER_MODEL = 'haiku'

// ─────────────────────────────────────────────────────────────────────────────
// Inputs.  The parent implement-slice workflow passes:
//   args.slice  — the slice issue number under review
//   args.scope  — 'coverage' (gate the authored E2E specs pre-implementation against
//                 the slice AC + pattern-mandated non-happy-paths; spec dims only,
//                 no code yet) or 'full' (the two-phase walk against implemented code).
//                 Defaults to 'full'.
// Everything else (branch, diff, touched surfaces) the prep agent fetches.
// ─────────────────────────────────────────────────────────────────────────────
// `args` should arrive as the parsed object, but a backgrounded Workflow run can
// deliver it as the JSON string instead. Tolerate both — on a string, `args.slice`
// would otherwise resolve to String.prototype.slice (a truthy *function*), slip past
// a plain `if (!SLICE)`, and only blow up much later in structuredClone.
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const SLICE = input.slice
const SCOPE = input.scope === 'coverage' ? 'coverage' : 'full'
if (!/^\d+$/.test(String(SLICE)))
  throw new Error(`review-slice: args.slice must be a slice issue number; got ${typeof SLICE}: ${JSON.stringify(SLICE) ?? String(SLICE)}`)

// ── Dimension catalogue ──────────────────────────────────────────────────────
// One row per pattern-reviewer-* lens. `phase` buckets it into the spec gate vs
// quality fan-out; `applies(surfaces)` is the touched-path trigger from the
// reviewer agent's pattern table. Each dimension agent reads ONLY its own skill
// file and applies ONLY that catalogue — clean context, no cross-pattern dilution.
const DIMENSIONS = [
  // Phase 1 — spec compliance (always walk first; result drives the gate)
  { key: 'test-coverage', phase: 'spec', skill: 'pattern-reviewer-test-coverage', extraSkill: 'pattern-test-coverage', applies: () => true },
  { key: 'contract',      phase: 'spec', skill: 'pattern-reviewer-contract',      applies: s => s.hasContractFiles },
  // Phase 2 — code quality (walk only if the gate stays open)
  { key: 'coding-standard',   phase: 'quality', skill: 'pattern-reviewer-coding-standard',   applies: s => s.backend || s.frontend },
  { key: 'observability',     phase: 'quality', skill: 'pattern-reviewer-observability',     applies: s => s.backend || s.frontend },
  { key: 'security',          phase: 'quality', skill: 'pattern-reviewer-security',          applies: s => s.backend || s.frontend },
  { key: 'backend-standard',  phase: 'quality', skill: 'pattern-reviewer-backend-standard',  applies: s => s.backend },
  { key: 'database',          phase: 'quality', skill: 'pattern-reviewer-database',          applies: s => s.database },
  { key: 'frontend-standard', phase: 'quality', skill: 'pattern-reviewer-frontend-standard', applies: s => s.frontend },
  { key: 'container',         phase: 'quality', skill: 'pattern-reviewer-container',         applies: s => s.container },
  { key: 'fastapi',           phase: 'quality', skill: 'pattern-reviewer-fastapi',           applies: s => s.fastapi },
  { key: 'python',            phase: 'quality', skill: 'pattern-reviewer-python',            applies: s => s.python },
  { key: 'typescript',        phase: 'quality', skill: 'pattern-reviewer-typescript',        applies: s => s.typescript },
  { key: 'vite',              phase: 'quality', skill: 'pattern-reviewer-vite',              applies: s => s.vite },
]

const VERIFY_LENSES = [
  { key: 'correctness', ask: 'Is the claimed defect actually present in THIS code? Read the cited file:line and its surroundings. If the code does not in fact do what the finding claims, it is refuted.' },
  { key: 'context',     ask: 'Did the finder miss surrounding code — a guard, an early return, a caller-side check, an existing test, a framework default — that already neutralises this? If such context exists, it is refuted.' },
  { key: 'severity',    ask: 'Would this actually break in production at the stated impact, or is the severity inflated? If it cannot realistically cause the claimed harm, treat it as refuted (severity does not justify a HIGH).' },
]

// ── JSON schemas (force structured agent output) ─────────────────────────────
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
  properties: {
    dimension: { type: 'string' },
    findings:  { type: 'array', items: FINDING },
  },
  required: ['dimension', 'findings'],
}
const PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:           { type: 'boolean', description: 'slice readable + worktree set up on the slice branch tip' },
    haltReason:   { type: ['string', 'null'] },
    worktreePath: { type: 'string' },
    sliceBranch:  { type: 'string' },
    sliceTitle:   { type: 'string' },
    scopeNote:    { type: ['string', 'null'], description: 'set only if diff scope had to fall back' },
    touchedPaths: { type: 'array', items: { type: 'string' }, description: 'raw `git diff --name-only origin/main..HEAD` paths, unclassified — a downstream Sonnet agent derives surfaces from these' },
  },
  required: ['ok', 'haltReason', 'worktreePath', 'sliceBranch', 'sliceTitle', 'scopeNote', 'touchedPaths'],
}
// Surface classification is the one judgement call in Prep — misclassifying a path
// silently drops a whole review dimension via `applies()`. So it runs on its own
// Sonnet agent, fed the raw touchedPaths the Haiku prep agent returns.
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
const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}
const PUBLISH = {
  type: 'object',
  additionalProperties: false,
  properties: {
    posted: { type: 'boolean' },
    error:  { type: ['string', 'null'] },
  },
  required: ['posted', 'error'],
}

// ── Pure helpers (mechanics live in JS, judgement lives in agents) ────────────
const sevToImpact = s => (s === 'CRITICAL' || s === 'HIGH') ? 'H' : s === 'MEDIUM' ? 'M' : 'L'

// Deterministic projection of (Impact, Effort) → fix-class, per the
// workflow-reviewer-review-slice scoring matrix. `Drop` never reaches the comment.
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

// Conservative cross-dimension dedup: two findings collapse only when they sit on
// the same file (line-insensitive) AND their titles overlap ≥ 0.5 Jaccard. We keep
// the highest-severity representative and record which dimensions co-reported it.
// Over-merging hides real findings, so the bar is deliberately strict.
const SEV_RANK = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 }
function dedupeFindings(all) {
  const kept = []
  let merged = 0
  for (const f of all) {
    const hit = kept.find(k => fileNoLine(k.file) === fileNoLine(f.file) && jaccard(k.title, f.title) >= 0.5)
    if (!hit) {
      kept.push({ ...f, alsoFlaggedBy: [] })
      continue
    }
    merged++
    if (!hit.alsoFlaggedBy.includes(f.dimension)) hit.alsoFlaggedBy.push(f.dimension)
    if (SEV_RANK[f.severity] > SEV_RANK[hit.severity]) {
      // promote to the higher-severity record but preserve the co-report trail
      const trail = hit.alsoFlaggedBy.concat(hit.dimension).filter(d => d !== f.dimension)
      Object.assign(hit, f, { alsoFlaggedBy: Array.from(new Set(trail)) })
    }
  }
  return { kept, merged }
}

function scoreFinding(f) {
  const impact = sevToImpact(f.severity)
  const cls = classify(impact, f.effort)
  return { ...f, impact, cls }
}

function composeComment(scored, { phase2Skipped, scopeNote, dedupMerged, scope, verdict }) {
  const coverage = scope === 'coverage'
  const shown = coverage ? scored : scored.filter(f => f.cls !== 'Drop')
  const impacts = ['H', 'M', 'L'], efforts = ['L', 'M', 'H']
  const count = (i, e) => shown.filter(f => f.impact === i && f.effort === e).length
  const fixNow = shown.filter(f => f.cls === 'Fix').length
  const deferred = shown.filter(f => f.cls === 'Defer').length
  const nits = shown.filter(f => f.cls === 'Nit').length
  const blocked = verdict === 'BLOCK'

  const matrix = [
    '| Impact \\ Effort | E:L (Low) | E:M (Medium) | E:H (High) |',
    '|-----------------|-----------|--------------|------------|',
    `| **I:H** (High)  | ${count('H', 'L')} | ${count('H', 'M')} | ${count('H', 'H')} |`,
    `| **I:M** (Medium)| ${count('M', 'L')} | ${count('M', 'M')} | ${count('M', 'H')} |`,
    `| **I:L** (Low)   | ${count('L', 'L')} | ${count('L', 'M')} | ${count('L', 'H')} |`,
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

  // COVERAGE scope: a single pre-implementation gate over the authored E2E specs.
  // No Phase 1/2 split, no fix-class matrix framing — just the coverage gaps.
  if (coverage) {
    return [
      '# E2E Coverage Gate',
      '',
      `**Verdict:** ${blocked ? 'BLOCK' : 'APPROVE'}`,
      '',
      blocked
        ? `The authored E2E specs do not yet cover every acceptance criterion + mandated non-happy-path. ${shown.length} coverage gap(s) below must be closed before implementation starts.`
        : 'The authored E2E specs cover every acceptance criterion and mandated non-happy-path. Cleared to implement.',
      scopeNote ? `\n**Note:** ${scopeNote}` : '',
      '',
      '## Coverage gaps',
      '',
      shown.length ? shown.map(renderFinding).join('\n\n') : '_No coverage gaps._',
    ].filter(s => s !== '').join('\n')
  }

  const specFindings = shown.filter(f => f.reviewPhase === 'spec')
  const qualFindings = shown.filter(f => f.reviewPhase === 'quality')
  const qualBlock = phase2Skipped
    ? '### Phase 2 — Code quality findings\n\n_Phase 2 (code quality) skipped: Phase 1 produced at least one `I:H` finding. Re-review will run both phases after the engineer fix._'
    : section('Phase 2 — Code quality findings', qualFindings, 'No code-quality findings.')

  return [
    '# Slice Review',
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
    '## Findings',
    '',
    section('Phase 1 — Spec compliance findings', specFindings, 'No spec-compliance findings.'),
    '',
    qualBlock,
  ].filter(s => s !== '').join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Prep — one agent owns all shell/gh work (worktree, diff, surfaces).
// ─────────────────────────────────────────────────────────────────────────────
phase('Prep')
const prep = await agent(
  `You are setting up a READ-ONLY slice review for slice issue #${SLICE} (scope: ${SCOPE}). Do NOT edit, push, or run destructive git. Use the plugin's operation-git scripts exactly as the reviewer workflows do (invoke them as \`bash skills/operation-git/scripts/<name>.sh ...\`).

Steps:
1. Fetch the slice: \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,title,body,labels,url,milestone\`. If the issue is closed or unreadable, return ok=false with a haltReason and leave other fields best-effort. (There is NO review label to check — the parent implement-slice workflow holds the slice's status:in-progress lock; this run does not gate on a label.)
2. Resolve the slice branch: \`bash skills/operation-git/scripts/resolve-slice-branch.sh ${SLICE}\`.
3. Set up the read-only worktree: \`bash skills/operation-git/scripts/setup-worktree.sh <slice-branch>\` (NO --merge-main). Capture the printed worktreePath.
4. Compute the diff vs origin/main inside the worktree: touched paths via \`git -C <worktreePath> diff --name-only origin/main..HEAD\`. If that is empty, set scopeNote explaining the fallback; otherwise scopeNote=null.
5. Return those touched paths verbatim as touchedPaths (the raw path list from step 4). Do NOT classify or interpret them — a separate step derives review surfaces from this list.

Return the PREP object (ok, haltReason, worktreePath, sliceBranch, sliceTitle, scopeNote, touchedPaths). The worktreePath you return will be handed verbatim to every downstream dimension agent — make sure it is correct and the worktree is on the slice branch tip.`,
  { phase: 'Prep', schema: PREP, model: WRITER_MODEL },
)

if (!prep || !prep.ok) {
  const reason = prep?.haltReason || 'prep failed before review could start'
  log(`Halting: ${reason}`)
  // Blocked-run contract: post a diagnostic, return a blocked verdict. Flip nothing.
  await agent(
    `Post a single diagnostic comment on slice issue #${SLICE} explaining that the slice review could not run: "${reason}". Use \`bash skills/operation-git/scripts/post-comment.sh ${SLICE} <body-file>\`. Do NOT add or remove ANY label.`,
    { label: 'publish:blocked', phase: 'Publish', model: WRITER_MODEL },
  )
  return { slice: SLICE, scope: SCOPE, verdict: 'BLOCK', status: 'blocked', reason }
}

// Surface classification on Sonnet — fed the raw paths the Haiku prep agent
// returned. This drives `applies()`, so a misclassification silently drops a
// whole review dimension; keep the judgement on the stronger model.
// COVERAGE scope only runs the test-coverage dimension (applies:()=>true) over
// the authored E2E specs — there is no production code to classify yet — so the
// classification agent is skipped and surfaces default to all-false.
phase('Prep')
const surfaces = SCOPE === 'coverage'
  ? { backend: false, frontend: false, python: false, typescript: false, fastapi: false, database: false, container: false, vite: false, hasContractFiles: false }
  : await agent(
  `Classify the touched paths of slice #${SLICE} into review surfaces. These are the files changed on the slice branch, checked out READ-ONLY at \`${prep.worktreePath}\`. Read paths (and, where the spelling is ambiguous, the file contents in the worktree) before deciding — do NOT guess from extensions alone.

Touched paths:
${prep.touchedPaths.map(p => `- ${p}`).join('\n') || '- (none)'}

Return these booleans:
- backend: server-side application code (handlers, services, domain logic).
- frontend: client UI code.
- python: any .py file touched.
- typescript: any .ts/.tsx file touched.
- fastapi: FastAPI routes/deps/middleware or create_app wiring touched.
- database: ORM models or alembic migrations touched.
- container: Dockerfile/compose/.dockerignore/nginx/entrypoint touched.
- vite: vite.config/vitest.config or import.meta.env usage touched.
- hasContractFiles: any docs/api-contract/*.yaml or docs/data-model/*.yaml exists in the repo (check with \`ls\` in the worktree — this is a repo-existence check, not a touched-path check).

When a path could plausibly belong to a surface, prefer setting the boolean true: a false negative silently skips that review dimension, which is worse than running one extra lens.`,
  { label: 'prep:surfaces', phase: 'Prep', schema: SURFACES, model: AGENT_MODEL },
) ?? { backend: true, frontend: true, python: true, typescript: true, fastapi: true, database: true, container: true, vite: true, hasContractFiles: true }
const diffCtx = `Review the slice branch \`${prep.sliceBranch}\` checked out READ-ONLY at \`${prep.worktreePath}\`. The diff under review is \`git -C ${prep.worktreePath} diff origin/main..HEAD\`. Read the changed files and their surrounding context inside that worktree. Do NOT edit anything.`

// In COVERAGE scope the deliverable under review IS the authored E2E specs, run
// BEFORE any production code exists — so the usual "test files are out of scope"
// rule inverts. The gate judges whether the specs cover every slice AC + the
// pattern-mandated non-happy-paths, not implemented behavior.
const COVERAGE_FRAMING = `This is a PRE-IMPLEMENTATION E2E coverage gate. The E2E spec files authored on this branch ARE the artifact under review — they are IN scope (the usual "test files are out of scope" rule is INVERTED here). There is no production code yet; do NOT report on implementation. Judge ONLY whether the authored specs cover, through the UI, every Acceptance Criterion (EARS) and Gherkin scenario in the slice #${SLICE} body, PLUS the non-happy-paths the catalogue mandates (boundary, validation error, empty, auth/permission, idempotency where applicable). A "finding" is a MISSING or INADEQUATE scenario — cite the spec file:line (or note its absence) and name the uncovered AC/scenario.`

// Shared prompt builder for a single review dimension.
function dimensionPrompt(dim) {
  const extra = dim.extraSkill
    ? ` Also read \`skills/${dim.extraSkill}/SKILL.md\` — it is the catalogue your lens grades against.`
    : ''
  // Per-project memory overlays: the dream pass writes additive rules to
  // `.claude/memory/patterns/<skill>.md`. The full `reviewer` agent applies these
  // via `memory-convention`; the fan-out dimension agent stays anonymous (one
  // pattern, clean context) but must pick up the same overlay so a dreamed rule
  // reaches the dimension that catches the miss. We check the baseline skill plus
  // its extra catalogue (e.g. pattern-test-coverage).
  const overlaySkills = [dim.skill, dim.extraSkill].filter(Boolean)
  const overlayRule = ` **Memory overlay.** Before grading, check whether \`.claude/memory/patterns/<skill>.md\` exists in the repo for ${overlaySkills.map(s => `\`${s}\``).join(' or ')}. If any does, also read \`skills/memory-convention/SKILL.md\` and apply that overlay additively on top of the baseline catalogue (sharpened triggers, project-specific carve-outs, new rules, pinned BAD/GOOD) per the precedence rules there. If none exists, skip — there is nothing to apply.`
  const scopeRule = SCOPE === 'coverage'
    ? `\n\n${COVERAGE_FRAMING}`
    : ` Zero findings is a valid and common result — never invent findings to look thorough. Test files are out of scope where the skill says so.`
  return `${diffCtx}

You are applying ONE review dimension and nothing else. Read \`skills/${dim.skill}/SKILL.md\` and apply ONLY that catalogue to the diff.${extra}${overlayRule}

Honor that skill's Pre-Report Gate and confidence bar (>80% confidence; cite exact file:line; describe the concrete failure mode; read surrounding context before reporting; do not inflate severity).${scopeRule}

For each real finding return: title (one line, NO leading #N), severity (CRITICAL/HIGH/MEDIUM/LOW per the catalogue), effort (L/M/H — your judgement of cost-to-fix-now), file (path:line), impactStatement, effortStatement, fix, lang, and BAD/GOOD snippets. Set dimension="${dim.key}".`
}

// ── VERIFY helper — adversarial refutation of a finding list ──────────────────
// Each finding faces VERIFY_LENSES independent skeptics that read the REAL code;
// it survives only on a majority "not refuted". Replaces the single agent's
// self-attested Pre-Report Gate. Returns the inputs tagged with `survives`.
async function verifyFindings(list, tag) {
  return parallel(list.map(f => () =>
    parallel(VERIFY_LENSES.map(lens => () =>
      agent(
        `${diffCtx}

Adversarially verify a code-review finding. REFUTE it through the "${lens.key}" lens — be a skeptic, not a rubber stamp. ${lens.ask}

If you are uncertain after reading the actual code, default to refuted=true: an unproven finding must not block a slice.

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
        { label: `verify:${tag}:${f.dimension}:${lens.key}`, phase: 'Verify', schema: VERDICT, model: AGENT_MODEL },
      ),
    )).then(votes => {
      const v = votes.filter(Boolean)
      return { ...f, survives: v.filter(x => !x.refuted).length >= 2 } // majority of lenses
    }),
  ))
}

// fan out a dimension set → flat list of findings tagged with their dimension + phase
async function runDimensions(dims, reviewPhase, phaseTitle) {
  return (await parallel(dims.map(d => () =>
    agent(dimensionPrompt(d), { label: `${reviewPhase}:${d.key}`, phase: phaseTitle, schema: FINDINGS, model: AGENT_MODEL }),
  ))).filter(Boolean).flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension, reviewPhase })))
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Spec — fan out phase-1 dimensions, dedup, then VERIFY *before* the gate.
// Verifying first means the gate trips only on a blocker that actually holds up,
// so we never skip the entire quality phase on a finding that wouldn't survive
// scrutiny (which would otherwise let a slice APPROVE with no quality review).
// ─────────────────────────────────────────────────────────────────────────────
phase('Spec')
const specDims = DIMENSIONS.filter(d => d.phase === 'spec' && d.applies(surfaces))
const specDedup = dedupeFindings(await runDimensions(specDims, 'spec', 'Spec'))
const specConfirmed = (await verifyFindings(specDedup.kept, 'spec')).filter(f => f.survives)
log(`Spec: ${specDedup.kept.length} deduped finding(s), ${specConfirmed.length} survived verification.`)

// ── GATE (on VERIFIED spec findings) ──────────────────────────────────────────
// A confirmed blocking spec finding means the implementation will be reworked —
// auditing its quality now is noise that gets churned away. Gating on confirmed
// blockers keeps "Phase 2 skipped" coherent with a BLOCK verdict (a surviving
// I:H spec finding is, by construction, also a BLOCK).
// COVERAGE scope has no production code, so there is never a Phase 2 — the gate
// is always "tripped" there (quality skipped) and the verdict blocks on ANY gap.
const gateTripped = SCOPE === 'coverage' || specConfirmed.some(f => sevToImpact(f.severity) === 'H')
log(SCOPE === 'coverage'
  ? `Coverage gate: ${specConfirmed.length} confirmed gap(s); no quality phase (pre-implementation).`
  : gateTripped
    ? `Gate: a confirmed blocking (I:H) spec finding holds → SKIPPING phase-2 quality dimensions.`
    : `Gate: no confirmed blocking spec finding → running phase-2 quality dimensions.`)

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Quality — fan out phase-2 dimensions (gated), dedup, verify.
// ─────────────────────────────────────────────────────────────────────────────
phase('Quality')
let qualConfirmed = []
let qualMerged = 0
let qualDedupKept = 0
if (!gateTripped) {
  const qualDims = DIMENSIONS.filter(d => d.phase === 'quality' && d.applies(surfaces))
  log(`Quality dimensions selected: ${qualDims.map(d => d.key).join(', ') || '(none — touched surfaces select no quality dimension)'}`)
  const qualDedup = dedupeFindings(await runDimensions(qualDims, 'quality', 'Quality'))
  qualMerged = qualDedup.merged
  qualDedupKept = qualDedup.kept.length
  qualConfirmed = (await verifyFindings(qualDedup.kept, 'quality')).filter(f => f.survives)
  log(`Quality: ${qualDedup.kept.length} deduped finding(s), ${qualConfirmed.length} survived verification.`)
}

// ── COMPOSE (plain code) ──────────────────────────────────────────────────────
// Final cross-phase dedup collapses the rare case where a spec and a quality
// dimension independently confirmed the same defect, so the comment shows it once.
const finalDedup = dedupeFindings([...specConfirmed, ...qualConfirmed])
const confirmed = finalDedup.kept.map(scoreFinding)
const dedupMerged = specDedup.merged + qualMerged + finalDedup.merged
const phase2Skipped = SCOPE === 'full' && gateTripped
log(`Confirmed findings: ${confirmed.length} (dedup merged ${dedupMerged} across the run).`)

// Verdict: coverage blocks on ANY confirmed gap (the specs must fully cover the
// AC before implementation); full blocks only on a confirmed I:H finding.
const blocked = SCOPE === 'coverage'
  ? confirmed.length > 0
  : confirmed.some(f => f.impact === 'H')
const verdict = blocked ? 'BLOCK' : 'APPROVE'

const body = composeComment(confirmed, { phase2Skipped, scopeNote: prep.scopeNote, dedupMerged, scope: SCOPE, verdict })

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Publish — one agent posts the verdict comment. NEW BOUNDARY: this
// workflow flips NO label and opens NO PR. It posts the comment and the script
// RETURNS the verdict object; the parent implement-slice workflow owns the
// label/lock and (on the final APPROVE) the draft PR.
// ─────────────────────────────────────────────────────────────────────────────
phase('Publish')
const publish = await agent(
  `You are the terminal publisher for the slice #${SLICE} ${SCOPE} review. You perform the ONLY write in this workflow: posting the verdict comment. Do not re-review, do not edit code, do NOT add/remove any label, do NOT open a PR.

Do exactly this and nothing else:
1. Write the verdict comment body (provided below) to /tmp/review-slice-${SLICE}.md.
2. Post it: \`bash skills/operation-git/scripts/post-comment.sh ${SLICE} /tmp/review-slice-${SLICE}.md\`.
Return posted=true, error=null (or error set on failure).

--- VERDICT COMMENT BODY (verbatim, write to /tmp/review-slice-${SLICE}.md) ---
${body}
--- END VERDICT COMMENT BODY ---`,
  { label: 'publish:verdict', phase: 'Publish', schema: PUBLISH, model: WRITER_MODEL },
)

return {
  slice: SLICE,
  scope: SCOPE,
  verdict,
  counts: {
    specDeduped: specDedup.kept.length,
    qualityDeduped: qualDedupKept,
    confirmed: confirmed.length,
    refuted: (specDedup.kept.length - specConfirmed.length) + (qualDedupKept - qualConfirmed.length),
    dedupMerged,
    phase2Skipped,
  },
  publishError: publish?.error ?? null,
}
