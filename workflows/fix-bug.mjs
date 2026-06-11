export const meta = {
  name: 'fix-bug',
  description: 'Drive one approved kind:bug issue through regression-test RED → fix GREEN (verified by running the test) → refactor → gate review (regression/contract/security fix loop until APPROVE) → quality review (one code-quality fix cycle + one re-review, residual triaged into refactor/enhancement issues) → open draft PR',
  whenToUse: 'Launched (background) by the unified implement command kickoff once per eligible kind:bug, after a human approved the `# Bug Analysis` comment and the orchestrator flipped status:ready-to-implement → status:in-progress (the bug lock). Owns the post-approval automatic half: it creates the fix branch, writes the regression test first, drives it green (a completion check re-runs the planned regression test and re-dispatches an engineer that returned without finishing), runs the fan-out reviews (inlined as runReview(): gate review + quality review), loops the gating fix until APPROVE, opens a merge:manual draft PR, and releases the lock. A relaunch resumes from the durable # Bug Fix Gate Review verdict comment — an APPROVE still at the fix-branch tip skips Fix + Gate review, and the loop guards re-seed from the newest BLOCK. Pass { issue, today }.',
  phases: [
    { title: 'Prep' },
    { title: 'Fix' },
    { title: 'Gate review' },
    { title: 'Quality review' },
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
// Round-1 recall sampling (issue #47, mirrored from implement-slice): the FIRST
// gate-review round fans every gating dimension out K× in parallel and unions the
// samples through dedup; anchored re-review rounds stay at 1 sample. The
// orchestrator may thread $HCC_ROUND1_SAMPLES through args.round1Samples;
// default 2, floor 1.
const ROUND1_SAMPLES = Math.max(1, parseInt(input.round1Samples, 10) || 2)
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
    headSha:      { type: 'string', description: 'the worktree HEAD commit sha (`git rev-parse HEAD`) — the exact commit this review judges' },
    scopeNote:    { type: ['string', 'null'], description: 'set only if diff scope had to fall back' },
    touchedPaths: { type: 'array', items: { type: 'string' }, description: 'raw `git diff --name-only origin/main..HEAD` paths, unclassified' },
    changedSincePaths: { type: 'array', items: { type: 'string' }, description: 'paths changed since the prior review round (`git diff --name-only <priorSha>..HEAD`); [] when there is no prior round' },
  },
  required: ['ok', 'haltReason', 'worktreePath', 'headSha', 'scopeNote', 'touchedPaths', 'changedSincePaths'],
}
const SURFACES = {
  type: 'object',
  additionalProperties: false,
  properties: {
    backend: { type: 'boolean' }, frontend: { type: 'boolean' }, python: { type: 'boolean' },
    typescript: { type: 'boolean' }, fastapi: { type: 'boolean' }, database: { type: 'boolean' },
    container: { type: 'boolean' }, vite: { type: 'boolean' }, hasContractFiles: { type: 'boolean' },
    httpApi: { type: 'boolean' }, node: { type: 'boolean' }, ssr: { type: 'boolean' },
    go: { type: 'boolean' }, rust: { type: 'boolean' }, java: { type: 'boolean' },
    kotlin: { type: 'boolean' }, swift: { type: 'boolean' },
  },
  required: ['backend', 'frontend', 'python', 'typescript', 'fastapi', 'database', 'container', 'vite', 'hasContractFiles', 'httpApi', 'node', 'ssr', 'go', 'rust', 'java', 'kotlin', 'swift'],
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
// Returned by the resume probe (reviewEntryAction) that runs ONCE before the Fix
// phase. `review` = run the fan-out (the default — fresh fix, or a fix already landed
// since the last verdict). `fix-first` = a standing BLOCK verdict that nothing has
// been done about, so skip the redundant re-review and dispatch the fix straight
// away. The durable-resume fields (found / atTip / resumeState) are read off the
// newest verdict comment, which composeComment stamps with the reviewed tip SHA and
// the loop-guard state exactly so a relaunch can consume them here: an APPROVE still
// at the fix-branch tip skips Fix + Gate review, and a BLOCK re-seeds the
// oscillation/churn guards instead of resetting them.
const FPRINT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file:  { type: 'string' },
    title: { type: 'string' },
  },
  required: ['file', 'title'],
}
const STALL_ENTRY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file:   { type: 'string' },
    title:  { type: 'string' },
    streak: { type: 'integer' },
  },
  required: ['file', 'title', 'streak'],
}
const RESUME_STATE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stall:       { type: 'array', items: STALL_ENTRY, description: 'per-blocker no-progress streaks (oscillation guard)' },
    seen:        { type: 'array', items: FPRINT, description: "every prior round's finding fingerprints (churn guard)" },
    churnStreak: { type: 'integer', description: 'consecutive rounds that surfaced new blockers on unchanged code' },
  },
  required: ['stall', 'seen', 'churnStreak'],
}
const REVIEW_ENTRY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action:      { type: 'string', enum: ['review', 'fix-first'] },
    lastVerdict: { type: ['string', 'null'], enum: ['APPROVE', 'BLOCK', null] },
    found:       { type: 'boolean', description: 'a comment with the expected header exists at all (true even when its verdict line is ADVISORY)' },
    atTip:       { type: 'boolean', description: 'the newest header comment carries a **Reviewed tip:** SHA equal to the current remote branch tip; false when the SHA differs, is absent (legacy comment), or found=false' },
    resumeState: { ...RESUME_STATE, description: "the JSON from the newest header comment's `<!-- resume-state: ... -->` marker; empty defaults when absent" },
    reason:      { type: 'string', description: 'one line citing the commit / comment timestamps compared' },
  },
  required: ['action', 'lastVerdict', 'found', 'atTip', 'resumeState', 'reason'],
}
const EMPTY_RESUME_STATE = { stall: [], seen: [], churnStreak: 0 }
// Returned by the post-Fix completion check — the bug-side analogue of
// implement-slice's Implement-phase checkbox verification. A bug has no `## Tasks`
// ledger, so the durable done-proof is the fix branch itself: a `Refs #<n>`
// regression test that actually passes when run.
const FIX_CHECK = {
  type: 'object',
  additionalProperties: false,
  properties: {
    complete: { type: 'boolean', description: 'the planned regression test exists on the fix branch and passes' },
    reason:   { type: ['string', 'null'], description: 'set when complete=false: what is missing or failing, specific enough for a re-dispatched engineer to act on' },
  },
  required: ['complete', 'reason'],
}

