export const meta = {
  name: 'implement-slice',
  description: 'Drive one slice through author-E2E → coverage gate → plan → implement → pass-E2E → slice-review → fix to an open draft PR',
  whenToUse: 'Launched (background) by the /implement-feature Stage-1 kickoff once per eligible slice, after the orchestrator flips status:ready-to-implement → status:in-progress (the slice lock). Owns the WHOLE inner cycle — including the fan-out review (coverage gate + slice review) inlined as runReviewSlice(); the outer /loop only handles the PR (fix-pr / close-pr). Pass { slice, today }.',
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
// The fan-out review is now INLINED (runReviewSlice below) rather than a child
// workflow, so there is no longer a reviewScriptPath to pass: the v0.40 child-by-
// scriptPath plumbing (and the launch-crash class it guarded against) is gone.
// `args` may arrive as a parsed object or, on a backgrounded run, the JSON string.
// ─────────────────────────────────────────────────────────────────────────────
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const SLICE = input.slice
const TODAY = input.today ?? 'unknown-date'
if (!/^\d+$/.test(String(SLICE)))
  throw new Error(`implement-slice: args.slice must be a slice issue number; got ${typeof SLICE}: ${JSON.stringify(SLICE) ?? String(SLICE)}`)

// No ROUND cap. Each gate / review / implement loop runs until it reaches
// confidence to pass (a review APPROVE, or every task ticked [x]) rather than
// abandoning work after a fixed number of rounds — a real blocker is fixed for
// however many rounds it takes. Two guards make "uncapped" observable rather than
// scary (see the instrumentation block below): every round logs its token delta
// (the cost meter), and the oscillation guard halts to a human only on NO PROGRESS
// — the SAME blocker surviving its own targeted fix for STALL_ROUNDS rounds — not on
// round count. The other halts are genuine infra failures (a review step that can't
// set up its worktree, a verdict that never posted). The review fan-out is tuned to
// surface findings aggressively, and its adversarial verify phase keeps these loops
// from chasing phantom findings: only a finding that survives refutation holds the
// gate open, and `full` review blocks on I:H alone, so once the real blockers are
// fixed the loop converges.

// Subagent types — the plugin's real agents (each loads its own skill stack), not
// the default workflow dimension agent.
const E2E_AUTHOR = 'harness-claude-code:e2e-author'
const ENGINEER   = 'harness-claude-code:engineer'
// axis-reviewer is the single-axis reviewer: one dispatch per applicable pattern,
// each reading ONLY its own catalogue (clean context). The whole-slice `reviewer`
// agent is the single-context fallback for the same rules.
const AXIS_REVIEWER = 'harness-claude-code:axis-reviewer'

// The review fan-out (dimension finders + adversarial verify + surface
// classification) runs on Sonnet; the mechanical prep / publish steps run on
// Haiku. Retune each in one place.
const AGENT_MODEL  = 'sonnet'
const WRITER_MODEL = 'haiku'

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
    covers:    { type: 'array', items: { type: 'string' }, description: 'AC clause ids this task discharges, from the `covers:` field ([] if none)' },
    scenario:  { type: ['string', 'null'], description: 'the Gherkin scenario this task walks at its owning layer, from the `scenario:` field (null if absent)' },
  },
  required: ['id', 'type', 'done', 'blockedBy', 'delivery', 'covers', 'scenario'],
}
// The Scope Manifest — derived ONCE in Prep from the slice body, then carried
// verbatim into every review (coverage gate + slice review) as the closed
// authority for what this slice must prove. It exists to stop the reviews from
// inventing work the issue never authorized: ACs synthesized from prose, or
// backfill tests for behavior the slice never changed. See agents/axis-reviewer.md
// for how each scope consumes it.
const SCOPE_MANIFEST = {
  type: 'object',
  additionalProperties: false,
  properties: {
    acIds:     { type: 'array', items: { type: 'string' }, description: 'the enumerated acceptance-criterion ids (AC1, AC2, …) — the canonical, CLOSED acceptance set. If a clause is not in this list it is not an AC.' },
    dontBreak: { type: 'array', items: { type: 'string' }, description: 'the `## Don\'t break` items verbatim — regression guards on EXISTING behavior (protect the current path), NOT mandates to author new coverage for it.' },
  },
  required: ['acIds', 'dontBreak'],
}
const PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:            { type: 'boolean' },
    haltReason:    { type: ['string', 'null'] },
    sliceTitle:    { type: 'string' },
    sliceBranch:   { type: 'string' },
    milestone:     { type: ['string', 'null'] },
    typeScope:     { type: 'string', description: 'conventional PR-title prefix inferred from the slice, e.g. feat(auth)' },
    smokeHint:     { type: 'string', description: 'one-line manual smoke for the PR test plan' },
    tasks:         { type: 'array', items: TASK },
    scopeManifest: SCOPE_MANIFEST,
  },
  required: ['ok', 'haltReason', 'sliceTitle', 'sliceBranch', 'milestone', 'typeScope', 'smokeHint', 'tasks', 'scopeManifest'],
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
// Returned by the Pass-E2E diagnose stage: the categorized outcome of running the
// slice's E2E suite. `green` = all specs pass (the phase is done). `failures` =
// production-fixable failures, grouped by shared root cause (each group → one serial
// engineer fix dispatch). `need-attention` = at least one failure is a test-case
// constraint (a spec the user / e2e-author must change) — halts the slice.
const E2E_DIAGNOSIS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['green', 'failures', 'need-attention'] },
    reason: { type: ['string', 'null'], description: 'set only when status=need-attention (the test-case constraint to surface to a human)' },
    groups: {
      type: 'array',
      description: 'correlated failure groups (set when status=failures; [] otherwise). Each group shares one production-code root cause and is fixed by ONE engineer dispatch.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          groupId:      { type: 'string' },
          rootCause:    { type: 'string', description: 'shared production-code root-cause hypothesis, to file:line where known' },
          complexity:   { type: 'string', enum: ['L', 'M', 'H'] },
          failingTests: { type: 'array', items: { type: 'string' }, description: 'spec-file::test-title of every failure in this group' },
          fixHint:      { type: 'string', description: 'concrete production-code corrective action + any sibling sites to propagate to' },
        },
        required: ['groupId', 'rootCause', 'complexity', 'failingTests', 'fixHint'],
      },
    },
  },
  required: ['status', 'reason', 'groups'],
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

