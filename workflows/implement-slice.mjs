export const meta = {
  name: 'implement-slice',
  description: 'Drive one slice through author-E2E → coverage gate → plan → implement → pass-E2E → gate-review (spec/contract/security fix loop until APPROVE, rounds anchored to the prior round\'s findings + reviewed sha) → quality-review (one code-quality fix cycle + one re-review, residual triaged into refactor/enhancement issues) to an open draft PR',
  whenToUse: 'Launched (background) by the /implement-feature Stage-1 kickoff once per eligible slice, after the orchestrator flips status:ready-to-implement → status:in-progress (the slice lock). Owns the WHOLE inner cycle — including the fan-out reviews (coverage gate + gate review + quality review) inlined as runReviewSlice(); the outer /loop only handles the PR (fix-pr / close-pr). A relaunch resumes from durable GitHub state: the task checklist for authoring/implementation progress, plus the SHA-stamped verdict comments for review passage — a gate-review APPROVE still at the branch tip skips Pass E2E + Gate review, and the loop guards re-seed from the newest BLOCK. Pass { slice, today }.',
  phases: [
    { title: 'Prep' },
    { title: 'Author E2E' },
    { title: 'Coverage gate' },
    { title: 'Plan' },
    { title: 'Implement' },
    { title: 'Pass E2E' },
    { title: 'Gate review' },
    { title: 'Quality review' },
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
// Adversarial verify is OPT-IN, default OFF. The verify lenses re-judge the
// dimension reviewer's own findings — itself a form of self-review — so by
// default we trust the reviewer's severity and skip them (correctness + context
// bypassed). The orchestrator reads $HCC_VERIFY_LENSES (the workflow sandbox has
// no env access — same reason args.today is threaded in) and passes
// verifyLenses=true to turn the three lenses back on.
const VERIFY_ENABLED = input.verifyLenses === true || input.verifyLenses === 'true'
// Round-1 recall sampling (issue #47): an LLM reviewer is a stochastic sampler
// with imperfect single-pass recall, so the FIRST round of each gating review
// fans every gating dimension out K× in parallel and unions the samples through
// dedup — one extra dimension agent is far cheaper than the extra fix round a
// missed defect costs. Rounds after the first stay at 1 sample (they are
// anchored closure-checks, not discovery). The orchestrator may thread
// $HCC_ROUND1_SAMPLES through args.round1Samples; default 2, floor 1.
const ROUND1_SAMPLES = Math.max(1, parseInt(input.round1Samples, 10) || 2)
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
// surface findings aggressively; its adversarial verify phase (OPT-IN via
// VERIFY_ENABLED, default OFF — see the input block) keeps these loops from chasing
// phantom findings when on: only a finding that survives refutation holds the gate
// open. With verify OFF the dimension reviewer's own severity stands.
//
// The post-implementation review is split into TWO stages (runReviewSlice is
// parametrized by reviewMode):
//   • GATE review (reviewMode='gate') — runs ONLY the gating dimensions
//     (spec-compliance / contract / security). Its fix↔re-review loop is UNCAPPED
//     and blocks on any surviving gating I:H, so it runs until APPROVE (a real
//     blocker is fixed for however many rounds it takes; the oscillation guard halts
//     to a human only on NO PROGRESS). Rounds after the first are ANCHORED: the
//     prior round's findings + the sha it judged are threaded back in (roundCtx),
//     so a re-review closure-checks the priors and scopes new findings to the
//     hunks changed since — not an independent re-sample of the whole branch diff
//     that would surface a different defect every round.
//   • QUALITY review (reviewMode='quality') — runs ONLY the code-quality axes, which
//     NEVER block. It is deliberately BOUNDED, not a loop: exactly one review/fix
//     cycle (review → one engineer polish pass over the Defer/Nit findings) plus one
//     final re-review, whose residual debt is triaged into kind:refactor /
//     kind:enhancement tracking issues.

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
    scenario:  { type: ['string', 'null'], description: 'the Gherkin scenario block (Given/When/Then) this task walks at its owning layer, from the `scenario:` field — collect all indented lines under the `scenario:` key as one newline-joined string (null if absent)' },
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
// Returned by the resume probe (reviewEntryAction) that runs ONCE before each
// review loop. `review` = run the fan-out (the default — fresh slice, or a fix
// already landed since the last verdict). `fix-first` = a standing BLOCK verdict
// that nothing has been done about, so skip the redundant re-review and dispatch
// the fix straight away. The durable-resume fields (found / atTip / resumeState)
// are read off the newest verdict comment, which composeComment stamps with the
// reviewed tip SHA and the loop-guard state exactly so a relaunch can consume
// them here: an APPROVE still at the branch tip skips the whole re-review, and a
// BLOCK re-seeds the oscillation/churn guards instead of resetting them.
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

// ── Review catalogue + verify lenses ─────────────────────────────────────────
// One row per pattern-reviewer-* lens. `phase` buckets it into the GATE review
// (reviewMode='gate') vs the QUALITY review (reviewMode='quality'); `applies(surfaces)`
// is the touched-path trigger. Each dimension agent reads ONLY its own skill and applies
// ONLY that catalogue.
// `gate: true` marks a SHIP-BLOCKING dimension — a confirmed I:H finding from one of
// these holds the gate-review verdict (BLOCK) and drives its uncapped fix loop. The three
// gating dimensions are the things a draft PR must not silently carry: spec compliance (is
// the feature actually proven), contract conformance (don't break consumers), and security
// (don't ship a hole). Functional correctness on the covered paths is already enforced by
// the green-E2E gate (Phase E) that precedes the review. Every OTHER dimension is
// code-quality DEBT: it runs in the SEPARATE quality review, where its findings are posted
// and classified `Defer`/`Nit`, addressed by ONE polish pass, then triaged into tracking
// issues — but NEVER block the slice. Splitting the two means the gate loop never pays for
// the ~10-dimension quality fan-out, and the quality pass runs exactly once. See
// scoreFinding() + the verdict predicate below.
const DIMENSIONS = [
  // GATE dimensions (spec compliance + contract + security) — run by the GATE review
  // (reviewMode='gate'). A surviving I:H here BLOCKs and drives the gate fix loop. These
  // are cheap (≤3 dims), so the gate loop converges WITHOUT ever paying for the
  // code-quality fan-out — that runs once, later, in the separate quality review.
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
// CHURN GUARD (issue #49) — the stall guard's mirror image. trackStall catches
// the SAME blocker surviving its own fix; the churn guard catches rounds that
// keep RETIRING their blockers while surfacing brand-NEW ones on code UNCHANGED
// since the prior round. Under anchored re-review (and past the blocker floor)
// that is reviewer sampling noise, not defects — CHURN_ROUNDS consecutive such
// rounds halt to a human instead of looping on noise forever. detectChurn
// returns this round's churn blockers: new vs every prior round's findings
// (`seen`, fingerprint-matched) AND outside the round's changed-since paths.
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
  const gating = isGating(f)
  // Non-gating findings are code-quality debt: a would-be `Fix` is downgraded to
  // `Defer` (recorded for the periodic quality sweep) so it never holds the slice.
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

function composeComment(scored, { reviewMode, scopeNote, dedupMerged, scope, verdict, reviewedSha, resumeState }) {
  const coverage = scope === 'test-coverage'
  const shown = coverage ? scored : scored.filter(f => f.cls !== 'Drop')
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

  // COVERAGE scope: a single pre-implementation gate over the authored E2E specs.
  if (coverage) {
    return [
      '# E2E Coverage Gate',
      '',
      `**Verdict:** ${blocked ? 'BLOCK' : 'APPROVE'}`,
      tipLine,
      '',
      blocked
        ? `The authored E2E specs do not yet cover every acceptance criterion + mandated non-happy-path. ${shown.length} coverage gap(s) below must be closed before implementation starts.`
        : 'The authored E2E specs cover every acceptance criterion and mandated non-happy-path. Cleared to implement.',
      scopeNote ? `\n**Note:** ${scopeNote}` : '',
      '',
      '## Coverage gaps',
      '',
      shown.length ? shown.map(renderFinding).join('\n\n') : '_No coverage gaps._',
    ].filter(s => s !== '').join('\n') + resumeFooter
  }

  // GATE review: spec-compliance / contract / security only. Blocks on a gating I:H.
  if (reviewMode === 'gate') {
    return [
      '# Slice Gate Review',
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
      '_This is the GATE review. It blocks the slice only on spec-compliance, contract, and security findings (`I:H`). Code quality is reviewed separately in the quality review and never blocks the slice._',
      '',
      '## Findings',
      '',
      section('Spec, contract & security findings (gating)', shown, 'No spec, contract, or security findings.'),
    ].filter(s => s !== '').join('\n') + resumeFooter
  }

  // QUALITY review: code-quality axes only — advisory, never blocks. After one polish
  // pass the residual is triaged into kind:refactor / kind:enhancement tracking issues.
  return [
    '# Slice Quality Review',
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
    '_This is the QUALITY review (runs AFTER the gate review APPROVES). These code-quality findings never block the slice: one engineer polish pass addresses them, then any residual is triaged into `kind:refactor` / `kind:enhancement` tracking issues._',
    '',
    '## Findings',
    '',
    section('Code-quality findings', shown, 'No code-quality findings.'),
  ].filter(s => s !== '').join('\n') + resumeFooter
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
  // Verify OFF (default): no self-review pass — trust each finding exactly as the
  // dimension reviewer graded it (its severity drives the gate/verdict downstream).
  if (!VERIFY_ENABLED) return list.map(f => ({ ...f, survives: true }))
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

// ── The always-on blocker floor (issue #48) ──────────────────────────────────
// axis-reviewer grades with a recall-over-precision stance that was designed
// around a refutation backstop — but the full 3-lens verify is opt-in and OFF by
// default, so a borderline gating I:H would otherwise flow straight into the
// verdict and buy an entire fix round (worktree prep + dimensions + publish +
// engineer fix + re-review). The floor closes that gap cheaply: when the full
// verify is OFF, ONLY the findings that would actually drive a BLOCK (coverage:
// every confirmed gap; gate: the gating I:H survivors — usually a handful) face
// the correctness + context lenses. Severity is excluded — the gating I:M→Fix
// rule already absorbs grading noise. A blocker is neutralised ONLY when BOTH
// lenses explicitly refute it (a missing or failed lens keeps it standing, so an
// infra failure can never silently unblock a gate):
//   • coverage gap → dropped (a phantom gap is not a gap)
//   • gate blocker → downgraded to MEDIUM (stays in the comment AND the fix
//     dispatch via the gating-I:M→Fix class; it just no longer blocks)
// Findings that fingerprint-match a prior round's are exempt — the anchored
// re-review already closure-checked them against the real code.
const FLOOR_LENSES = VERIFY_LENSES.filter(l => l.key !== 'severity')
const FLOOR_MODE_NOTE = `

FLOOR MODE: every finding in this batch is a VERDICT-DRIVING blocker. Here, mark refuted=true ONLY on concrete evidence the claim is wrong — the cited code does not do what the finding says, or surrounding context provably neutralises it. Mere uncertainty is NOT refutation in floor mode; when unsure, return refuted=false and let the blocker stand.`
async function applyBlockerFloor(list, scope, diffCtx, phaseTitle, roundCtx) {
  if (VERIFY_ENABLED) return list // the full 3-lens verify already vetted everything
  const isBlocker = f => scope === 'test-coverage' || (sevToImpact(f.severity) === 'H' && isGating(f))
  const isPrior = f => (roundCtx?.findings || []).some(p => sameBlocker(p, f))
  const targets = list.filter(f => isBlocker(f) && !isPrior(f))
  if (!targets.length) return list
  const byDim = new Map()
  for (const f of targets) {
    if (!byDim.has(f.dimension)) byDim.set(f.dimension, [])
    byDim.get(f.dimension).push(f)
  }
  const batches = []
  for (const [dim, dimFindings] of byDim) {
    const chunks = chunk(dimFindings, VERIFY_BATCH_CAP)
    chunks.forEach((items, bi) => batches.push({ dim, items, bi, multi: chunks.length > 1 }))
  }
  const judged = (await parallel(batches.map(({ dim, items, bi, multi }) => () =>
    parallel(FLOOR_LENSES.map(lens => () =>
      agent(verifyBatchPrompt(items, lens, diffCtx) + FLOOR_MODE_NOTE,
        { label: `floor:${dim}:${lens.key}${multi ? `:b${bi + 1}` : ''}`, phase: phaseTitle, schema: BATCH_VERDICT, model: AGENT_MODEL },
      ),
    )).then(lensResults => {
      const live = lensResults.filter(Boolean)
      return items.map((f, i) => {
        const idx = i + 1
        const refutes = live.filter(r => {
          const v = (r.verdicts || []).find(x => x.index === idx)
          return v && v.refuted
        }).length
        return { f, gone: refutes >= FLOOR_LENSES.length } // BOTH lenses explicitly refuted
      })
    }),
  ))).flat()
  const refuted = new Set(judged.filter(j => j.gone).map(j => j.f))
  log(`${phaseTitle}: blocker floor — ${targets.length} would-be blocker(s) checked, ${refuted.size} refuted by both lenses${refuted.size ? (scope === 'test-coverage' ? ' → dropped' : ' → downgraded to MEDIUM') : ''}.`)
  if (!refuted.size) return list
  return list.flatMap(f => {
    if (!refuted.has(f)) return [f]
    if (scope === 'test-coverage') return []
    return [{ ...f, severity: 'MEDIUM', impactStatement: `${f.impactStatement} (blocker floor: downgraded from ${f.severity} — both the correctness and context lenses refuted the blocking claim)` }]
  })
}

// Fan out a dimension set → flat list of findings tagged with their dimension + phase.
// `samples` > 1 dispatches each dimension K× in parallel — independent stochastic
// samples of the same catalogue over the same diff — and unions the results; the
// caller's dedupeFindings collapses the overlap (keeping the highest severity).
async function runDimensions(dims, reviewPhase, phaseTitle, scope, diffCtx, samples = 1) {
  const jobs = dims.flatMap(d => Array.from({ length: samples }, (_, i) => ({ d, i })))
  return (await parallel(jobs.map(({ d, i }) => () =>
    agent(dimensionPrompt(d, scope, diffCtx), { agentType: AXIS_REVIEWER, label: `${reviewPhase}:${d.key}${samples > 1 ? `:s${i + 1}` : ''}`, phase: phaseTitle, schema: FINDINGS, model: AGENT_MODEL }),
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
//                ('Coverage gate', 'Gate review', or 'Quality review')
//   reviewMode — for scope='production-code', which dimension set + verdict policy:
//                'gate'    — run ONLY the gating dimensions (spec / contract /
//                            security); BLOCK on a surviving gating I:H.
//                'quality' — run ONLY the code-quality axes; never blocks (ADVISORY).
//                (Ignored for scope='test-coverage', which always runs the lone
//                 test-coverage dimension and blocks on any confirmed gap.)
//   sliceBranch — resolved once in Prep; reused here to skip re-resolution
//   scopeManifest — the closed { acIds, dontBreak } authority from Prep; rendered
//                into diffCtx so every dimension agent AND every adversarial
//                verifier judges findings against the same bounded scope (no
//                prose-synthesized ACs). The closed AC set is SCOPE-DEPENDENT:
//                production-code gates the full acIds (every AC must be discharged
//                somewhere); the test-coverage E2E gate narrows to the E2E-OWNED
//                subset — ⋃ `covers:` over the slice's `e2e` tasks — so it never
//                BLOCKs on a backend/frontend-owned AC having "no E2E coverage".
//   tasks      — the parsed `## Tasks` ledger from Prep; rendered as the per-task
//                discharge ledger so the test-coverage / contract axes can judge
//                each task against its OWNING LAYER (Principle 1) and verify, per
//                task, that its `covers:` AC clause is discharged at that layer and
//                its `scenario:` is walked there — a backend invariant proven at
//                the backend layer, never re-asserted through E2E.
//   roundCtx   — null on the FIRST round of a fix↔re-review loop; on every later
//                round, { reviewedSha, findings } from the PRIOR round. Rendered as
//                the anchored-re-review block so each dimension agent (1) closure-
//                checks every prior finding instead of re-sampling the whole diff,
//                and (2) hunts NEW findings only in the hunks changed since
//                reviewedSha. Without this anchor every round is an independent
//                stochastic sample of the full branch diff, and the loop "finds a
//                different defect every round" instead of converging.
//   guardIn    — the calling loop's { stall, seen, churnStreak } entering this
//                round (null in quality mode, which has no blocking loop). The
//                round's updated guard is computed HERE — before publish — so the
//                posted verdict comment carries it durably in the
//                `<!-- resume-state -->` marker, and returned as `guard`.
// Returns { verdict: 'APPROVE'|'BLOCK', publishError, blockers, findings,
// reviewedSha, guard } on success (reviewedSha = the worktree HEAD this round
// judged — the caller threads it back in as the next round's anchor), or
// { error } on any infra failure (worktree setup, an uncaught throw). The whole
// body is try/caught so a crash surfaces as { error } and the caller halt()s to
// a human, never killing the run uncaught.
// ─────────────────────────────────────────────────────────────────────────────
async function runReviewSlice(scope, phaseTitle, sliceBranch, scopeManifest, tasks, reviewMode = 'gate', roundCtx = null, guardIn = null) {
  try {
    // ── Prep: read-only worktree + diff ──
    const rprep = await agent(
      `You are setting up a READ-ONLY ${scope} review of slice #${SLICE}. Do NOT edit, push, or run destructive git. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`).

Steps:
1. Set up the read-only worktree on the slice branch \`${sliceBranch}\`: \`bash skills/operation-git/scripts/setup-worktree.sh ${sliceBranch}\` (NO --merge-main). Capture the printed worktreePath. If it fails, return ok=false with a haltReason.
2. Compute the touched paths vs origin/main inside the worktree: \`git -C <worktreePath> diff --name-only origin/main..HEAD\`. If that is empty, set scopeNote explaining the fallback; otherwise scopeNote=null.
3. Capture the worktree HEAD sha: \`git -C <worktreePath> rev-parse HEAD\` → headSha.
4. ${roundCtx?.reviewedSha
    ? `Compute the paths changed since the prior review round: \`git -C <worktreePath> diff --name-only ${roundCtx.reviewedSha}..HEAD\` → changedSincePaths (an empty array if the command fails).`
    : 'changedSincePaths = [] (there is no prior review round).'}
5. Return those touched paths verbatim as touchedPaths (the raw list) — do NOT classify or interpret them.

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
      ? { backend: false, frontend: false, python: false, typescript: false, fastapi: false, database: false, container: false, vite: false, hasContractFiles: false, httpApi: false, node: false, ssr: false, go: false, rust: false, java: false, kotlin: false, swift: false }
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
        { label: `review-surfaces:${scope}`, phase: phaseTitle, schema: SURFACES, model: AGENT_MODEL },
      ) ?? { backend: true, frontend: true, python: true, typescript: true, fastapi: true, database: true, container: true, vite: true, hasContractFiles: true, httpApi: true, node: true, ssr: true, go: true, rust: true, java: true, kotlin: true, swift: true })

    const sm = scopeManifest || { acIds: [], dontBreak: [] }
    const fmtList = (xs, wrap) => xs.length ? xs.map(wrap).join(', ') : '(none declared)'

    // The CLOSED AC set the dimension agents gate against is SCOPE-DEPENDENT:
    //   • production-code — the full slice AC set (sm.acIds): every AC must be
    //     discharged SOMEWHERE, so the production review owes them all.
    //   • test-coverage (the pre-implementation E2E gate) — only the E2E-OWNED
    //     subset: the union of `covers:` across this slice's `e2e`-type tasks.
    //     An AC whose owning layer is backend/frontend (a ledger delta, token
    //     state, "no row created", a "the UI shows…" clause) is discharged by an
    //     API-level / RTL test, NOT through the browser — handing the gate the
    //     full acIds makes it BLOCK on a backend invariant having "no E2E
    //     coverage", the exact finding-error pattern-reviewer-test-coverage names.
    //     `covers:` is the authoritative author-declared mapping, so the gate's
    //     closed set is exactly ⋃ covers: over the e2e tasks.
    const e2eOwnedAcIds = [...new Set((tasks || []).filter(t => t.type === 'e2e').flatMap(t => t.covers || []))]
    const gateAcIds = scope === 'test-coverage' ? e2eOwnedAcIds : sm.acIds
    const acSetLine = scope === 'test-coverage'
      ? `- **E2E-owned AC subset (closed set for THIS gate):** ${gateAcIds.length ? gateAcIds.join(', ') : '(none — no e2e task declares a `covers:`)'} — the ONLY ACs this E2E coverage gate may demand through the UI, computed as the union of \`covers:\` across this slice's \`e2e\` tasks. An AC NOT in this list is owned by the backend/frontend layer and proven by an API-level / RTL test; its absence from the E2E specs is NOT a gap. Treat this as exhaustive: never synthesize an AC, and never demand E2E coverage for an AC outside it.`
      : `- **Acceptance criteria (closed set):** ${gateAcIds.length ? gateAcIds.join(', ') : '(none enumerated)'} — the canonical AC ids. Treat this as exhaustive: do NOT synthesize an AC from prose, a comment, or a Gherkin line that has no id in this list.`
    const manifestBlock = `
## Scope Manifest (the CLOSED authority for slice #${SLICE} — derived once from the issue body; do not widen it)
${acSetLine}
- **Don't-break (regression guards):** ${fmtList(sm.dontBreak, s => `"${s}"`)} — existing behavior to protect from regression. These guard the CURRENT path; they are NOT a mandate to author new coverage for it.

Apply this manifest exactly as your scope's rules in agents/axis-reviewer.md direct (test-coverage: cover exactly the E2E-owned AC subset above + its mapped Gherkin — never an AC owned by another layer; production-code: every finding must ground in a declared AC id or a touched-path rule).`

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

    // Refactor slice: a production-code review of a slice with NO acceptance criteria
    // and NO e2e tasks is a behavior-preserving REFACTOR (a triaged kind:refactor issue),
    // not new behavior. The test-coverage dimension must not demand new AC/E2E coverage
    // there — the bar is "existing suite still exercises the touched code" + "unit test any
    // newly-extracted seam". Without this note the gate would BLOCK every refactor for a
    // "missing tests" gap that does not apply.
    // Round anchoring (the convergence fix): a re-review round is NOT a fresh
    // sweep. The prior round's findings + the exact sha it judged are rendered so
    // each dimension agent closure-checks the priors and scopes NEW findings to
    // the code that changed since — a fresh finding on an unchanged hunk is
    // presumptively sampling noise and must clear a higher bar. This turns the
    // fix↔re-review loop from independent samples into a monotone ratchet.
    const anchorBlock = (roundCtx && roundCtx.reviewedSha && (roundCtx.findings?.length ?? 0) > 0) ? `
## Anchored re-review (a prior round of THIS review already ran — this is NOT a fresh sweep)
The prior round judged commit \`${roundCtx.reviewedSha}\` and reported the findings listed below; a fix has landed since. Your round has exactly TWO jobs:
1. **Closure-check every prior finding assigned to your dimension**: open its cited file in the worktree and decide fixed vs. still-present. Re-report each STILL-PRESENT finding — keep its original title and file (so it fingerprints as the SAME blocker) and keep its prior severity unless the cited code itself materially changed. Never re-grade unchanged code upward. Do NOT re-report a finding that is fixed.
2. **Hunt NEW findings ONLY in the code that changed since the prior round**: \`git -C ${rprep.worktreePath} diff ${roundCtx.reviewedSha}..HEAD\` is the new-code scope — the fix itself may have introduced a defect. A finding in a hunk UNCHANGED since \`${roundCtx.reviewedSha}\` that no prior round reported is presumptively sampling noise: report it ONLY if you can prove it is real and I:H, and say explicitly in its impactStatement that it sits on code unchanged since the prior round.

Prior findings to closure-check:
${roundCtx.findings.map((f, i) => `${i + 1}. [${f.severity} · ${f.dimension}] ${f.title} — \`${f.file}\``).join('\n')}
` : ''

    const isRefactor = scope === 'production-code' && (sm.acIds?.length ?? 0) === 0 && (tasks || []).every(t => t.type !== 'e2e')
    const refactorBlock = isRefactor ? `
## Refactor slice (behavior-preserving — no acceptance criteria, no E2E)
This slice has NO acceptance criteria and NO E2E tasks: it is a code-quality REFACTOR, not new behavior. For the test-coverage dimension specifically, do NOT report "missing AC coverage", "missing E2E", or "missing integration test" — there is no new behavior to cover. The coverage bar is narrower: (1) behavior is PRESERVED — the pre-existing test suite must still exercise the touched code (it is run green at push by the engineer pre-push hook), and (2) any newly-EXTRACTED seam (a function/class/module the refactor pulls out) has a focused UNIT test. Flag ONLY those two as gaps; pre-existing coverage satisfies the rest. Quality dimensions still apply normally.` : ''

    const diffCtx = `Review the slice branch \`${sliceBranch}\` checked out READ-ONLY at \`${rprep.worktreePath}\`. The diff under review is \`git -C ${rprep.worktreePath} diff origin/main..HEAD\`. Read the changed files and their surrounding context inside that worktree. Do NOT edit anything.
${manifestBlock}${ledgerBlock}${refactorBlock}${anchorBlock}`

    // Which dimension set runs is decided by (scope, reviewMode):
    //   • test-coverage         → the lone test-coverage dimension (a `spec`-phase row).
    //   • production-code 'gate'    → the gating dimensions only (spec / contract / security).
    //   • production-code 'quality' → the code-quality axes only.
    // The gate review and the quality review are now SEPARATE passes (see Phases F/G),
    // so a single runReviewSlice call never mixes the two: the gate loop never pays for
    // the ~10-dimension quality fan-out, and the quality pass runs exactly once.
    const runSpec = scope === 'test-coverage' || reviewMode === 'gate'
    const runQual = scope === 'production-code' && reviewMode === 'quality'

    // ── Gating dimensions (spec / contract / security): fan out, dedup, VERIFY. ──
    let specConfirmed = []
    let specMerged = 0
    if (runSpec) {
      const specDims = DIMENSIONS.filter(d => d.phase === 'spec' && d.applies(surfaces))
      // Round 1 (no anchor) fans each gating dimension out ROUND1_SAMPLES×, union
      // through dedup — spend the recall budget where it counts (issue #47).
      // Anchored rounds are closure-checks and stay at 1 sample.
      const specSamples = roundCtx ? 1 : ROUND1_SAMPLES
      const specDedup = dedupeFindings(await runDimensions(specDims, 'spec', phaseTitle, scope, diffCtx, specSamples))
      specMerged = specDedup.merged
      specConfirmed = (await verifyFindings(specDedup.kept, 'spec', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: spec ${specDedup.kept.length} deduped, ${specConfirmed.length} ${verifyNote}.`)
      // Always-on floor for the verdict-driving subset (no-op when the full
      // verify already ran above).
      specConfirmed = await applyBlockerFloor(specConfirmed, scope, diffCtx, phaseTitle, roundCtx)
    }

    // ── Code-quality axes: fan out, dedup, verify. ──
    let qualConfirmed = []
    let qualMerged = 0
    if (runQual) {
      const qualDims = DIMENSIONS.filter(d => d.phase === 'quality' && d.applies(surfaces))
      log(`${phaseTitle}: quality dimensions ${qualDims.map(d => d.key).join(', ') || '(none)'}`)
      const qualDedup = dedupeFindings(await runDimensions(qualDims, 'quality', phaseTitle, scope, diffCtx))
      qualMerged = qualDedup.merged
      qualConfirmed = (await verifyFindings(qualDedup.kept, 'quality', diffCtx, phaseTitle)).filter(f => f.survives)
      log(`${phaseTitle}: quality ${qualDedup.kept.length} deduped, ${qualConfirmed.length} ${verifyNote}.`)
    }

    // ── Compose (plain code). The gate/quality split makes runSpec and runQual
    // mutually exclusive per call, and each set is already deduped — no cross-set
    // dedup pass is needed. ──
    const confirmed = [...specConfirmed, ...qualConfirmed].map(scoreFinding)
    const dedupMerged = specMerged + qualMerged

    // Verdict by (scope, reviewMode):
    //   • test-coverage    → BLOCK on ANY confirmed gap.
    //   • gate             → BLOCK on a confirmed I:H from a GATING dimension.
    //   • quality          → never blocks (ADVISORY): every code-quality finding is
    //                        deferred debt, addressed by the polish pass / triage.
    const blocked = scope === 'test-coverage'
      ? confirmed.length > 0
      : reviewMode === 'gate'
        ? confirmed.some(f => f.impact === 'H' && f.gating)
        : false
    const verdict = blocked ? 'BLOCK' : 'APPROVE'
    // The findings that actually drive the BLOCK — coverage: every confirmed gap;
    // gate: the gating I:H survivors; quality: none. Returned so the caller's loop can
    // fingerprint them across rounds (oscillation guard).
    const blockers = (scope === 'test-coverage' ? confirmed : confirmed.filter(f => f.impact === 'H' && f.gating))
      .map(f => ({ file: f.file, title: f.title }))
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

    const body = composeComment(confirmed, { reviewMode, scopeNote: rprep.scopeNote, dedupMerged, scope, verdict, reviewedSha: rprep.headSha, resumeState: guard ? { stall: guard.stall, seen: guard.seen, churnStreak: guard.churnStreak } : EMPTY_RESUME_STATE })

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

    // `findings` is the scored, deduped, confirmed list (each carrying `gating` + `cls`).
    // In 'gate' mode it is the gating findings that drove the verdict; in 'quality' mode
    // it is the code-quality debt the caller feeds to the one polish pass and the
    // debt-triage step. `reviewedSha` is the worktree HEAD this round judged — the
    // caller threads { reviewedSha, findings } back in as the next round's anchor.
    // `changedSincePaths` (vs the prior round's sha; [] on a first round) feeds the
    // caller's churn guard: a NEW blocker outside it sits on unchanged code.
    return { verdict, publishError: publish?.error ?? null, blockers, findings: confirmed, reviewedSha: rprep.headSha, changedSincePaths: rprep.changedSincePaths ?? [], guard }
  } catch (e) {
    return { error: `${scope} review crashed: ${e?.message || String(e)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reviewEntryAction — the resume probe that runs ONCE before a review loop and
// decides whether to run the (expensive) fan-out review or skip straight to a fix.
//
// On a FRESH slice there is no prior verdict → review. But on a RELAUNCH (the
// reconcile reaper restarted a dead run), the slice may already carry a standing
// BLOCK verdict that NOTHING has been done about: no commit and no fix-summary
// comment landed on the branch after it. Re-running the whole fan-out there only
// reproduces the identical BLOCK and burns the fan-out cost, so we dispatch the fix
// first and let the next loop iteration re-review the landed fix.
//
// A PARTIAL fix that DID land (a commit on origin after the BLOCK) → review: the
// re-review re-evaluates the CURRENT diff and naturally catches whatever remains
// undone. Because every setup-worktree.sh hard-resets the worktree to
// origin/<branch>, the ONLY durable proof a fix landed is a PUSHED commit — a
// partial-or-complete fix that was never committed+pushed is gone on relaunch, so
// "no commit after the BLOCK" is the correct trigger to (re)dispatch the fix.
//   scope        — 'test-coverage' | 'production-code' (for labels/logging)
//   branch       — the slice branch to inspect for landed commits
//   reviewHeader — the verdict comment's leading header ('# E2E Coverage Gate' or
//                  '# Slice Gate Review') used to find the latest verdict
// Returns { action, lastVerdict, reason }; a missing/garbled probe defaults to the
// pre-existing behavior (review).
// ─────────────────────────────────────────────────────────────────────────────
async function reviewEntryAction(scope, branch, reviewHeader, phaseTitle) {
  const r = await agent(
    `Decide how to RESUME the ${scope} review of slice #${SLICE}: re-run the review, or dispatch a fix first. This is a READ-ONLY probe — do NOT edit code, push, run destructive git, or flip labels.

Steps:
1. Read what has landed on the branch \`${branch}\`:
   - \`git fetch origin ${branch}\` (ignore failure if the branch is missing — treat as no commits).
   - Branch tip commit date + sha: \`git log -1 --format='%cI %H' origin/${branch}\`.
   - Dates of the slice's own commits: \`git log --format=%cI --grep "Refs #${SLICE}" origin/${branch}\`.
2. Read the issue comments: \`gh issue view ${SLICE} --comments\`. Find the NEWEST comment whose body begins with the header \`${reviewHeader}\` — the latest ${scope} verdict. found = whether such a comment exists. Parse its verdict from the \`**Verdict:**\` line — APPROVE or BLOCK → lastVerdict (an ADVISORY or missing verdict line → lastVerdict=null; found stays true).
3. atTip ← extract the 40-char SHA from that comment's \`**Reviewed tip:**\` line and compare it to the current \`origin/${branch}\` tip sha from step 1. true iff identical; false when the comment has no Reviewed-tip line (older format) or found=false.
4. resumeState ← the JSON object inside that comment's \`<!-- resume-state: {...} -->\` marker, verbatim; { "stall": [], "seen": [], "churnStreak": 0 } when the marker is absent or found=false.
5. Decide the action:
   - found=false → action="review" (first pass; nothing reviewed yet).
   - Newest verdict is APPROVE (or ADVISORY / no verdict line) → action="review" (the caller decides whether atTip lets it skip the review entirely).
   - Newest verdict is BLOCK → check whether ANYTHING has been done about it since that comment:
     • a commit on \`origin/${branch}\` authored AFTER the BLOCK comment's timestamp (compare the ISO dates from step 1), OR
     • a later comment that is a fix / work summary (NOT itself a \`${reviewHeader}\` review comment, and not a halt / need-attention notice).
     If NEITHER exists → action="fix-first" (the BLOCK stands unaddressed; re-reviewing would only reproduce it). If EITHER exists → action="review" (a fix — possibly partial — landed; re-evaluate the current diff).

Return { action, lastVerdict, found, atTip, resumeState, reason } where reason is one line citing the timestamps / sha you compared.`,
    { label: `review-entry:${reviewHeader.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`, phase: phaseTitle, schema: REVIEW_ENTRY, model: AGENT_MODEL },
  )
  return r ?? { action: 'review', lastVerdict: null, found: false, atTip: false, resumeState: { ...EMPTY_RESUME_STATE }, reason: 'resume probe returned nothing — defaulting to review' }
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
2. Parse the \`## Tasks\` checklist from the body. Each entry is a checkbox line plus follow-on lines, e.g.:
   \`- [ ] \\\`be.1\\\` · **backend** · blocked-by: \\\`e2e.1\\\` · "POST /widgets …"\` (or \`[x]\` when done)
   \`      covers: AC1, AC3\`
   \`      scenario:\`
   \`        Given a valid payload\`
   \`        When POST /widgets is called\`
   \`        Then a row SHALL be created\`
   \`      contract: docs/api-contract/...\`
   For each task return { id (short form, e.g. be.1), type (e2e|backend|frontend), done (true iff [x]), blockedBy (the ids in the blocked-by field, [] if "—"), delivery (the quoted text), covers (the AC ids in the \`covers:\` field, e.g. ["AC1","AC3"]; [] if absent), scenario (the Gherkin block under the \`scenario:\` key — join its indented Given/When/Then lines with newlines into one string, or null if absent) }.
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

// Snapshot the E2E authoring state from the durable checklist BEFORE Phase A
// mutates `done`. Ticked e2e boxes prove AUTHORING only — the e2e-author ticks at
// authoring time, before the gate has ever run — NEVER gate passage, which lives
// in the `# E2E Coverage Gate` verdict comment and is consulted by Phase B's
// resume probe (reviewEntryAction). allE2EAlreadyDone only gates the probe's skip
// decision: a run that authored anything fresh always re-gates. Computed here
// (not inline at Phase B) because Phase A adds freshly-authored ids to `done`;
// reading it there would make it spuriously true the moment brand-new specs are
// written, skipping the gate that should vet them.
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
// fix until the specs cover every AC + non-happy-path. Skipped when the slice has
// no e2e tasks (nothing to gate) or when the DURABLE gate verdict — the newest
// `# E2E Coverage Gate` comment — is APPROVE with every e2e task already ticked on
// entry. Ticked e2e boxes alone never skip the gate (they prove authoring, not
// passage), so a run killed between a BLOCK verdict and its fix re-gates instead
// of resuming past its own open gaps. APPROVE deliberately bypasses WITHOUT a
// tip-SHA match: implementation commits land on the same slice branch after the
// gate, and no lane edits specs post-approve (Pass E2E halts on test-case
// constraints rather than editing), so the approved specs are still the specs at
// any later tip.
// ─────────────────────────────────────────────────────────────────────────────
phase('Coverage gate')
if (e2eTasks.length) {
  // One durable probe decides the whole phase: skip (prior APPROVE), fix-first
  // (standing BLOCK with no landed fix), or review — and re-seeds the loop guards
  // from the newest BLOCK comment's resume-state so a structurally stuck gap can't
  // evade the STALL_ROUNDS / CHURN_ROUNDS halts by being killed and relaunched.
  const entry = await reviewEntryAction('test-coverage', prep.sliceBranch, '# E2E Coverage Gate', 'Coverage gate')
  if (allE2EAlreadyDone && entry.lastVerdict === 'APPROVE') {
    log('Coverage gate: durable verdict is APPROVE and every e2e task was authored on entry — a prior run already passed this gate; skipping.')
  } else {
    let guard = entry.lastVerdict === 'BLOCK' ? entry.resumeState ?? EMPTY_RESUME_STATE : EMPTY_RESUME_STATE
    if (guard.stall.length || guard.churnStreak) log(`Coverage gate: re-seeded loop guards from the newest BLOCK comment (${guard.stall.length} stall streak(s), churn streak ${guard.churnStreak}).`)
    let lastSpent = tokensSpent()
    // Resume optimization: if a prior (dead) run left a standing BLOCK coverage
    // verdict that nothing has been done about — no e2e-author commit and no fix
    // comment landed on the branch since — re-gating would only reproduce the same
    // BLOCK. Dispatch the e2e-author fix first; the loop below then re-gates it.
    if (entry.action === 'fix-first') {
      log(`Coverage gate: standing BLOCK with no landed fix — ${entry.reason}. Dispatching an e2e-author fix before the first gate.`)
      await agent(
        `Fix E2E coverage feedback on slice #${SLICE}.`,
        { agentType: E2E_AUTHOR, phase: 'Coverage gate', label: 'coverage-fix:resume' },
      )
    }
    // Anchor for round N>1: the prior round's { reviewedSha, findings }, so the
    // re-gate closure-checks the priors + scopes new gaps to the changed specs
    // instead of independently re-sampling the whole branch (see runReviewSlice).
    let prior = null
    for (let round = 1; ; round++) {
      const r = await runReviewSlice('test-coverage', 'Coverage gate', prep.sliceBranch, prep.scopeManifest, prep.tasks, 'gate', prior, guard)
      if (r?.error) return halt(`E2E coverage gate could not run: ${r.error}`)
      // A set publishError means the verdict comment never reached GitHub. The gate's
      // findings would then be invisible to the fix loop — halt rather than loop blind
      // or APPROVE on an unposted verdict.
      if (r?.publishError) return halt(`E2E coverage gate verdict was not posted to #${SLICE}: ${r.publishError}`)
      const spent = tokensSpent()
      log(`Coverage gate: round ${round} — ${r.verdict}, ${r.blockers.length} gap(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
      lastSpent = spent
      if (r?.verdict === 'APPROVE') break
      // Loop guards (computed inside runReviewSlice so the posted BLOCK comment
      // carries them durably — see resume-state). Oscillation: halt if a coverage
      // gap survives STALL_ROUNDS dedicated e2e-author fixes. Churn: halt after
      // CHURN_ROUNDS consecutive rounds of new gaps on unchanged specs (reviewer
      // noise, not coverage debt).
      guard = r.guard ?? guard
      const stuck = stuckBlockers(guard.stall)
      if (stuck.length)
        return halt(`E2E coverage gate stalled — ${stuck.length} gap(s) survived ${STALL_ROUNDS} consecutive e2e-author fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
      const churn = guard.churn ?? []
      if (churn.length)
        log(`Coverage gate: round ${round} — ${churn.length} churn gap(s) (new, on specs unchanged since the prior round); churn streak ${guard.churnStreak}/${CHURN_ROUNDS}.`)
      if (churn.length && guard.churnStreak >= CHURN_ROUNDS)
        return halt(`E2E coverage gate churn-stalled — ${CHURN_ROUNDS} consecutive rounds each surfaced NEW gap(s) on specs unchanged since the prior round (reviewer noise, not coverage debt); a human should look. Latest churn: ${fmtChurn(churn)}`)
      if (r.reviewedSha) prior = { reviewedSha: r.reviewedSha, findings: r.findings ?? [] }
      log(`Coverage gate: round ${round} returned BLOCK — dispatching an e2e-author fix and re-gating.`)
      // The dispatch inlines the confirmed gaps (the workflow already holds them
      // structurally) so the e2e-author doesn't have to re-find and re-parse the
      // verdict comment; the comment stays the source of full detail.
      const gapList = (r.findings ?? []).map(f => `- ${f.title} — \`${f.file}\`\n  Fix: ${f.fix}`).join('\n')
      await agent(
        `Fix E2E coverage feedback on slice #${SLICE}. The newest \`# E2E Coverage Gate\` comment carries full detail; the confirmed gaps to close are:\n${gapList}`,
        { agentType: E2E_AUTHOR, phase: 'Coverage gate', label: `coverage-fix:${round}` },
      )
    }
  }
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
// ── Hoisted gate-review resume probe ─────────────────────────────────────────
// Runs the Gate review's reviewEntryAction HERE (one probe per run, the same cost
// as before — just earlier) so a durable `# Slice Gate Review` APPROVE still at
// the current branch tip can skip Pass E2E too: the gate APPROVE was judged on a
// tip that had already diagnosed green, so re-paying the stack boot + suite to
// rediscover it is pure redundancy. Any commit since the APPROVE (atTip=false)
// re-runs both phases. The probe result also carries the fix-first decision and
// resume-state the Gate review phase below consumes.
const gateEntry = await reviewEntryAction('production-code', prep.sliceBranch, '# Slice Gate Review', 'Pass E2E')
const gateApprovedAtTip = gateEntry.lastVerdict === 'APPROVE' && gateEntry.atTip === true
if (gateApprovedAtTip) {
  log('Pass E2E: durable # Slice Gate Review APPROVE at the current branch tip — skipping straight to the AC-tick (the approved tip already diagnosed green).')
} else if (e2eTasks.length) {
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
// PHASE F: Gate review — runReviewSlice('production-code', …, 'gate'), the UNCAPPED
// fix↔re-review loop over the GATING dimensions only (spec-compliance / contract /
// security). It runs until APPROVE — a real blocker is fixed for however many rounds
// it takes; the oscillation guard halts to a human only on NO PROGRESS. Code quality
// is NOT touched here: it is a separate, bounded pass (Phase G). On APPROVE we tick
// the ACs — the reviewer's VERIFIED GATE. Skipped entirely (straight to the
// idempotent AC-tick) when the hoisted resume probe found a durable APPROVE still
// at the current branch tip — see the Pass E2E phase.
// ─────────────────────────────────────────────────────────────────────────────
phase('Gate review')
if (gateApprovedAtTip) {
  log('Gate review: durable APPROVE at the current branch tip — skipping re-review.')
} else {
  // Loop guards seeded from the newest BLOCK comment's resume-state (embedded by
  // composeComment), so a structurally stuck blocker can't evade the STALL_ROUNDS /
  // CHURN_ROUNDS halts by being killed and relaunched.
  let guard = gateEntry.lastVerdict === 'BLOCK' ? gateEntry.resumeState ?? EMPTY_RESUME_STATE : EMPTY_RESUME_STATE
  if (guard.stall.length || guard.churnStreak) log(`Gate review: re-seeded loop guards from the newest BLOCK comment (${guard.stall.length} stall streak(s), churn streak ${guard.churnStreak}).`)
  let lastSpent = tokensSpent()
  // Resume optimization (see reviewEntryAction, hoisted to the Pass E2E phase): a
  // relaunch onto a slice that already carries a standing BLOCK gate review with
  // no landed fix skips the redundant re-review and dispatches the engineer fix
  // first; the loop below then re-reviews. A partial fix that DID land falls
  // through to review, which catches whatever remains. (A Pass-E2E fix landing
  // between the hoisted probe and here can stale a fix-first into one redundant
  // dispatch — the engineer reads the newest comment and no-ops when everything is
  // already fixed.)
  if (gateEntry.action === 'fix-first') {
    log(`Gate review: standing BLOCK with no landed fix — ${gateEntry.reason}. Dispatching an engineer fix before the first review.`)
    await agent(
      `Fix the gating review feedback (spec-compliance / contract / security) on slice #${SLICE} — see the newest \`# Slice Gate Review\` comment.`,
      { agentType: ENGINEER, phase: 'Gate review', label: 'gate-fix:resume' },
    )
  }
  // Anchor for round N>1: the prior round's { reviewedSha, findings }, so the
  // re-review closure-checks the priors + scopes new findings to the fix's own
  // diff instead of independently re-sampling the whole branch (see runReviewSlice).
  let prior = null
  for (let round = 1; ; round++) {
    const r = await runReviewSlice('production-code', 'Gate review', prep.sliceBranch, prep.scopeManifest, prep.tasks, 'gate', prior, guard)
    if (r?.error) return halt(`gate review could not run: ${r.error}`)
    // Unposted verdict (see the coverage-gate note above): the findings never reached
    // #${SLICE}, so a BLOCK would loop blind and an APPROVE would open a PR whose
    // "see the # Slice Gate Review comment" body points at a comment that doesn't exist.
    if (r?.publishError) return halt(`gate review verdict was not posted to #${SLICE}: ${r.publishError}`)
    const spent = tokensSpent()
    log(`Gate review: round ${round} — ${r.verdict}, ${r.blockers.length} gating I:H blocker(s); +${kb(spent - lastSpent)}k tok this round (${kb(spent)}k turn total).`)
    lastSpent = spent
    if (r?.verdict === 'APPROVE') break
    // Loop guards (computed inside runReviewSlice so the posted BLOCK comment
    // carries them durably — see resume-state). Oscillation: a gating I:H blocker
    // that survives STALL_ROUNDS dedicated engineer fixes. Churn: CHURN_ROUNDS
    // consecutive rounds of new blockers on unchanged code (reviewer noise, not
    // fix regressions).
    guard = r.guard ?? guard
    const stuck = stuckBlockers(guard.stall)
    if (stuck.length)
      return halt(`Gate review stalled — ${stuck.length} gating I:H blocker(s) survived ${STALL_ROUNDS} consecutive engineer fixes unresolved; a human should look. Stuck: ${fmtStuck(stuck)}`)
    const churn = guard.churn ?? []
    if (churn.length)
      log(`Gate review: round ${round} — ${churn.length} churn blocker(s) (new, on code unchanged since the prior round); churn streak ${guard.churnStreak}/${CHURN_ROUNDS}.`)
    if (churn.length && guard.churnStreak >= CHURN_ROUNDS)
      return halt(`Gate review churn-stalled — ${CHURN_ROUNDS} consecutive rounds each surfaced NEW blocker(s) on code unchanged since the prior round (reviewer noise, not fix regressions); a human should look. Latest churn: ${fmtChurn(churn)}`)
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
      `Fix the gating review feedback (spec-compliance / contract / security) on slice #${SLICE} — see the newest \`# Slice Gate Review\` comment for full detail. Every finding below is \`Fix\`-class and MUST be addressed this round (gating findings are never deferred):\n${fixList}`,
      { agentType: ENGINEER, phase: 'Gate review', label: `gate-fix:${round}` },
    )
  }
}

// ── AC-tick: the reviewer-gated VERIFIED GATE (vs. the engineer's task-box claim). ──
// The engineer self-ticks TASK boxes as a progress claim; the reviewer ticks the
// AC boxes — and only that AC tick is the verified gate. A gate-review APPROVE
// means no I:H spec-compliance finding survived, i.e. every AC's `covers:` task was
// discharged at its owning layer (the test-coverage axis blocks I:H on any
// undischarged AC). So on APPROVE we flip every `- [ ] AC<n>` → `- [x] AC<n>`. A
// re-run that re-enters on an already-APPROVE'd slice — including the
// gateApprovedAtTip skip path, where the kill may have landed between the APPROVE
// and this tick — just re-ticks idempotently.
{
  const acIds = prep.scopeManifest?.acIds ?? []
  if (acIds.length) {
    await agent(
      `The slice #${SLICE} gate review (acceptance / contract / security) has APPROVED — every acceptance criterion is now discharged at its owning layer. Tick the AC checkboxes in the slice body (the reviewer's VERIFIED GATE; the engineer only ticks task boxes). Do exactly this:
1. \`bash skills/operation-git/scripts/issue-body.sh ${SLICE} number,body\` to read the current body.
2. In the \`## Acceptance criteria (EARS)\` section, flip each unchecked AC checkbox \`- [ ] AC<n> — …\` to \`- [x] AC<n> — …\` for these ids: ${acIds.join(', ')}. Leave the AC text and every other line byte-for-byte unchanged; touch ONLY the \`[ ]\`→\`[x]\` of those AC lines (NOT task lines). If every listed AC is already \`[x]\`, change nothing and return ok=true.
3. Write the edited full body to /tmp/ac-tick-${SLICE}.md and apply it: \`gh issue edit ${SLICE} --body-file /tmp/ac-tick-${SLICE}.md\`.
Return ok=true (or error set on failure). prNumber=null.`,
      { label: 'tick-acs', phase: 'Gate review', schema: SIDE_EFFECT, model: WRITER_MODEL },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE G: Quality review — the BOUNDED code-quality pass that runs AFTER the gate
// review APPROVED. It runReviewSlice('production-code', …, 'quality') over the
// code-quality axes only (which never block), and is deliberately NOT a loop: it does
// exactly ONE review/fix cycle (review → one engineer polish pass over the Defer/Nit
// findings) plus ONE final re-review, whose residual debt is triaged into
// kind:refactor / kind:enhancement tracking issues. If the first review finds nothing
// to fix, the polish + re-review are skipped and there is no debt to triage.
// ─────────────────────────────────────────────────────────────────────────────
phase('Quality review')
// Resume: quality runs AFTER the gate APPROVE, so a relaunch that skipped the gate
// (APPROVE at tip) may find the quality pass ALSO already ran at this tip —
// re-running it would re-pay the quality fan-out and re-triage duplicate debt
// issues. Probed only on that resume path (fresh runs skip the probe; the quality
// comment's verdict line is ADVISORY, so `found` + `atTip` are the signal).
let qualityAlreadyRan = false
if (gateApprovedAtTip) {
  const qEntry = await reviewEntryAction('production-code', prep.sliceBranch, '# Slice Quality Review', 'Quality review')
  qualityAlreadyRan = qEntry.found === true && qEntry.atTip === true
  if (qualityAlreadyRan) log('Quality review: durable # Slice Quality Review at the current branch tip — already ran; skipping re-run + re-triage.')
}
if (!qualityAlreadyRan) {
  let lastSpent = tokensSpent()
  // Review #1 — the one review of the review/fix cycle.
  const q1 = await runReviewSlice('production-code', 'Quality review', prep.sliceBranch, prep.scopeManifest, prep.tasks, 'quality')
  if (q1?.error) return halt(`quality review could not run: ${q1.error}`)
  if (q1?.publishError) return halt(`quality review verdict was not posted to #${SLICE}: ${q1.publishError}`)
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
      `Address the code-quality feedback on slice #${SLICE}. This is the ONE-SHOT polish pass AFTER the slice's acceptance / contract / security gate already APPROVED — the gating blockers are resolved, so fix the non-blocking code-quality findings (the \`Defer\` / \`Nit\` items) in the newest \`# Slice Quality Review\` comment. Production code only, behavior-preserving (existing tests stay green). Whatever you don't get to this pass is fine — it will be triaged into refactor / enhancement issues afterward.`,
      { agentType: ENGINEER, phase: 'Quality review', label: 'quality-fix' },
    )
    // The +1 review: re-review once so the triage below files only what actually
    // remains after the polish. This is NOT a loop — quality never blocks, so we do
    // not re-fix; the residual becomes tracking issues.
    const q2 = await runReviewSlice('production-code', 'Quality review', prep.sliceBranch, prep.scopeManifest, prep.tasks, 'quality')
    if (q2?.error) return halt(`quality re-review could not run: ${q2.error}`)
    if (q2?.publishError) return halt(`quality re-review verdict was not posted to #${SLICE}: ${q2.publishError}`)
    spent = tokensSpent()
    log(`Quality review: review #2 (post-polish) — ${q2.findings?.length ?? 0} code-quality finding(s); +${kb(spent - lastSpent)}k tok (${kb(spent)}k turn total).`)
    lastSpent = spent
    finalReview = q2
  }

  // ── Debt triage: file the residual code-quality findings for the /ship maintenance
  // lane, ROUTED BY DIMENSION. Leftover debt is recorded as issues at
  // `status:ready-to-review` (the human gate — they do NOT auto-implement until a human
  // flips them to `status:ready-to-implement`), rather than holding this slice:
  //   • `non-functional` findings → `kind:enhancement` — they add observable behavior
  //     (pagination, caps, timeouts, capacity), so they earn a feature-shaped body with
  //     ACs + an e2e task and the full E2E/integration treatment.
  //   • every OTHER non-gating dimension → `kind:refactor` — behavior-preserving, so the
  //     body is a `## Tasks` checklist of backend/frontend tasks with NO e2e tasks and NO
  //     ACs (implement-slice then skips all E2E machinery). The only new tests are unit
  //     tests for extracted seams; the existing suite staying green is the regression net.
  // One issue per dimension in each bucket, deduped against open issues of that kind.
  // Triage runs on the stronger model: it authors bodies + dedups.
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
      `Triage residual code-quality debt from slice #${SLICE} (branch \`${prep.sliceBranch}\`) into tracking issues. Its acceptance / contract / security gate already APPROVED and a one-shot polish pass already ran; the findings below are the NON-blocking debt that remains, grouped by review dimension. Use the operation-git scripts (invoke as \`bash skills/operation-git/scripts/<name>.sh ...\`). Do NOT edit code, push, open a PR, or touch slice #${SLICE}'s \`status:*\` labels.

Create ONE issue per dimension group, deduped FIRST against open issues of the SAME kind (\`gh issue list --label <kind> --state open --limit 100\`; skip a group an open issue already captures and note the skip). Intent = a short kebab slug, e.g. \`<dimension>-debt-slice-${SLICE}\`.

=== REFACTOR groups -> \`kind:refactor\` (behavior-preserving) ===
For each group below, write a body to \`/tmp/refactor-${SLICE}-<dim>.md\` containing:
  - a one-line **Context** (behavior-preserving \`<dimension>\` debt surfaced by slice #${SLICE});
  - a \`## Tasks\` section — ONE checklist task per finding, in this EXACT shape (NO e2e tasks, NO \`covers:\`, NO \`scenario:\`, NO acceptance criteria):
      \`- [ ] \\\`be.1\\\` · **backend** · blocked-by: — · "<imperative fix, citing file:line>"\`
    (use \`fe.N\` · **frontend** for client-side files; number per type starting at 1; infer backend vs frontend from each finding's file path);
  - a \`## Don't break\` section with one line: "Behavior is preserved — the existing test suite MUST stay green; add unit tests only for any newly-extracted seam."
Then create it: \`bash skills/operation-git/scripts/create-refactor.sh --title "<dimension> debt from slice #${SLICE}" --body-file /tmp/refactor-${SLICE}-<dim>.md --intent <kebab-intent>\`.

${reDims.size ? render(reDims) : '(no refactor groups)'}

=== NON-FUNCTIONAL group -> \`kind:enhancement\` (adds observable behavior) ===
For the non-functional group below (if any), write a FEATURE-shaped body to \`/tmp/enh-${SLICE}-non-functional.md\` containing **Context**, **Proposed change**, a \`## Acceptance criteria (EARS)\` section enumerating the new behavior as \`AC1 …\`, and a \`## Tasks\` checklist that INCLUDES an \`e2e.1\` task plus the backend/frontend tasks (this change earns real E2E/integration coverage — same task shape as above, but the e2e task carries its \`covers:\` + \`scenario:\`). Then create it: \`bash skills/operation-git/scripts/create-enhancement.sh --title "<concise title> (slice #${SLICE})" --body-file /tmp/enh-${SLICE}-non-functional.md --intent <kebab-intent>\`.

${nfDims.size ? render(nfDims) : '(no non-functional group)'}

Set ok=true if every group was either filed or intentionally skipped (put any per-group failure in error). prNumber=null.`,
      { label: 'triage-debt', phase: 'Quality review', schema: SIDE_EFFECT, model: AGENT_MODEL },
    )
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE H (terminal): open the idempotent draft PR and RELEASE the slice lock.
// The outer /loop's fix-pr / close-pr stages take it from here (CI, merge
// conflicts, the final merge). Releasing status:in-progress on success is what
// keeps the reconcile reaper from relaunching a slice that already finished.
// ─────────────────────────────────────────────────────────────────────────────
phase('PR')
const prBody = [
  `Closes #${SLICE}`, '', '## Summary', '',
  prep.sliceTitle, '',
  '## Review verdict', '', `Gate review (acceptance / contract / security) passed on ${TODAY}. See the \`# Slice Gate Review\` comment on #${SLICE} for the gating verdict, and the \`# Slice Quality Review\` comment for code-quality detail.`, '',
  '## Test plan', '', '- [ ] CI: `lint` / `typecheck` / `unit` / `e2e` all green', `- [ ] Manual smoke: ${prep.smokeHint}`,
].join('\n')

const pr = await agent(
  `Open the terminal draft PR for slice #${SLICE}. Do exactly this and nothing else:
1. Write the PR body (below) to /tmp/implement-slice-${SLICE}-pr.md.
2. Create the idempotent draft PR:
   \`bash skills/operation-git/scripts/create-draft-pr.sh ${prep.sliceBranch} "${prep.typeScope}: ${prep.sliceTitle}" /tmp/implement-slice-${SLICE}-pr.md --label merge:auto${prep.milestone ? ` --milestone "${prep.milestone}"` : ''}\`
   The script prints the PR number (new or existing). Capture it.
3. Release the slice lock now that the cycle is complete: \`gh issue edit ${SLICE} --remove-label "status:in-progress"\`. The OPEN DRAFT PR is now the durable artifact; the outer /loop's fix-pr / close-pr stages carry it to merge, and the PR's \`Closes #${SLICE}\` line closes the slice on merge. (Releasing the lock here is what stops the reconcile reaper from relaunching an already-finished slice.)
Return ok=true, prNumber=<the number>, error=null (or error set on failure).

--- PR BODY (verbatim, write to /tmp/implement-slice-${SLICE}-pr.md) ---
${prBody}
--- END PR BODY ---`,
  { label: 'open-draft-pr', phase: 'PR', schema: SIDE_EFFECT },
)

return { slice: SLICE, status: 'pr-open', prNumber: pr?.prNumber ?? null, error: pr?.error ?? null }