// ── Review catalogue + verify lenses (production-code scope) ──────────────────
// `gate: true` marks a SHIP-BLOCKING dimension — a confirmed I:H finding from one of
// these holds the gate-review verdict (BLOCK) and drives its uncapped fix loop. The three
// gating dimensions are the things a draft PR must not silently carry: spec compliance
// (here, that the regression test actually locks the fix in), contract conformance (don't
// break consumers), and security (don't ship a hole). Every OTHER dimension is code-quality
// DEBT: it runs in the SEPARATE quality review, where its findings are posted and classified
// `Defer`/`Nit`, addressed by ONE polish pass, then triaged into tracking issues — but NEVER
// block the fix. Splitting the two means the gate loop never pays for the quality fan-out,
// and the quality pass runs exactly once. See scoreFinding() + the verdict predicate below.
const DIMENSIONS = [
  // GATE dimensions (spec compliance + contract + security) — run by the GATE review
  // (reviewMode='gate'). A surviving I:H here BLOCKs and drives the gate fix loop. For a
  // bug, test-coverage gates that the regression test actually locks the fix in. These are
  // cheap (≤3 dims), so the gate loop converges WITHOUT ever paying for the code-quality
  // fan-out — that runs once, later, in the separate quality review.
  { key: 'test-coverage', phase: 'spec', gate: true, skill: 'pattern-reviewer-test-coverage', extraSkill: 'pattern-test-coverage', applies: () => true },
  { key: 'contract',      phase: 'spec', gate: true, skill: 'pattern-reviewer-contract',      applies: s => s.hasContractFiles },
  { key: 'security',      phase: 'spec', gate: true, skill: 'pattern-reviewer-security',      applies: s => s.backend || s.frontend },
  // QUALITY dimensions — code-quality DEBT, run ONLY by the QUALITY review
  // (reviewMode='quality'). None of these gate; every finding is deferred-as-debt
  // (posted, classified `Defer`/`Nit`, never blocking).
  { key: 'coding-standard',   phase: 'quality', skill: 'pattern-reviewer-coding-standard',   applies: s => s.backend || s.frontend },
  { key: 'observability',     phase: 'quality', skill: 'pattern-reviewer-observability',     applies: s => s.backend || s.frontend },
  { key: 'non-functional',    phase: 'quality', skill: 'pattern-reviewer-non-functional',    applies: s => s.backend || s.frontend },
  { key: 'backend-standard',  phase: 'quality', skill: 'pattern-reviewer-backend-standard',  applies: s => s.backend },
  { key: 'database',          phase: 'quality', skill: 'pattern-reviewer-database',          applies: s => s.database },
  { key: 'frontend-standard', phase: 'quality', skill: 'pattern-reviewer-frontend-standard', applies: s => s.frontend },
  { key: 'container',         phase: 'quality', skill: 'pattern-reviewer-container',         applies: s => s.container },
  { key: 'fastapi',           phase: 'quality', skill: 'pattern-reviewer-fastapi',           applies: s => s.fastapi },
  // `api` is the framework-agnostic sibling of `fastapi` — exactly one of the two
  // runs for HTTP-boundary code (the classifier sets httpApi only for non-FastAPI frameworks).
  { key: 'api',               phase: 'quality', skill: 'pattern-reviewer-api',               applies: s => s.httpApi },
  { key: 'node',              phase: 'quality', skill: 'pattern-reviewer-node',              applies: s => s.node },
  { key: 'ssr',               phase: 'quality', skill: 'pattern-reviewer-ssr',               applies: s => s.ssr },
  { key: 'python',            phase: 'quality', skill: 'pattern-reviewer-python',            applies: s => s.python },
  { key: 'typescript',        phase: 'quality', skill: 'pattern-reviewer-typescript',        applies: s => s.typescript },
  { key: 'vite',              phase: 'quality', skill: 'pattern-reviewer-vite',              applies: s => s.vite },
  { key: 'go',                phase: 'quality', skill: 'pattern-reviewer-go',                applies: s => s.go },
  { key: 'rust',              phase: 'quality', skill: 'pattern-reviewer-rust',              applies: s => s.rust },
  { key: 'java',              phase: 'quality', skill: 'pattern-reviewer-java',              applies: s => s.java },
  { key: 'kotlin',            phase: 'quality', skill: 'pattern-reviewer-kotlin',            applies: s => s.kotlin },
  { key: 'swift',             phase: 'quality', skill: 'pattern-reviewer-swift',             applies: s => s.swift },
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
// CHURN GUARD (issue #49, mirrored from implement-slice) — the stall guard's
// mirror image: catches rounds that keep RETIRING their blockers while surfacing
// brand-NEW ones on code UNCHANGED since the prior round (reviewer sampling
// noise, not defects). CHURN_ROUNDS consecutive such rounds halt to a human.
const CHURN_ROUNDS = 3
const detectChurn = (r, seen) => {
  if (!Array.isArray(r.changedSincePaths)) return []
  const changed = new Set(r.changedSincePaths.map(p => String(p)))
  return r.blockers.filter(b => !seen.some(p => sameBlocker(p, b)) && !changed.has(fileNoLine(b.file)))
}
const fmtChurn = churn => churn.map(c => `\`${c.file}\` — ${c.title}`).join('; ')
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
  // GATING findings go the other way: an I:M from a gate axis (spec / contract /
  // security) is class `Fix` regardless of effort — never `Defer`. Deferring a
  // gating MEDIUM leaves it in the diff where a later round can re-grade the same
  // defect HIGH (severity flapping), which reads as a "new" blocker and stops the
  // fix loop from converging. It still doesn't BLOCK (the verdict keys off I:H
  // only); it just rides along in every dispatched fix round so it can't flap.
  const base = classify(impact, f.effort)
  const cls = gating
    ? (impact === 'M' ? 'Fix' : base)
    : (base === 'Fix' ? 'Defer' : base)
  return { ...f, impact, gating, cls }
}