// ── Review schemas (the inlined fan-out) ─────────────────────────────────────
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
const REVIEW_PREP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok:           { type: 'boolean', description: 'read-only worktree set up on the slice branch tip' },
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
// One verify agent judges a whole batch of same-dimension findings through a
// single lens and returns one verdict PER finding, indexed 1-based against the list
// it was shown. A finding whose index the agent omits counts as refuted — the same
// "uncertain → refuted" default the old per-finding verify enforced.
const BATCH_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index:   { type: 'integer', description: '1-based index of the finding in the list shown to you' },
          refuted: { type: 'boolean' },
          reason:  { type: 'string', description: 'one line, specific to THIS finding (cite what you read)' },
        },
        required: ['index', 'refuted', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}
const PUBLISH = {
  type: 'object',
  additionalProperties: false,
  properties: { posted: { type: 'boolean' }, error: { type: ['string', 'null'] } },
  required: ['posted', 'error'],
}

// ── Review catalogue + verify lenses ─────────────────────────────────────────
// One row per pattern-reviewer-* lens. `phase` buckets it into the spec gate vs
// quality fan-out; `applies(surfaces)` is the touched-path trigger. Each dimension
// agent reads ONLY its own skill and applies ONLY that catalogue.
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

// One verify agent judges at most this many same-dimension findings through one
// lens. Past it, the dimension's findings split into multiple chunks — each chunk
// still gets all three lenses — so no single agent's context is overloaded.
const VERIFY_BATCH_CAP = 10

// ── Pure helpers (mechanics live in JS, judgement lives in agents) ────────────
const sevToImpact = s => (s === 'CRITICAL' || s === 'HIGH') ? 'H' : s === 'MEDIUM' ? 'M' : 'L'

// Deterministic projection of (Impact, Effort) → fix-class. `Drop` never reaches
// the comment.
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