function composeComment(scored, { reviewMode, scopeNote, dedupMerged, verdict, reviewedSha, resumeState }) {
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

  // Durable resume stamps: the reviewed tip SHA proves which commit this verdict
  // covers (a relaunch skips a re-review only while it still matches the branch
  // tip), and the invisible resume-state marker carries the loop guards across a
  // kill. Both are consumed by reviewEntryAction on relaunch.
  const tipLine = `**Reviewed tip:** \`${reviewedSha}\``
  const resumeFooter = `\n\n<!-- resume-state: ${JSON.stringify(resumeState ?? EMPTY_RESUME_STATE)} -->`

  // GATE review: spec-compliance / contract / security only. Blocks on a gating I:H.
  if (reviewMode === 'gate') {
    return [
      '# Bug Fix Gate Review',
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
      tipLine,
      '',
      '_This is the GATE review. It blocks the fix only on spec-compliance (the regression test locks the fix in), contract, and security findings (`I:H`). Code quality is reviewed separately in the quality review and never blocks the fix._',
      '',
      '## Findings',
      '',
      section('Spec, contract & security findings (gating)', shown, 'No spec, contract, or security findings.'),
    ].filter(s => s !== '').join('\n') + resumeFooter
  }

  // QUALITY review: code-quality axes only — advisory, never blocks. After one polish
  // pass the residual is triaged into kind:refactor / kind:enhancement tracking issues.
  return [
    '# Bug Fix Quality Review',
    '',
    '## Review Summary',
    '',
    matrix,
    '',
    `**Fix now:** ${fixNow}  •  **Deferred:** ${deferred}  •  **Nits:** ${nits}`,
    dedupMerged ? `\n_Deduplicated ${dedupMerged} overlapping finding(s) reported by more than one dimension._` : '',
    scopeNote ? `\n**Note:** ${scopeNote}` : '',
    '',
    '**Verdict:** ADVISORY',
    tipLine,
    '',
    '_This is the QUALITY review (runs AFTER the gate review APPROVES). These code-quality findings never block the fix: one engineer polish pass addresses them, then any residual is triaged into `kind:refactor` / `kind:enhancement` tracking issues._',
    '',
    '## Findings',
    '',
    section('Code-quality findings', shown, 'No code-quality findings.'),
  ].filter(s => s !== '').join('\n') + resumeFooter
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

// ── The always-on blocker floor (issue #48, mirrored from implement-slice) ────
// When the full 3-lens verify is OFF (default), the gating I:H findings that
// would actually drive a BLOCK still face the correctness + context lenses
// before they can hold the gate (severity is excluded — the gating I:M→Fix rule
// already absorbs grading noise). A blocker is downgraded to MEDIUM ONLY when
// BOTH lenses explicitly refute it — a missing or failed lens keeps it standing,
// so an infra failure can never silently unblock a gate. Downgraded findings
// stay in the comment AND the fix dispatch via the gating-I:M→Fix class.
// Findings that fingerprint-match a prior round's are exempt — the anchored
// re-review already closure-checked them against the real code.
const FLOOR_LENSES = VERIFY_LENSES.filter(l => l.key !== 'severity')
async function applyBlockerFloor(list, diffCtx, phaseTitle, roundCtx) {
  if (VERIFY_ENABLED) return list // the full 3-lens verify already vetted everything
  const isPrior = f => (roundCtx?.findings || []).some(p => sameBlocker(p, f))
  const targets = list.filter(f => sevToImpact(f.severity) === 'H' && isGating(f) && !isPrior(f))
  if (!targets.length) return list
  const judged = await parallel(targets.map(f => () =>
    parallel(FLOOR_LENSES.map(lens => () =>
      agent(
        `${diffCtx}

Adversarially verify a VERDICT-DRIVING (blocking) code-review finding through the "${lens.key}" lens — be a skeptic, not a rubber stamp. ${lens.ask}

FLOOR MODE: mark refuted=true ONLY on concrete evidence the claim is wrong — the cited code does not do what the finding says, or surrounding context provably neutralises it. Mere uncertainty is NOT refutation in floor mode; when unsure, return refuted=false and let the blocker stand.

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
        { label: `floor:${f.dimension}:${lens.key}`, phase: phaseTitle, schema: REFUTE_VERDICT, model: AGENT_MODEL },
      ),
    )).then(votes => ({ f, gone: votes.filter(Boolean).filter(v => v.refuted).length >= FLOOR_LENSES.length })),
  ))
  const refuted = new Set(judged.filter(j => j.gone).map(j => j.f))
  log(`${phaseTitle}: blocker floor — ${targets.length} would-be blocker(s) checked, ${refuted.size} refuted by both lenses${refuted.size ? ' → downgraded to MEDIUM' : ''}.`)
  if (!refuted.size) return list
  return list.map(f => refuted.has(f)
    ? { ...f, severity: 'MEDIUM', impactStatement: `${f.impactStatement} (blocker floor: downgraded from ${f.severity} — both the correctness and context lenses refuted the blocking claim)` }
    : f)
}

// `samples` > 1 dispatches each dimension K× in parallel — independent stochastic
// samples of the same catalogue over the same diff — and unions the results; the
// caller's dedupeFindings collapses the overlap (keeping the highest severity).
async function runDimensions(dims, reviewPhase, phaseTitle, diffCtx, samples = 1) {
  const jobs = dims.flatMap(d => Array.from({ length: samples }, (_, i) => ({ d, i })))
  return (await parallel(jobs.map(({ d, i }) => () =>
    agent(dimensionPrompt(d, diffCtx), { agentType: AXIS_REVIEWER, label: `${reviewPhase}:${d.key}${samples > 1 ? `:s${i + 1}` : ''}`, phase: phaseTitle, schema: FINDINGS, model: AGENT_MODEL }),
  ))).filter(Boolean).flatMap(r => (r.findings || []).map(f => ({ ...f, dimension: r.dimension, reviewPhase })))
}

// ─────────────────────────────────────────────────────────────────────────────
// runReview — production-code fan-out review over the bug-fix diff. Sets up a
// read-only worktree on the fix branch tip, fans out the dimension set selected by
// reviewMode, dedups, adversarially verifies, composes ONE verdict comment, posts it
// on the bug ISSUE, and RETURNS the verdict. Flips no label, opens no PR.
//   reviewMode — 'gate'    : the GATING dimensions only (regression coverage / contract
//                            / security); BLOCK on a surviving gating I:H. Posts
//                            `# Bug Fix Gate Review`.
//                'quality' : the code-quality axes only; never blocks (ADVISORY). Posts
//                            `# Bug Fix Quality Review`.
//   roundCtx   — null on the FIRST round of the gate fix↔re-review loop; on every
//                later round, { reviewedSha, findings } from the PRIOR round.
//                Rendered as the anchored-re-review block so each dimension agent
//                (1) closure-checks every prior finding instead of re-sampling the
//                whole diff, and (2) hunts NEW findings only in the hunks changed
//                since reviewedSha (see implement-slice for the rationale).
//   guardIn    — the gate loop's { stall, seen, churnStreak } entering this round
//                (null in quality mode, which has no blocking loop). The round's
//                updated guard is computed HERE — before publish — so the posted
//                verdict comment carries it durably in the `<!-- resume-state -->`
//                marker, and returned as `guard`.
// Returns { verdict, publishError, blockers, findings, reviewedSha, guard } on
// success or { error } on infra failure.
// ─────────────────────────────────────────────────────────────────────────────
async function runReview(phaseTitle, fixBranch, reviewMode = 'gate', roundCtx = null, guardIn = null) {
  try {
    const rprep = await agent(
      `You are setting up a READ-ONLY production-code review of the bug-fix branch for issue #${ISSUE}. Do NOT edit, push, or run destructive git. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`).

Steps:
1. Set up the read-only worktree on the fix branch \`${fixBranch}\`: \`bash skills/operation-git/scripts/setup-worktree.sh ${fixBranch}\` (NO --merge-main). Capture the printed worktreePath. If it fails, return ok=false with a haltReason.
2. Compute the touched paths vs origin/main inside the worktree: \`git -C <worktreePath> diff --name-only origin/main..HEAD\`. If that is empty, set scopeNote explaining the fallback; otherwise scopeNote=null.
3. Capture the worktree HEAD sha: \`git -C <worktreePath> rev-parse HEAD\` → headSha.
4. ${roundCtx?.reviewedSha
    ? `Compute the paths changed since the prior review round: \`git -C <worktreePath> diff --name-only ${roundCtx.reviewedSha}..HEAD\` → changedSincePaths (an empty array if the command fails).`
    : 'changedSincePaths = [] (there is no prior review round).'}
5. Return those touched paths verbatim as touchedPaths (the raw list) — do NOT classify or interpret them.

Return the REVIEW_PREP object. The worktreePath you return is handed verbatim to every downstream dimension agent — make sure it is correct and on the fix branch tip.`,
      { label: 'review-prep', phase: phaseTitle, schema: REVIEW_PREP, model: WRITER_MODEL },
    )
    if (!rprep || !rprep.ok)
      return { error: rprep?.haltReason || `review could not set up a read-only worktree on ${fixBranch}` }

    const surfaces = await agent(
      `Classify the touched paths of the bug-fix for issue #${ISSUE} into review surfaces. These files changed on the fix branch, checked out READ-ONLY at \`${rprep.worktreePath}\`. Read paths (and, where the spelling is ambiguous, the file contents in the worktree) before deciding — do NOT guess from extensions alone.

If \`docs/stack.yaml\` exists in the worktree, read it first — it is the scaffold-distilled stack manifest (derived from the ADR); trust its declared language/framework/rendering to resolve the framework booleans (fastapi vs httpApi, vite vs ssr, node) instead of re-inferring them from file spellings.

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
- httpApi: HTTP routes/handlers/middleware/app wiring touched in a backend framework OTHER than FastAPI (Express/Fastify/Nest/Hono, Gin/Echo/Chi, Axum/Actix, Spring/Ktor, Vapor, Flask/Django — FastAPI has its own dimension, so fastapi=true implies httpApi=false for the same code).
- node: server-side JavaScript/TypeScript running under Node.js touched (service entrypoints, Express/Fastify/Nest/Hono code) — not browser code.
- ssr: server-rendered frontend framework code touched (Next.js app/ or pages/ routes, "use client"/server components, Remix loaders/actions, SvelteKit +page.server.*, Nuxt server routes, next.config.*).
- go: any .go file or go.mod touched.
- rust: any .rs file or Cargo.toml touched.
- java: any .java file (or a Maven/Gradle build file of a Java project) touched.
- kotlin: any .kt/.kts file touched.
- swift: any .swift file or Package.swift touched.
- hasContractFiles: any docs/api-contract/*.yaml or docs/data-model/*.yaml exists in the repo (check with \`ls\` in the worktree — a repo-existence check, not a touched-path check).

When a path could plausibly belong to a surface, prefer setting the boolean true: a false negative silently skips that review dimension, which is worse than running one extra lens.`,
      { label: 'review-surfaces', phase: phaseTitle, schema: SURFACES, model: AGENT_MODEL },
    ) ?? { backend: true, frontend: true, python: true, typescript: true, fastapi: true, database: true, container: true, vite: true, hasContractFiles: true, httpApi: true, node: true, ssr: true, go: true, rust: true, java: true, kotlin: true, swift: true }

    // Round anchoring (the convergence fix — see implement-slice): a re-review
    // round closure-checks the prior findings and scopes NEW findings to the code
    // changed since the prior round, instead of independently re-sampling the
    // whole branch diff and surfacing a different defect every round.
    const anchorBlock = (roundCtx && roundCtx.reviewedSha && (roundCtx.findings?.length ?? 0) > 0) ? `

## Anchored re-review (a prior round of THIS review already ran — this is NOT a fresh sweep)
The prior round judged commit \`${roundCtx.reviewedSha}\` and reported the findings listed below; a fix has landed since. Your round has exactly TWO jobs:
1. **Closure-check every prior finding assigned to your dimension**: open its cited file in the worktree and decide fixed vs. still-present. Re-report each STILL-PRESENT finding — keep its original title and file (so it fingerprints as the SAME blocker) and keep its prior severity unless the cited code itself materially changed. Never re-grade unchanged code upward. Do NOT re-report a finding that is fixed.
2. **Hunt NEW findings ONLY in the code that changed since the prior round**: \`git -C ${rprep.worktreePath} diff ${roundCtx.reviewedSha}..HEAD\` is the new-code scope — the fix itself may have introduced a defect. A finding in a hunk UNCHANGED since \`${roundCtx.reviewedSha}\` that no prior round reported is presumptively sampling noise: report it ONLY if you can prove it is real and I:H, and say explicitly in its impactStatement that it sits on code unchanged since the prior round.

Prior findings to closure-check:
${roundCtx.findings.map((f, i) => `${i + 1}. [${f.severity} · ${f.dimension}] ${f.title} — \`${f.file}\``).join('\n')}` : ''

    const diffCtx = `Review the bug-fix branch \`${fixBranch}\` checked out READ-ONLY at \`${rprep.worktreePath}\`. The diff under review is \`git -C ${rprep.worktreePath} diff origin/main..HEAD\`. Read the changed files and their surrounding context inside that worktree. Do NOT edit anything.${anchorBlock}`

    // The gate review and the quality review are now SEPARATE passes (see the Gate
    // review / Quality review phases), so a single runReview call never mixes the two:
    // the gate loop never pays for the ~10-dimension quality fan-out, and the quality
    // pass runs exactly once.
    const runSpec = reviewMode === 'gate'
    const runQual = reviewMode === 'quality'

    // ── Gating dimensions (regression coverage / contract / security): fan out, dedup, VERIFY. ──
    let specConfirmed = []
    let specMerged = 0
    if (runSpec) {
      const specDims = DIMENSIONS.filter(d => d.phase === 'spec' && d.applies(surfaces))
      // Round 1 (no anchor) fans each gating dimension out ROUND1_SAMPLES×, union
      // through dedup (issue #47). Anchored rounds stay at 1 sample.
      const specSamples = roundCtx ? 1 : ROUND1_SAMPLES
      const specDedup = dedupeFindings(await runDimensions(specDims, 'spec', phaseTitle, diffCtx, specSamples))
      specMerged = specDedup.merged
      specConfirmed = (await verifyFindings(specDedup.kept, 'spec', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: spec ${specDedup.kept.length} deduped, ${specConfirmed.length} ${verifyNote}.`)
      // Always-on floor for the verdict-driving subset (no-op when the full
      // verify already ran above).
      specConfirmed = await applyBlockerFloor(specConfirmed, diffCtx, phaseTitle, roundCtx)
    }

    // ── Code-quality axes: fan out, dedup, verify. ──
    let qualConfirmed = []
    let qualMerged = 0
    if (runQual) {
      const qualDims = DIMENSIONS.filter(d => d.phase === 'quality' && d.applies(surfaces))
      log(`${phaseTitle}: quality dimensions ${qualDims.map(d => d.key).join(', ') || '(none)'}`)
      const qualDedup = dedupeFindings(await runDimensions(qualDims, 'quality', phaseTitle, diffCtx))
      qualMerged = qualDedup.merged
      qualConfirmed = (await verifyFindings(qualDedup.kept, 'quality', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: quality ${qualDedup.kept.length} deduped, ${qualConfirmed.length} ${verifyNote}.`)
    }

    // The gate/quality split makes runSpec and runQual mutually exclusive per
    // call, and each set is already deduped — no cross-set dedup pass is needed.
    const confirmed = [...specConfirmed, ...qualConfirmed].map(scoreFinding)
    const dedupMerged = specMerged + qualMerged

    // Verdict by reviewMode:
    //   • gate    → BLOCK on a confirmed I:H from a GATING dimension.
    //   • quality → never blocks (ADVISORY): every code-quality finding is deferred
    //               debt, addressed by the polish pass / triage.
    const blocked = reviewMode === 'gate' && confirmed.some(f => f.impact === 'H' && f.gating)
    const verdict = blocked ? 'BLOCK' : 'APPROVE'
    // The gating I:H survivors that drive the BLOCK — returned so the caller's loop
    // can fingerprint them across rounds (oscillation guard). Quality mode has none.
    const blockers = confirmed.filter(f => f.impact === 'H' && f.gating).map(f => ({ file: f.file, title: f.title }))
    log(`${phaseTitle}: verdict ${verdict} (${confirmed.length} confirmed finding(s)).`)

    // Loop-guard accounting happens HERE (not in the caller) so the posted verdict
    // comment can carry the updated state durably (the `<!-- resume-state -->`
    // marker): a killed run's relaunch re-seeds the oscillation + churn guards from
    // the newest BLOCK comment instead of resetting every streak to zero — which
    // would let a structurally stuck blocker evade STALL_ROUNDS / CHURN_ROUNDS
    // forever across kills. guardIn=null (quality mode) skips the accounting.
    let guard = null
    if (guardIn) {
      const stall = trackStall(guardIn.stall ?? [], blockers)
      const anchored = !!(roundCtx && roundCtx.reviewedSha)
      const churn = anchored ? detectChurn({ blockers, changedSincePaths: rprep.changedSincePaths ?? [] }, guardIn.seen ?? []) : []
      const churnStreak = anchored ? (churn.length ? (guardIn.churnStreak ?? 0) + 1 : 0) : (guardIn.churnStreak ?? 0)
      const seen = [...(guardIn.seen ?? []), ...confirmed.map(f => ({ file: f.file, title: f.title }))]
      guard = { stall, seen, churnStreak, churn }
    }

    const body = composeComment(confirmed, { reviewMode, scopeNote: rprep.scopeNote, dedupMerged, verdict, reviewedSha: rprep.headSha, resumeState: guard ? { stall: guard.stall, seen: guard.seen, churnStreak: guard.churnStreak } : EMPTY_RESUME_STATE })

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

    // `findings` is the scored, deduped, confirmed list (each carrying `gating` + `cls`).
    // In 'gate' mode it is the gating findings that drove the verdict; in 'quality' mode
    // it is the code-quality debt the caller feeds to the one polish pass and the
    // debt-triage step. `reviewedSha` is the worktree HEAD this round judged — the
    // caller threads { reviewedSha, findings } back in as the next round's anchor.
    // `changedSincePaths` (vs the prior round's sha; [] on a first round) feeds the
    // caller's churn guard: a NEW blocker outside it sits on unchanged code.
    return { verdict, publishError: publish?.error ?? null, blockers, findings: confirmed, reviewedSha: rprep.headSha, changedSincePaths: rprep.changedSincePaths ?? [], guard }
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
async function reviewEntryAction(phaseTitle, fixBranch, reviewHeader) {
  const r = await agent(
    `Decide how to RESUME the production-code review of the bug-fix for issue #${ISSUE}: re-run the review, or dispatch a fix first. This is a READ-ONLY probe — do NOT edit code, push, run destructive git, or flip labels.

Steps:
1. Read what has landed on the fix branch \`${fixBranch}\`:
   - \`git fetch origin ${fixBranch}\` (ignore failure if the branch is missing — treat as no commits).
   - Branch tip commit date + sha: \`git log -1 --format='%cI %H' origin/${fixBranch}\`.
   - Dates of the bug's own commits: \`git log --format=%cI --grep "Refs #${ISSUE}" origin/${fixBranch}\`.
2. Read the issue comments: \`gh issue view ${ISSUE} --comments\`. Find the NEWEST comment whose body begins with the header \`${reviewHeader}\` — the latest verdict. found = whether such a comment exists. Parse its verdict from the \`**Verdict:**\` line — APPROVE or BLOCK → lastVerdict (an ADVISORY or missing verdict line → lastVerdict=null; found stays true).
3. atTip ← extract the 40-char SHA from that comment's \`**Reviewed tip:**\` line and compare it to the current \`origin/${fixBranch}\` tip sha from step 1. true iff identical; false when the comment has no Reviewed-tip line (older format) or found=false.
4. resumeState ← the JSON object inside that comment's \`<!-- resume-state: {...} -->\` marker, verbatim; { "stall": [], "seen": [], "churnStreak": 0 } when the marker is absent or found=false.
5. Decide the action:
   - found=false → action="review" (first pass; nothing reviewed yet).
   - Newest verdict is APPROVE (or ADVISORY / no verdict line) → action="review" (the caller decides whether atTip lets it skip the review entirely).
   - Newest verdict is BLOCK → check whether ANYTHING has been done about it since that comment:
     • a commit on \`origin/${fixBranch}\` authored AFTER the BLOCK comment's timestamp (compare the ISO dates from step 1), OR
     • a later comment that is a fix / work summary (NOT itself a \`${reviewHeader}\` review comment, and not a halt / need-attention notice).
     If NEITHER exists → action="fix-first" (the BLOCK stands unaddressed; re-reviewing would only reproduce it). If EITHER exists → action="review" (a fix — possibly partial — landed; re-evaluate the current diff).

Return { action, lastVerdict, found, atTip, resumeState, reason } where reason is one line citing the timestamps / sha you compared.`,
    { label: `review-entry:${reviewHeader.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`, phase: phaseTitle, schema: REVIEW_ENTRY, model: AGENT_MODEL },
  )
  return r ?? { action: 'review', lastVerdict: null, found: false, atTip: false, resumeState: { ...EMPTY_RESUME_STATE }, reason: 'resume probe returned nothing — defaulting to review' }
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
//
// Entered through the resume probe (reviewEntryAction, hoisted here so its result
// can skip the whole Fix → Gate review stretch): a run killed between the
// `# Bug Fix Gate Review` APPROVE and the terminal PR would otherwise re-pay
// fix + review just to rediscover the verdict, so an APPROVE whose Reviewed-tip
// SHA still equals the remote fix-branch tip skips ahead to the quality/PR tail.
// A standing BLOCK with no landed fix routes the FIRST dispatch to the
// review-feedback verb instead of the plain fix verb — the same fix-first
// semantics the probe had when it lived at the gate.
//
// Dispatch → VERIFY → re-dispatch (parity with implement-slice's Implement
// phase): an `await agent()` that simply RETURNS is not proof the fix landed — an
// engineer killed mid-run (memory pressure) leaves a partial fix that would
// otherwise flow into the gate review, where the static test-coverage axis can
// catch a MISSING regression test but never an existing-but-failing one
// (reviewers read code; nothing else in this workflow executes the suite). The
// durable done-proof for a bug is the fix branch itself: a `Refs #<n>` regression
// test that passes when run.
// ─────────────────────────────────────────────────────────────────────────────
phase('Fix')
const gateEntry = await reviewEntryAction('Fix', prep.fixBranch, '# Bug Fix Gate Review')
const gateApprovedAtTip = gateEntry.lastVerdict === 'APPROVE' && gateEntry.atTip === true
if (gateApprovedAtTip) {
  log('Fix: durable # Bug Fix Gate Review APPROVE at the current fix-branch tip — skipping Fix + Gate review.')
} else {
  for (let attempt = 1; ; attempt++) {
    const fixFirst = attempt === 1 && gateEntry.action === 'fix-first'
    if (fixFirst) log(`Fix: standing BLOCK with no landed fix — ${gateEntry.reason}. Routing the first dispatch to the review-feedback verb.`)
    await agent(
      fixFirst
        ? `Fix the gating review feedback (regression coverage / contract / security) on bug #${ISSUE} — see the newest \`# Bug Fix Gate Review\` comment.`
        : `Fix bug #${ISSUE}.`,
      { agentType: ENGINEER, phase: 'Fix', label: fixFirst ? 'gate-fix:resume' : attempt > 1 ? `fix:retry${attempt - 1}` : 'fix' },
    )
    const check = await agent(
      `Verify the bug #${ISSUE} fix actually landed on \`${prep.fixBranch}\` — the engineer dispatch returning is not proof. READ-ONLY on production code: do NOT edit code or specs, push, post comments, or flip labels; you may only run tests.

Steps:
1. The Regression-test plan from the approved analysis (test kind + the observable it asserts):
${prep.regressionPlan}
2. Set up a worktree on the fix branch: \`bash skills/operation-git/scripts/setup-worktree.sh ${prep.fixBranch}\`.
3. Confirm the branch carries the fix: \`git -C <worktreePath> log --oneline origin/main..HEAD\` must include at least one \`Refs #${ISSUE}\` commit, and the planned regression test must exist in the tree. If either is missing → complete=false with a reason.
4. Run THAT regression test (the single spec/test the plan names, not the whole suite) with the project's own test runner, booting whatever the test kind needs (a Playwright spec needs the dev stack; a unit/API test usually doesn't). complete=true iff it passes; on failure put the failing assertion/output in reason.

Return { complete, reason }.`,
      { phase: 'Fix', label: `verify-fix:${attempt}`, schema: FIX_CHECK, model: AGENT_MODEL },
    )
    // A missing / garbled check counts as incomplete (re-dispatch) rather than
    // falsely advancing into the gate review on an unconfirmed fix.
    if (check?.complete) break
    const reason = check?.reason || 'fix-completion check returned nothing'
    // Same no-progress discipline as the review loops: a fix that cannot produce
    // a passing regression test after STALL_ROUNDS dedicated dispatches is stuck,
    // not slow — escalate instead of re-dispatching forever.
    if (attempt >= STALL_ROUNDS)
      return halt(`bug fix incomplete after ${attempt} engineer dispatches — the planned regression test still does not exist/pass on ${prep.fixBranch}: ${reason}`)
    log(`Fix: completion check failed after dispatch ${attempt} (${reason}) — re-dispatching the engineer.`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Gate review — runReview('gate'), the UNCAPPED fix↔re-review loop over the
// GATING dimensions only (spec-compliance / contract / security). The test-coverage
// dimension is what enforces the regression test fails-before / passes-after. It runs
// until APPROVE; the oscillation guard halts to a human only on NO PROGRESS. Code
// quality is NOT touched here: it is a separate, bounded pass (Quality review). A bug
// has no acceptance-criteria ledger (the regression test is the gate), so unlike
// implement-slice there is no AC-tick. Skipped entirely when the resume probe
// (hoisted to the Fix phase) found a durable APPROVE still at the current
// fix-branch tip.
// ─────────────────────────────────────────────────────────────────────────────
phase('Gate review')
if (gateApprovedAtTip) {
  log('Gate review: durable APPROVE at the current fix-branch tip — skipping re-review.')
} else {
  // Loop guards seeded from the newest BLOCK comment's resume-state (embedded by
  // composeComment), so a structurally stuck blocker can't evade the STALL_ROUNDS /
  // CHURN_ROUNDS halts by being killed and relaunched. (The fix-first dispatch for
  // a standing BLOCK already ran in the Fix phase, which routed its first engineer
  // dispatch to the review-feedback verb.)
  let guard = gateEntry.lastVerdict === 'BLOCK' ? gateEntry.resumeState ?? EMPTY_RESUME_STATE : EMPTY_RESUME_STATE
  if (guard.stall.length || guard.churnStreak) log(`Gate review: re-seeded loop guards from the newest BLOCK comment (${guard.stall.length} stall streak(s), churn streak ${guard.churnStreak}).`)
  let lastSpent = tokensSpent()
  // Anchor for round N>1: the prior round's { reviewedSha, findings }, so the
  // re-review closure-checks the priors + scopes new findings to the fix's own
  // diff instead of independently re-sampling the whole branch (see runReview).
  let prior = null
  for (let round = 1; ; round++) {
    const r = await runReview('Gate review', prep.fixBranch, 'gate', prior, guard)
    if (r?.error) return halt(`bug-fix gate review could not run: ${r.error}`)
    if (r?.publishError) return halt(`bug-fix gate review verdict was not posted to #${ISSUE}: ${r.publishError}`)
    const spent = tokensSpent()
    log(`Gate review: round ${round} — ${r.verdict}, ${r.blockers.length} gating I:H blocker(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    if (r?.verdict === 'APPROVE') break
    // Loop guards (computed inside runReview so the posted BLOCK comment carries
    // them durably — see resume-state). Oscillation: a gating I:H blocker that
    // survives STALL_ROUNDS dedicated engineer fixes. Churn: CHURN_ROUNDS
    // consecutive rounds of new blockers on unchanged code (reviewer noise, not
    // fix regressions).
    guard = r.guard ?? guard
    const stuck = stuckBlockers(guard.stall)
    if (stuck.length)
      return halt(`Bug-fix gate review stalled — ${stuck.length} gating I:H blocker(s) survived ${STALL_ROUNDS} consecutive engineer fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
    const churn = guard.churn ?? []
    if (churn.length)
      log(`Gate review: round ${round} — ${churn.length} churn blocker(s) (new, on code unchanged since the prior round); churn streak ${guard.churnStreak}/${CHURN_ROUNDS}.`)
    if (churn.length && guard.churnStreak >= CHURN_ROUNDS)
      return halt(`Bug-fix gate review churn-stalled — ${CHURN_ROUNDS} consecutive rounds each surfaced NEW blocker(s) on code unchanged since the prior round (reviewer noise, not fix regressions); a human should look. Latest churn: ${fmtChurn(churn)}`)
    if (r.reviewedSha) prior = { reviewedSha: r.reviewedSha, findings: r.findings ?? [] }
    log(`Gate review: round ${round} returned BLOCK — dispatching an engineer fix and re-reviewing.`)
    // The dispatch inlines every Fix-class gating finding (the workflow already
    // holds them structurally) so the engineer doesn't have to re-find and re-parse
    // the verdict comment — and so the gating I:M findings (class Fix, see
    // scoreFinding) ride along in the same round instead of waiting to flap into a
    // later-round blocker. The comment stays the source of full detail (BAD/GOOD
    // snippets).
    const fixList = (r.findings ?? []).filter(f => f.cls === 'Fix')
      .map(f => `- [${f.severity} · ${f.dimension}] ${f.title} — \`${f.file}\`\n  Fix: ${f.fix}`).join('\n')
    await agent(
      `Fix the gating review feedback (regression coverage / contract / security) on bug #${ISSUE} — see the newest \`# Bug Fix Gate Review\` comment for full detail. Every finding below is \`Fix\`-class and MUST be addressed this round (gating findings are never deferred):\n${fixList}`,
      { agentType: ENGINEER, phase: 'Gate review', label: `gate-fix:${round}` },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: Quality review — the BOUNDED code-quality pass that runs AFTER the gate
// review APPROVED. It runReview('quality') over the code-quality axes only (which
// never block), and is deliberately NOT a loop: it does exactly ONE review/fix cycle
// (review → one engineer polish pass over the Defer/Nit findings) plus ONE final
// re-review, whose residual debt is triaged into kind:refactor / kind:enhancement
// tracking issues. If the first review finds nothing to fix, the polish + re-review
// are skipped and there is no debt to triage.
// ─────────────────────────────────────────────────────────────────────────────
phase('Quality review')
// Resume: quality runs AFTER the gate APPROVE, so a relaunch that skipped the gate
// (APPROVE at tip) may find the quality pass ALSO already ran at this tip —
// re-running it would re-pay the quality fan-out and re-triage duplicate debt
// issues. Probed only on that resume path (fresh runs skip the probe; the quality
// comment's verdict line is ADVISORY, so `found` + `atTip` are the signal).
let qualityAlreadyRan = false
if (gateApprovedAtTip) {
  const qEntry = await reviewEntryAction('Quality review', prep.fixBranch, '# Bug Fix Quality Review')
  qualityAlreadyRan = qEntry.found === true && qEntry.atTip === true
  if (qualityAlreadyRan) log('Quality review: durable # Bug Fix Quality Review at the current fix-branch tip — already ran; skipping re-run + re-triage.')
}
if (!qualityAlreadyRan) {
  let lastSpent = tokensSpent()
  // Review #1 — the one review of the review/fix cycle.
  const q1 = await runReview('Quality review', prep.fixBranch, 'quality')
  if (q1?.error) return halt(`bug-fix quality review could not run: ${q1.error}`)
  if (q1?.publishError) return halt(`bug-fix quality review verdict was not posted to #${ISSUE}: ${q1.publishError}`)
  let spent = tokensSpent()
  log(`Quality review: review #1 — ${q1.findings?.length ?? 0} code-quality finding(s); +${kb(spent - lastSpent)}k tok (${kb(spent)}k turn total).`)
  lastSpent = spent

  // The fixable debt = the non-gating Defer/Nit findings (Drop is below the bar).
  let finalReview = q1
  const debt1 = (q1.findings || []).filter(f => !f.gating && f.cls !== 'Drop')
  if (debt1.length) {
    // The ONE fix of the review/fix cycle: a single engineer polish pass over the
    // Defer/Nit findings. Behavior-preserving — the existing tests stay green.
    log(`Quality review: one polish pass over ${debt1.length} non-blocking finding(s), then one re-review.`)
    await agent(
      `Address the code-quality feedback on bug #${ISSUE}. This is the ONE-SHOT polish pass AFTER the fix's regression / contract / security gate already APPROVED — fix the non-blocking code-quality findings (the \`Defer\` / \`Nit\` items) in the newest \`# Bug Fix Quality Review\` comment. Production code only, behavior-preserving (existing tests stay green). Whatever you don't get to this pass is fine — it will be triaged into refactor / enhancement issues afterward.`,
      { agentType: ENGINEER, phase: 'Quality review', label: 'quality-fix' },
    )
    // The +1 review: re-review once so the triage below files only what actually
    // remains after the polish. This is NOT a loop — quality never blocks, so we do
    // not re-fix; the residual becomes tracking issues.
    const q2 = await runReview('Quality review', prep.fixBranch, 'quality')
    if (q2?.error) return halt(`bug-fix quality re-review could not run: ${q2.error}`)
    if (q2?.publishError) return halt(`bug-fix quality re-review verdict was not posted to #${ISSUE}: ${q2.publishError}`)
    spent = tokensSpent()
    log(`Quality review: review #2 (post-polish) — ${q2.findings?.length ?? 0} code-quality finding(s); +${kb(spent - lastSpent)}k tok (${kb(spent)}k turn total).`)
    lastSpent = spent
    finalReview = q2
  }

  // ── Debt triage: file the residual code-quality findings for the /ship maintenance
  // lane, ROUTED BY DIMENSION. Leftover debt is recorded as issues at
  // `status:ready-to-review` (the human gate — they do NOT auto-implement until a human
  // flips them to `status:ready-to-implement`), rather than holding this fix:
  //   • `non-functional` findings → `kind:enhancement` — they add observable behavior, so
  //     they earn a feature-shaped body with ACs + an e2e task and full E2E coverage.
  //   • every OTHER non-gating dimension → `kind:refactor` — behavior-preserving, so the
  //     body is a `## Tasks` checklist of backend/frontend tasks with NO e2e tasks and NO
  //     ACs (implement-slice then skips all E2E machinery); new tests are unit-only.
  // One issue per dimension in each bucket, deduped against open issues of that kind.
  const debt = (finalReview?.findings || []).filter(f => !f.gating && f.cls !== 'Drop')
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
    log(`Quality review: triaging debt — ${reDims.size} group(s) → kind:refactor, ${nfDims.size} → kind:enhancement.`)
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
      { label: 'triage-debt', phase: 'Quality review', schema: SIDE_EFFECT, model: AGENT_MODEL },
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
  '## Review verdict', '', `Bug-fix gate review (regression / contract / security) passed on ${TODAY}. See the \`# Bug Fix Gate Review\` comment on #${ISSUE} for the gating verdict, and the \`# Bug Fix Quality Review\` comment for code-quality detail. The regression test added with this fix fails on the pre-fix code and passes after.`, '',
  '## Test plan', '', '- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green', `- [ ] Manual smoke: ${prep.smokeHint}`,
].join('\n')

const pr = await agent(
  `Open the terminal draft PR for the bug #${ISSUE} fix. Do exactly this and nothing else:
1. Write the PR body (below) to /tmp/fix-bug-${ISSUE}-pr.md.
2. Create the idempotent draft PR:
   \`bash skills/operation-git/scripts/create-draft-pr.sh ${prep.fixBranch} "${prep.typeScope}: ${prep.bugTitle}" /tmp/fix-bug-${ISSUE}-pr.md --label merge:auto${prep.milestone ? ` --milestone "${prep.milestone}"` : ''}\`
   The script prints the PR number (new or existing). Capture it.
3. Release the bug lock now that the fix is complete: \`gh issue edit ${ISSUE} --remove-label "status:in-progress"\`. The OPEN DRAFT PR is now the durable artifact; the unified command's fix-pr / close-pr stages carry it to merge, and the PR's \`Closes #${ISSUE}\` line closes the bug on merge. (Releasing the lock here is what stops the reconcile reaper from relaunching an already-finished bug.)
Return ok=true, prNumber=<the number>, error=null (or error set on failure).

--- PR BODY (verbatim, write to /tmp/fix-bug-${ISSUE}-pr.md) ---
${prBody}
--- END PR BODY ---`,
  { label: 'open-draft-pr', phase: 'PR', schema: SIDE_EFFECT },
)

return { issue: ISSUE, status: 'pr-open', prNumber: pr?.prNumber ?? null, error: pr?.error ?? null }