const chunk = (arr, n) => {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// ── Uncapped-loop instrumentation: cost meter + oscillation guard ─────────────
// The fix loops are deliberately UNCAPPED. Two helpers make that safe to watch:
//   1. COST METER — budget.spent() is the shared output-token tally for the whole
//      turn; logging its per-round delta lets a human watching /workflows see cost
//      accrue and step in. tokensSpent() degrades to 0 if budget is unavailable.
//   2. OSCILLATION GUARD — a human escalates on NO PROGRESS, not round count: the
//      SAME blocker surviving its own targeted fix round after round. trackStall()
//      carries a per-blocker streak across rounds (matched by same file +
//      ≥0.5-Jaccard title, reusing the dedup fingerprint); stuckBlockers() trips
//      once a streak reaches STALL_ROUNDS. A loop that keeps RETIRING blockers —
//      even while surfacing new ones — never trips it, so genuine progress runs
//      uncapped exactly as before.
const STALL_ROUNDS = 3
const kb = n => Math.round(n / 1000)
const tokensSpent = () => { try { return budget?.spent?.() ?? 0 } catch { return 0 } }
const sameBlocker = (a, b) => fileNoLine(a.file) === fileNoLine(b.file) && jaccard(a.title, b.title) >= 0.5
const trackStall = (prev, blockers) => blockers.map(b => {
  const carried = prev.find(p => sameBlocker(p, b))
  return { file: b.file, title: b.title, streak: carried ? carried.streak + 1 : 1 }
})
const stuckBlockers = stall => stall.filter(s => s.streak >= STALL_ROUNDS)
const fmtStuck = stuck => stuck.map(s => `\`${s.file}\` — ${s.title} (survived ${s.streak} rounds)`).join('; ')

// Conservative cross-dimension dedup: two findings collapse only when they sit on
// the same file (line-insensitive) AND their titles overlap ≥ 0.5 Jaccard. Keep
// the highest-severity representative and record which dimensions co-reported it.
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
  const coverage = scope === 'test-coverage'
  const shown = coverage ? scored : scored.filter(f => f.cls !== 'Drop')
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

// Lean per-axis dispatch. The stable review framing (recall stance, honesty floor,
// reporting shape, memory-overlay handling, full-vs-coverage rules) lives in the
// axis-reviewer agent (agents/axis-reviewer.md); here we pass only the
// dynamic facts: which one skill, the scope, and where the diff is.
function dimensionPrompt(dim, scope, diffCtx) {
  const extra = dim.extraSkill ? `\n- Grading catalogue: \`skills/${dim.extraSkill}/SKILL.md\`` : ''
  return `${diffCtx}

Apply ONE review dimension to slice #${SLICE} and nothing else.
- Dimension key: ${dim.key}  (set dimension="${dim.key}" on every finding)
- Pattern skill to apply: \`skills/${dim.skill}/SKILL.md\`${extra}
- Scope: ${scope}

Follow your single-axis review contract exactly — read that one skill, apply ONLY its catalogue, honor the ${scope} framing, the recall-over-precision stance, and the honesty floor (zero findings is valid; never fabricate).`
}

// Render the batch of same-dimension findings one lens agent must judge. Each
// finding keeps its own [N] index so the agent reports a discrete verdict per
// finding: the batch is a packaging optimisation that bounds dispatch count, NOT a
// licence to judge the set as a whole.
function verifyBatchPrompt(items, lens, diffCtx) {
  const list = items.map((f, i) => `[${i + 1}] dimension: ${f.dimension}
    title: ${f.title}
    severity: ${f.severity}
    file: ${f.file}
    claim (impact): ${f.impactStatement}
    proposed fix: ${f.fix}
    BAD snippet the finder cited:
    ${f.bad}`).join('\n\n')

  return `${diffCtx}

Adversarially verify ${items.length} code-review finding(s), ALL from the "${items[0].dimension}" dimension, through the "${lens.key}" lens. Be a skeptic, not a rubber stamp. ${lens.ask}

Treat each finding as its OWN investigation: for EVERY finding below, open the cited \`file:line\` (and its surroundings) in the worktree and decide on THAT finding's own evidence. Do NOT judge the batch as a whole, do NOT let one finding's verdict sway another's, and do NOT skim — a verdict you did not actually read the code for is worthless. If you are uncertain about a finding after reading its code, default to refuted=true for THAT finding: an unproven finding must not block a slice.

Findings under scrutiny — the [N] index is what you report each verdict against:

${list}

Return one verdict per finding ({ index, refuted, reason }), covering every index 1..${items.length}.`
}

// Adversarial refutation of a finding list — the precision backstop that keeps the
// uncapped fix loops from chasing phantom findings. Findings are grouped by
// dimension and chunked to VERIFY_BATCH_CAP, so one agent never drowns; each
// (dimension, chunk) faces VERIFY_LENSES independent skeptics and a finding survives
// only on a majority "not refuted" across the three lenses. Batching collapses the
// dispatch count from 3×findings to 3×chunks-per-dimension WITHOUT touching the
// cross-lens majority vote — and the prompt still forces per-finding investigation.
async function verifyFindings(list, tag, diffCtx, phaseTitle) {
  const byDim = new Map()
  for (const f of list) {
    if (!byDim.has(f.dimension)) byDim.set(f.dimension, [])
    byDim.get(f.dimension).push(f)
  }
  const batches = []
  for (const [dim, dimFindings] of byDim) {
    const chunks = chunk(dimFindings, VERIFY_BATCH_CAP)
    chunks.forEach((items, bi) => batches.push({ dim, items, bi, multi: chunks.length > 1 }))
  }

  const verified = await parallel(batches.map(({ dim, items, bi, multi }) => () =>
    parallel(VERIFY_LENSES.map(lens => () =>
      agent(verifyBatchPrompt(items, lens, diffCtx),
        { label: `verify:${tag}:${dim}:${lens.key}${multi ? `:b${bi + 1}` : ''}`, phase: phaseTitle, schema: BATCH_VERDICT, model: AGENT_MODEL },
      ),
    )).then(lensResults => {
      // One BATCH_VERDICT per lens (null if that lens agent failed). A finding
      // survives when ≥2 lenses returned an explicit not-refuted verdict for its
      // index; a missing or null verdict counts as refuted (conservative default).
      const live = lensResults.filter(Boolean)
      return items.map((f, i) => {
        const idx = i + 1
        const notRefuted = live.filter(r => {
          const v = (r.verdicts || []).find(x => x.index === idx)
          return v && !v.refuted
        }).length
        return { ...f, survives: notRefuted >= 2 } // majority of lenses
      })
    }),
  ))
  return verified.flat()
}

// Fan out a dimension set → flat list of findings tagged with their dimension + phase.
async function runDimensions(dims, reviewPhase, phaseTitle, scope, diffCtx) {
  return (await parallel(dims.map(d => () =>
    agent(dimensionPrompt(d, scope, diffCtx), { agentType: AXIS_REVIEWER, label: `${reviewPhase}:${d.key}`, phase: phaseTitle, schema: FINDINGS, model: AGENT_MODEL }),
  ))).filter(Boolean).flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension, reviewPhase })))
}

// ─────────────────────────────────────────────────────────────────────────────
// runReviewSlice — the inlined fan-out review (was the review-slice child
// workflow). Sets up a read-only worktree on the slice branch tip, fans out the
// applicable dimensions, dedups, adversarially verifies, composes ONE verdict
// comment, posts it, and RETURNS the verdict object. Flips no label, opens no PR.
//   scope      — 'test-coverage' (gate authored E2E specs pre-implementation) or
//                'production-code' (audit implemented code)
//   phaseTitle — the parent phase to group the fan-out agents under
//                ('Coverage gate' or 'Slice review')
//   sliceBranch — resolved once in Prep; reused here to skip re-resolution
//   scopeManifest — the closed { acIds, dontBreak } authority from Prep; rendered
//                into diffCtx so every dimension agent AND every adversarial
//                verifier judges findings against the same bounded scope (cover
//                exactly the closed AC set, no prose-synthesized ACs).
//   tasks      — the parsed `## Tasks` ledger from Prep; rendered as the per-task
//                discharge ledger so the test-coverage / contract axes can judge
//                each task against its OWNING LAYER (Principle 1) and verify, per
//                task, that its `covers:` AC clause is discharged at that layer and
//                its `scenario:` is walked there — a backend invariant proven at
//                the backend layer, never re-asserted through E2E.
// Returns { verdict: 'APPROVE'|'BLOCK', publishError } on success, or { error } on
// any infra failure (worktree setup, an uncaught throw). The whole body is
// try/caught so a crash surfaces as { error } and the caller halt()s to a human,
// never killing the run uncaught.
// ─────────────────────────────────────────────────────────────────────────────
async function runReviewSlice(scope, phaseTitle, sliceBranch, scopeManifest, tasks) {
  try {
    // ── Prep: read-only worktree + diff ──
    const rprep = await agent(
      `You are setting up a READ-ONLY ${scope} review of slice #${SLICE}. Do NOT edit, push, or run destructive git. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`).

Steps:
1. Set up the read-only worktree on the slice branch \`${sliceBranch}\`: \`bash skills/operation-git/scripts/setup-worktree.sh ${sliceBranch}\` (NO --merge-main). Capture the printed worktreePath. If it fails, return ok=false with a haltReason.
2. Compute the touched paths vs origin/main inside the worktree: \`git -C <worktreePath> diff --name-only origin/main..HEAD\`. If that is empty, set scopeNote explaining the fallback; otherwise scopeNote=null.
3. Return those touched paths verbatim as touchedPaths (the raw list) — do NOT classify or interpret them.

Return the REVIEW_PREP object. The worktreePath you return is handed verbatim to every downstream dimension agent — make sure it is correct and on the slice branch tip.`,
      { label: `review-prep:${scope}`, phase: phaseTitle, schema: REVIEW_PREP, model: WRITER_MODEL },
    )
    if (!rprep || !rprep.ok)
      return { error: rprep?.haltReason || `${scope} review could not set up a read-only worktree on ${sliceBranch}` }

    // Surface classification on Sonnet — drives applies(), so a misclassification
    // silently drops a whole dimension; keep it on the stronger model. Coverage
    // scope has no production code, so it runs only the test-coverage dimension and
    // surfaces default to all-false.
    const surfaces = scope === 'test-coverage'
      ? { backend: false, frontend: false, python: false, typescript: false, fastapi: false, database: false, container: false, vite: false, hasContractFiles: false }
      : (await agent(
        `Classify the touched paths of slice #${SLICE} into review surfaces. These files changed on the slice branch, checked out READ-ONLY at \`${rprep.worktreePath}\`. Read paths (and, where the spelling is ambiguous, the file contents in the worktree) before deciding — do NOT guess from extensions alone.

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
        { label: `review-surfaces:${scope}`, phase: phaseTitle, schema: SURFACES, model: AGENT_MODEL },
      ) ?? { backend: true, frontend: true, python: true, typescript: true, fastapi: true, database: true, container: true, vite: true, hasContractFiles: true })

    const sm = scopeManifest || { acIds: [], dontBreak: [] }
    const fmtList = (xs, wrap) => xs.length ? xs.map(wrap).join(', ') : '(none declared)'
    const manifestBlock = `
## Scope Manifest (the CLOSED authority for slice #${SLICE} — derived once from the issue body; do not widen it)
- **Acceptance criteria (closed set):** ${sm.acIds.length ? sm.acIds.join(', ') : '(none enumerated)'} — the canonical AC ids. Treat this as exhaustive: do NOT synthesize an AC from prose, a comment, or a Gherkin line that has no id in this list.
- **Don't-break (regression guards):** ${fmtList(sm.dontBreak, s => `"${s}"`)} — existing behavior to protect from regression. These guard the CURRENT path; they are NOT a mandate to author new coverage for it.

Apply this manifest exactly as your scope's rules in agents/axis-reviewer.md direct (test-coverage: cover exactly the AC ids + their Gherkin; production-code: every finding must ground in a declared AC id or a touched-path rule).`

    // Per-task discharge ledger: each task's owning layer is its type (backend →
    // HTTP endpoint / worker; frontend → rendered tree; e2e → browser journey),
    // and `covers:` names the AC clause(s) it discharges, `scenario:` the Gherkin
    // it walks AT that layer. The test-coverage / contract axes use this to verify,
    // per task, that the clause is discharged at the lowest faithful layer and
    // asserted once — never demanding a backend invariant be re-proven through E2E.
    const taskLedger = (tasks || []).filter(t => t.done)
    const layerOf = t => t.type === 'e2e' ? 'true-E2E (browser, live stack)' : t.type === 'backend' ? 'backend integration (HTTP endpoint / worker tick)' : 'frontend (rendered/routed tree, API mocked at src/lib/api)'
    const ledgerBlock = taskLedger.length ? `
## Task discharge ledger (each task is proven at its OWNING LAYER)
${taskLedger.map(t => `- \`${t.id}\` · ${t.type} → owning layer: ${layerOf(t)} · covers: ${t.covers?.length ? t.covers.join(', ') : '(none)'} · scenario: ${t.scenario ? `"${t.scenario}"` : '(none)'}`).join('\n')}

Judge each task against its owning layer: the \`covers:\` AC clause must be discharged THERE (deletable-code lens — deleting the production branch/mutation/derivation makes some test fail), the \`scenario:\` must be walked THERE, and it is asserted ONCE. Do NOT flag a backend invariant for "missing E2E coverage" — a ledger delta / token-state / "no row created" clause is owned by the backend layer and proven by an API-level test, never through the UI.` : ''

    const diffCtx = `Review the slice branch \`${sliceBranch}\` checked out READ-ONLY at \`${rprep.worktreePath}\`. The diff under review is \`git -C ${rprep.worktreePath} diff origin/main..HEAD\`. Read the changed files and their surrounding context inside that worktree. Do NOT edit anything.
${manifestBlock}${ledgerBlock}`

    // ── Spec: fan out phase-1 dimensions, dedup, then VERIFY *before* the gate, so
    // the gate trips only on a blocker that actually survives scrutiny. ──
    const specDims = DIMENSIONS.filter(d => d.phase === 'spec' && d.applies(surfaces))
    const specDedup = dedupeFindings(await runDimensions(specDims, 'spec', phaseTitle, scope, diffCtx))
    const specConfirmed = (await verifyFindings(specDedup.kept, 'spec', diffCtx, phaseTitle)).filter(f => f.survives)
    log(`${phaseTitle}: spec ${specDedup.kept.length} deduped, ${specConfirmed.length} survived verification.`)

    // GATE (on VERIFIED spec findings). A confirmed blocking spec finding means the
    // implementation will be reworked, so auditing quality now is churn. Coverage
    // scope has no Phase 2 (no production code) — the gate is always "tripped".
    const gateTripped = scope === 'test-coverage' || specConfirmed.some(f => sevToImpact(f.severity) === 'H')

    // ── Quality: fan out phase-2 dimensions (gated), dedup, verify. ──
    let qualConfirmed = []
    let qualMerged = 0
    let qualDedupKept = 0
    if (!gateTripped) {
      const qualDims = DIMENSIONS.filter(d => d.phase === 'quality' && d.applies(surfaces))
      log(`${phaseTitle}: quality dimensions ${qualDims.map(d => d.key).join(', ') || '(none)'}`)
      const qualDedup = dedupeFindings(await runDimensions(qualDims, 'quality', phaseTitle, scope, diffCtx))
      qualMerged = qualDedup.merged
      qualDedupKept = qualDedup.kept.length
      qualConfirmed = (await verifyFindings(qualDedup.kept, 'quality', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: quality ${qualDedup.kept.length} deduped, ${qualConfirmed.length} survived verification.`)
    }

    // ── Compose (plain code). Final cross-phase dedup collapses the rare case a
    // spec and a quality dimension confirmed the same defect. ──
    const finalDedup = dedupeFindings([...specConfirmed, ...qualConfirmed])
    const confirmed = finalDedup.kept.map(scoreFinding)
    const dedupMerged = specDedup.merged + qualMerged + finalDedup.merged
    const phase2Skipped = scope === 'production-code' && gateTripped

    // Verdict: coverage blocks on ANY confirmed gap; full blocks only on a
    // confirmed I:H finding.
    const blocked = scope === 'test-coverage' ? confirmed.length > 0 : confirmed.some(f => f.impact === 'H')
    const verdict = blocked ? 'BLOCK' : 'APPROVE'
    // The findings that actually drive the BLOCK — coverage: every confirmed gap;
    // production: the I:H survivors. Returned so the caller's loop can fingerprint
    // them across rounds (oscillation guard).
    const blockers = (scope === 'test-coverage' ? confirmed : confirmed.filter(f => f.impact === 'H'))
      .map(f => ({ file: f.file, title: f.title }))
    log(`${phaseTitle}: verdict ${verdict} (${confirmed.length} confirmed finding(s)).`)

    const body = composeComment(confirmed, { phase2Skipped, scopeNote: rprep.scopeNote, dedupMerged, scope, verdict })

    // ── Publish: post the verdict comment on the slice ISSUE. The ONLY write. ──
    const publish = await agent(
      `You are the terminal publisher for the slice #${SLICE} ${scope} review. You perform the ONLY write in this review: posting the verdict comment.

CRITICAL — #${SLICE} is a GitHub ISSUE (a slice), NOT a pull request. There is NO PR for this slice yet. Do NOT look up a PR, do NOT run \`git log\`, do NOT use \`gh pr comment\`, do NOT add/remove any label, do NOT open a PR, do NOT re-review or edit code. The verdict comment goes on the slice ISSUE.

Do EXACTLY these two steps and nothing else — run the second command verbatim:
1. Write the verdict comment body (below) to /tmp/review-slice-${SLICE}.md.
2. Post it: \`bash skills/operation-git/scripts/post-comment.sh ${SLICE} /tmp/review-slice-${SLICE}.md\` (this wraps \`gh issue comment ${SLICE}\`).
Set posted=true ONLY if that command exited 0; otherwise set posted=false and put the command's actual stderr in error. Never report a "post by hand later" workaround as success or as a non-error — if you did not run the command, that is an error.

--- VERDICT COMMENT BODY (verbatim, write to /tmp/review-slice-${SLICE}.md) ---
${body}
--- END VERDICT COMMENT BODY ---`,
      { label: `publish:${scope}`, phase: phaseTitle, schema: PUBLISH, model: WRITER_MODEL },
    )

    return { verdict, publishError: publish?.error ?? null, blockers }
  } catch (e) {
    return { error: `${scope} review crashed: ${e?.message || String(e)}` }
  }
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
2. Parse the \`## Tasks\` checklist from the body. Each entry is a checkbox line plus a follow-on line, e.g.:
   \`- [ ] \\\`be.1\\\` · **backend** · blocked-by: \\\`e2e.1\\\` · "POST /widgets …"\` (or \`[x]\` when done)
   \`      covers: AC1, AC3 · scenario: "Schedule moves 1 credit to held" · contract: docs/api-contract/...\`
   For each task return { id (short form, e.g. be.1), type (e2e|backend|frontend), done (true iff [x]), blockedBy (the ids in the blocked-by field, [] if "—"), delivery (the quoted text), covers (the AC ids in the \`covers:\` field, e.g. ["AC1","AC3"]; [] if absent), scenario (the quoted \`scenario:\` text, or null if absent) }.
3. Resolve the slice branch: \`bash skills/operation-git/scripts/resolve-slice-branch.sh ${SLICE}\` → sliceBranch.
4. typeScope = the conventional PR-title prefix you infer from the slice (e.g. feat(auth)). smokeHint = one short manual smoke a reviewer would run. milestone = the slice's milestone title (or null).
5. Derive the **Scope Manifest** from the same body — this is the closed authority the downstream reviews are bounded by, so transcribe it faithfully and do NOT invent entries:
   - \`acIds\` ← the enumerated acceptance-criterion ids only (the \`AC1\`, \`AC2\`, … labels), in order. The canonical, closed AC set — capture the IDs, not the prose, and do NOT mint new ids from sentences that lack a label.
   - \`dontBreak\` ← the \`## Don't break\` items verbatim, one string each. These are regression guards on existing behavior; capture them as written (absent section → \`[]\`).

Return the PREP object (including scopeManifest).`,
  { phase: 'Prep', schema: PREP },
)
if (!prep || !prep.ok) return halt(prep?.haltReason || 'prep could not read the slice body')

// In-memory done-tracking, seeded from the durable checklist and updated as each
// dispatch completes. (Agents also tick the boxes in the body — the durable copy
// — but within this run we trust our local model for skip decisions.)
const done = new Set(prep.tasks.filter(t => t.done).map(t => t.id))
const e2eTasks = prep.tasks.filter(t => t.type === 'e2e')
const implTasks = prep.tasks.filter(t => t.type !== 'e2e')

// Snapshot the E2E coverage state from the durable checklist BEFORE Phase A
// authoring mutates `done`. The coverage gate (Phase B) is bypassed when EITHER:
//   1. the slice has no e2e tasks (nothing to cover), or
//   2. every e2e task was already ticked [x] on entry — a prior run already
//      authored the specs AND passed the gate, so re-gating is redundant.
// Computed here (not inline at Phase B) because Phase A adds freshly-authored ids
// to `done`; reading it there would make condition 2 spuriously true the moment
// brand-new specs are written, skipping the gate that should vet them.
const allE2EAlreadyDone = e2eTasks.length > 0 && e2eTasks.every(t => done.has(t.id))

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
// PHASE B: Coverage gate — runReviewSlice('test-coverage'), looping to an e2e-author
// fix until the specs cover every AC + non-happy-path. Bypassed when the slice has
// no e2e tasks (nothing to gate) OR every e2e task was already marked done on entry
// (a prior run already passed this gate).
// ─────────────────────────────────────────────────────────────────────────────
phase('Coverage gate')
if (e2eTasks.length && !allE2EAlreadyDone) {
  let stall = []
  let lastSpent = tokensSpent()
  for (let round = 1; ; round++) {
    const r = await runReviewSlice('test-coverage', 'Coverage gate', prep.sliceBranch, prep.scopeManifest, prep.tasks)
    if (r?.error) return halt(`E2E coverage gate could not run: ${r.error}`)
    // A set publishError means the verdict comment never reached GitHub. The gate's
    // findings would then be invisible to the fix loop — halt rather than loop blind
    // or APPROVE on an unposted verdict.
    if (r?.publishError) return halt(`E2E coverage gate verdict was not posted to #${SLICE}: ${r.publishError}`)
    const spent = tokensSpent()
    log(`Coverage gate: round ${round} — ${r.verdict}, ${r.blockers.length} gap(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    if (r?.verdict === 'APPROVE') break
    // Oscillation guard: halt if a coverage gap survives STALL_ROUNDS dedicated
    // e2e-author fixes — the loop is stuck, not slow.
    stall = trackStall(stall, r.blockers)
    const stuck = stuckBlockers(stall)
    if (stuck.length)
      return halt(`E2E coverage gate stalled — ${stuck.length} gap(s) survived ${STALL_ROUNDS} consecutive e2e-author fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
    log(`Coverage gate: round ${round} returned BLOCK — dispatching an e2e-author fix and re-gating.`)
    await agent(
      `Fix E2E coverage feedback on slice #${SLICE}.`,
      { agentType: E2E_AUTHOR, phase: 'Coverage gate', label: `coverage-fix:${round}` },
    )
  }
} else {
  log(e2eTasks.length
    ? 'Coverage gate: all e2e tasks already marked done on entry — skipping.'
    : 'Coverage gate: no e2e tasks — skipping.')
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
// An engineer killed mid-run (memory pressure) returns control here with its tasks
// only partially ticked; an `await agent()` that simply RETURNS is not proof the
// work finished — trusting it blindly would carry an unfinished slice into Pass E2E
// / review (and Pass E2E is skipped entirely on e2e-less slices, leaving no net).
// The engineer's own done-signal is the ticked `## Tasks` box, so re-reading those
// boxes is the completion proof. A re-dispatch resumes from the slice branch's WIP
// commits, so retrying an interrupted group is cheap, and the loop re-dispatches
// until every task in the group is ticked — no retry cap. (A mid-run kill that
// throws instead of returning crashes the whole run — recovered separately by the
// reconcile reaper relaunching implement-slice, whose Prep re-reads the live
// checklist. This loop covers the silent partial-completion case.)
// ─────────────────────────────────────────────────────────────────────────────
phase('Implement')
for (const g of groups) {
  let todo = g.taskIds.filter(id => !done.has(id))
  if (!todo.length) { log(`Implement: group ${g.groupId} already done — skipping.`); continue }
  for (let attempt = 1; todo.length; attempt++) {
    const ids = todo.join(',')
    await agent(
      `Implement slice #${SLICE} tasks ${ids}.`,
      { agentType: ENGINEER, phase: 'Implement', label: attempt > 1 ? `implement:${ids}:retry${attempt - 1}` : `implement:${ids}` },
    )
    const check = await agent(
      `Read slice #${SLICE} and report which of these tasks are NOT yet done. Do NOT edit code, push, or flip labels.
Steps:
1. \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,body\`.
2. Parse the \`## Tasks\` checklist. For each id in [${ids}], a box ticked \`[x]\` is DONE; \`[ ]\` is still open.
Return openIds = the subset of [${ids}] whose checkbox is still \`[ ]\` (empty array if every one is ticked).`,
      { phase: 'Implement', label: `verify:${ids}`, schema: COMPLETION, model: WRITER_MODEL },
    )
    // A missing / garbled verification keeps the whole group open (re-dispatch)
    // rather than falsely advancing on an unconfirmed result.
    const open = check ? todo.filter(id => check.openIds.includes(id)) : todo
    todo.filter(id => !open.includes(id)).forEach(id => done.add(id))
    todo = open
    if (todo.length)
      log(`Implement: group ${g.groupId} left ${todo.join(',')} unticked after dispatch ${attempt} — re-dispatching the remainder.`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE E: Pass E2E — a two-stage diagnose → fix loop (was one all-in-one engineer
// dispatch). Each round:
//   Stage 1 (diagnose) — ONE engineer integrates origin/main, boots the stack, runs
//     the slice's E2E specs, and CATEGORIZES any failures into correlated root-cause
//     groups. It edits no production code; a test-case constraint (a spec only the
//     user / e2e-author can fix) halts the slice.
//   Stage 2 (fix) — one engineer PER correlated group, dispatched SERIALLY (all share
//     the one slice worktree, so only one edit happens at a time — same discipline as
//     Phase D). Fixers drive production code only and push; they do NOT re-boot the
//     stack — the next round's diagnose re-runs the whole suite to verify.
// The loop is uncapped (consistent with the rest of this file): it converges when a
// round diagnoses green, and the only halt is the test-case-constraint bail.
// ─────────────────────────────────────────────────────────────────────────────
phase('Pass E2E')
if (e2eTasks.length) {
  let stall = []
  let lastSpent = tokensSpent()
  for (let round = 1; ; round++) {
    // Stage 1 — diagnose: integrate main, boot, run, categorize. No production edits.
    const diag = await agent(
      `Diagnose E2E acceptance for slice #${SLICE}.`,
      { agentType: ENGINEER, phase: 'Pass E2E', label: `e2e-diagnose:${round}`, schema: E2E_DIAGNOSIS },
    )
    if (!diag) return halt('E2E diagnosis dispatch returned nothing')
    if (diag.status === 'need-attention')
      return halt(diag.reason || 'E2E acceptance could not be reached without editing a spec')
    const spent = tokensSpent()
    if (diag.status === 'green') {
      log(`Pass E2E: green after ${round - 1} fix round(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
      break
    }

    const groups = diag.groups ?? []
    // A diagnosis that reports failures but produces no fix groups is unactionable —
    // halt rather than spin a fixless round forever.
    if (!groups.length) return halt('E2E diagnosis reported failures but produced no fix groups')
    // Fingerprint each failing test (spec-file::test-title) as a blocker so the
    // oscillation guard can detect a test that survives its own fix round after round.
    const failing = groups.flatMap(g => g.failingTests).map(t => {
      const ix = String(t).indexOf('::')
      return ix >= 0 ? { file: t.slice(0, ix), title: t.slice(ix + 2) } : { file: '', title: String(t) }
    })
    log(`Pass E2E: round ${round} — ${groups.length} failure group(s), ${failing.length} failing test(s): ${groups.map(g => `${g.groupId}(${g.complexity})`).join(', ')}; +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    stall = trackStall(stall, failing)
    const stuck = stuckBlockers(stall)
    if (stuck.length)
      return halt(`Pass E2E stalled — ${stuck.length} E2E failure(s) survived ${STALL_ROUNDS} consecutive fix rounds unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)

    // Stage 2 — fix: one engineer per correlated group, SERIAL (shared worktree, one
    // edit at a time). No boot here; the next round's diagnose re-runs the suite.
    for (const g of groups) {
      await agent(
        `Fix E2E failures on slice #${SLICE} — group ${g.groupId}.
Root cause: ${g.rootCause}
Failing tests: ${g.failingTests.join('; ')}
Fix: ${g.fixHint}`,
        { agentType: ENGINEER, phase: 'Pass E2E', label: `e2e-fix:${round}:${g.groupId}` },
      )
    }
  }
} else {
  log('Pass E2E: no e2e tasks — skipping.')
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE F: Slice review — runReviewSlice('production-code'), looping to an engineer fix-slice
// until APPROVE.
// ─────────────────────────────────────────────────────────────────────────────
phase('Slice review')
{
  let stall = []
  let lastSpent = tokensSpent()
  for (let round = 1; ; round++) {
    const r = await runReviewSlice('production-code', 'Slice review', prep.sliceBranch, prep.scopeManifest, prep.tasks)
    if (r?.error) return halt(`slice review could not run: ${r.error}`)
    // Unposted verdict (see the coverage-gate note above): the findings never reached
    // #${SLICE}, so a BLOCK would loop blind and an APPROVE would open a PR whose
    // "see the # Slice Review comment" body points at a comment that doesn't exist.
    if (r?.publishError) return halt(`slice review verdict was not posted to #${SLICE}: ${r.publishError}`)
    const spent = tokensSpent()
    log(`Slice review: round ${round} — ${r.verdict}, ${r.blockers.length} I:H blocker(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    if (r?.verdict === 'APPROVE') break
    // Oscillation guard: halt if an I:H blocker survives STALL_ROUNDS dedicated
    // engineer fixes — structurally stuck, not slow.
    stall = trackStall(stall, r.blockers)
    const stuck = stuckBlockers(stall)
    if (stuck.length)
      return halt(`Slice review stalled — ${stuck.length} I:H blocker(s) survived ${STALL_ROUNDS} consecutive engineer fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
    log(`Slice review: round ${round} returned BLOCK — dispatching an engineer fix and re-reviewing.`)
    await agent(
      `Fix the review feedback on slice #${SLICE}.`,
      { agentType: ENGINEER, phase: 'Slice review', label: `fix:${round}` },
    )
  }

  // ── AC-tick: the reviewer-gated VERIFIED GATE (vs. the engineer's task-box claim). ──
  // The engineer self-ticks TASK boxes as a progress claim; the reviewer ticks the
  // AC boxes — and only that AC tick is the verified gate. A production-code APPROVE
  // means no I:H spec-compliance finding survived, i.e. every AC's `covers:` task was
  // discharged at its owning layer (the test-coverage axis blocks I:H on any
  // undischarged AC). So on APPROVE we flip every `- [ ] AC<n>` → `- [x] AC<n>`. A
  // re-run that re-enters on an already-APPROVE'd slice just re-ticks idempotently.
  const acIds = prep.scopeManifest?.acIds ?? []
  if (acIds.length) {
    await agent(
      `The slice #${SLICE} production-code review has APPROVED — every acceptance criterion is now discharged at its owning layer. Tick the AC checkboxes in the slice body (the reviewer's VERIFIED GATE; the engineer only ticks task boxes). Do exactly this:
1. \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,body\` to read the current body.
2. In the \`## Acceptance criteria (EARS)\` section, flip each unchecked AC checkbox \`- [ ] AC<n> — …\` to \`- [x] AC<n> — …\` for these ids: ${acIds.join(', ')}. Leave the AC text and every other line byte-for-byte unchanged; touch ONLY the \`[ ]\`→\`[x]\` of those AC lines (NOT task lines).
3. Write the edited full body to /tmp/ac-tick-${SLICE}.md and apply it: \`gh issue edit ${SLICE} --body-file /tmp/ac-tick-${SLICE}.md\`.
Return ok=true (or error set on failure). prNumber=null.`,
      { label: 'tick-acs', phase: 'Slice review', schema: SIDE_EFFECT, model: WRITER_MODEL },
    )
  }
}

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
