---
name: pattern-reviewer-security
description: "Detailed security-review catalogue + iteration flow for a scoped diff and a freshly built container image. Walks fourteen patterns in order across backend / frontend / dependencies / image (never test files): container CVEs, secrets handling, schema-validated input, parameterized queries, auth / sessions / cookies / IDOR / JWT / password reset, XSS + the security-header set, CSRF, rate limits, log + error redaction, dependency hygiene, SSRF / outbound requests, CORS, webhook + OAuth integrations, and race conditions on critical mutations. Each pattern carries an exact bar that becomes the `Required end state` quoted on every finding. Findings cite `file:line` or `image:<tag>`, include evidence + fix, and use a non-numeric handle (never `#N`). Comment shape under `# Security Review` lives in `templates/review-comment.md`. Skip for `type:e2e`."
---

# pattern-reviewer-security

The canonical security-review catalogue. This skill is BOTH the catalogue of patterns (each with its exact bar — the string a finding's `Required end state` quotes verbatim) AND the iteration / finding-construction flow used on a security-gate dispatch.

## When to activate

- The dispatched caller is security-reviewing a `type:backend` or `type:frontend` task's diff + built image.
- A user says "security-review this PR", "audit secrets / cookies / SQL injection / CSP / rate limits", "scan the image for CVEs".
- Do NOT activate for `type:e2e` — test code skips the security gate by design (fixtures contain placeholder secrets; flagging them is noise).

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-security.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows + the per-image CVE table must match this shape verbatim so downstream fix passes can parse them. |

## Severity classification

Every finding carries one of these labels. The bar lives with each pattern below.

| Severity | Criteria | Reviewer action |
|----------|----------|-----------------|
| **CRITICAL** | Exploitable remotely; leads to data breach, full compromise, or known-CVE in shipped image. | Always reported. Blocks the gate. |
| **HIGH** | Exploitable with some conditions, OR significant data exposure, OR auth/authz gap. | Always reported. Blocks the gate. |
| **MEDIUM** | Limited impact, OR requires authenticated access to exploit, OR defense-in-depth gap with a fix path. | Always reported. Informational. |
| **LOW** | Theoretical risk OR defense-in-depth improvement OR best-practice nudge. | Counts reported; flagged as findings only when the catalogue prescribes a fix or the fix is trivial. |

The dispatching `reviewer` agent computes the overall verdict from the aggregated severities (APPROVE vs BLOCK); this skill never sets the verdict line.

## Iron rules for every finding

These govern *how* a finding is formed and reported. Severity choice, citation, and the `Required end state` quotation are non-negotiable — the engineer's fix flow depends on them.

- **This catalogue is the source of truth.** Follow its patterns in order. Do not improvise additional patterns. Do not skip patterns. Do not redefine what "fail" means — if a pattern's bar shifts, update this skill, not its callers.
- **One pattern at a time.** Validate a single pattern fully — across backend, frontend, infra, and the built image where applicable — before moving to the next. Interleaving patterns produces missed findings and unstructured reports.
- **Evidence over intuition.** Every finding must cite `path/to/file.ext:line` (or `image:<tag>` + scanner output) plus the offending snippet or command output. "Looks risky" / "probably exposes" is not a finding.
- **Severity follows this catalogue's bar.** CRITICAL / HIGH / MEDIUM = always reported. LOW = reported with counts; flagged as actionable findings only when the catalogue prescribes a fix or the fix is trivial. Never inflate or deflate.
- **`Required end state` quotes the catalogue verbatim.** Every finding includes a `**Required end state:**` line that quotes the exact bar from this skill (e.g. "session cookie must be `HttpOnly; Secure; SameSite=Strict`", "image CRITICAL/HIGH count must be 0"). The engineer's fix flow fixes to the quoted bar, not to a paraphrase.
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the pattern name (`secrets-handling`, `image-cve`, `parameterized-queries`), the quoted finding title, or `F1` / `F2` / `Finding 1` / `Finding 2`.
- **Test code is out of scope.** Skip every file that belongs to the test surface — `backend/tests/`, `frontend/src/**/__tests__/`, `e2e/`, `test_*.py`, `*_test.py`, `conftest.py`, `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, Playwright / Vitest / pytest fixtures and helpers, test-only Docker Compose overrides. Test fixtures intentionally contain placeholder secrets — flagging them produces noise. When restricting checks to changed files, exclude these paths up front:

  ```bash
  git diff --name-only <base>...HEAD -- . \
    ':(exclude)backend/tests' \
    ':(exclude)e2e' \
    ':(exclude)**/__tests__/**' \
    ':(exclude)**/*.test.*' \
    ':(exclude)**/*.spec.*' \
    ':(exclude)**/conftest.py' \
    ':(exclude)**/test_*.py' \
    ':(exclude)**/*_test.py'
  ```

  Narrow exception: a *non-test* file importing from a test file (a structural bug) is reported against the non-test file, not the test file.
- **Confidence over volume.** If a snippet looks like a hardcoded secret but is a fixture, test placeholder, or doc example, mark it as such — do not waste engineer cycles.
- **Read surrounding code, not just the diff.** Open the full file, follow imports, check call sites.
- **Project context translates the catalogue's examples.** The catalogue's snippets are generic; translate them to the project's actual stack (FastAPI + SQLAlchemy + Postgres / React + Vite / server-set httpOnly cookies / `slowapi` rate limits / `structlog` redaction — whatever `CLAUDE.md` and the ADRs declare). A finding cited against a generic example but inapplicable to this stack is a false positive.
- **Acknowledge good practices.** Positive reinforcement matters. The comment template has space for "Positive observations" — use it.
- **Never suggest destructive actions.** If a fix would require `git reset --hard`, `--no-verify`, or rewriting published history, surface the underlying problem and let the caller decide.
- **Never suggest disabling a security control as a "fix".** If a CSP rule, rate limit, or CSRF check is in the way, the answer is to satisfy it, not to remove it.

## Patterns to validate

Iterate every pattern below in order. For each pattern:

1. Identify which surfaces it covers (backend code, frontend code, dependency manifests, infra/compose, the built image).
2. Restrict file-scoped patterns to the touched-path set the dispatching agent provides; apply the test-code exclusion list. Dependency and image patterns target the whole tree regardless.
3. Quote the pattern's exact bar — that string becomes the finding's `**Required end state:**`.

Collect findings as `{pattern, severity, location (file:line OR image:<tag>), evidence (snippet OR scanner output), required_end_state (quoted from this catalogue), fix}` records. Pass results don't appear in the comment — only counts and findings do.

### 1. Container image CVE policy

Every image built from this repo MUST be scanned before it ships, and the result MUST meet this bar:

- **CRITICAL / HIGH: zero tolerated.** Fix every one — bump the base image, upgrade the offending package, or switch to a slimmer base. Do not ship until the count is zero.
- **MEDIUM / LOW: fix if it's an easy fix** (a base-image bump or a single-package upgrade with no breaking change). Otherwise, **report the counts** in the PR / status update so the user can make an informed call.

Run the scanner against the slug-tagged image the agent built — never against `:latest` or a base image. Capture per-image counts at every severity band so the per-image CVE-count table in the template can be filled in:

```bash
# Trivy (preferred — also works in CI)
trivy image --severity CRITICAL,HIGH --exit-code 1 "${image_tag}"
trivy image --severity MEDIUM,LOW   --exit-code 0 "${image_tag}"   # report only

# Or: docker scout / grype — pick one and stick with it
docker scout cves "${image_tag}"
grype "${image_tag}"
```

Report shape when MEDIUM/LOW are left unfixed:

> Image scan: 0 CRITICAL, 0 HIGH, 7 MEDIUM, 14 LOW.
> Fixed: 2 CRITICAL (base bump alpine 3.18 → 3.20), 1 HIGH (`libcrypto3` 3.1.4 → 3.3.2).
> Left unfixed: 7 MEDIUM, 14 LOW (no clean upstream fix; will revisit on next base-image bump).

### 2. Secrets management

**No hardcoded secrets. Ever.** API keys, tokens, passwords, connection strings, and signing keys all come from environment variables (or a secret manager that fronts them).

```ts
// FAIL — never do this
const apiKey = "sk-proj-xxxxx";
const dbPassword = "password123";

// PASS
const apiKey = process.env.OPENAI_API_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY not configured");
}
```

```python
# Python equivalent (FastAPI / Pydantic Settings)
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str
    database_url: str

settings = Settings()  # raises at startup if either is missing
```

Verification checklist:

- [ ] No hardcoded API keys, tokens, or passwords anywhere in source.
- [ ] All secrets read from environment variables (or a typed settings object that does).
- [ ] `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key` are in `.gitignore`. Only `.env.example` (with placeholder values) is committed.
- [ ] No secrets in git history. If one leaked, **rotate it** — purging history is not enough.
- [ ] Production secrets live in the hosting platform's secret store (Vercel, Railway, Fly, AWS SSM, etc.), not baked into images.

### 3. Input validation

**Validate at the system boundary** with a schema. Trust internal callers; never trust the network.

```ts
import { z } from "zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(150),
});

export async function createUser(input: unknown) {
  try {
    const validated = CreateUserSchema.parse(input);
    return await db.users.create(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error.errors };
    }
    throw error;
  }
}
```

```python
# Python equivalent — Pydantic at the FastAPI boundary
from pydantic import BaseModel, EmailStr, Field

class CreateUserIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=0, le=150)

@router.post("/users")
def create_user(body: CreateUserIn):
    return user_service.create(body)
```

**File uploads** get size, MIME, and extension checks (whitelist, not blacklist):

```ts
function validateFileUpload(file: File) {
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (file.size > maxSize) throw new Error("File too large (max 5MB)");

  const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
  if (!allowedTypes.includes(file.type)) throw new Error("Invalid file type");

  const allowedExtensions = [".jpg", ".jpeg", ".png", ".gif"];
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext || !allowedExtensions.includes(ext)) {
    throw new Error("Invalid file extension");
  }
}
```

For high-trust uploads (avatars, payment attachments), additionally verify magic bytes — the client-declared `type` is attacker-controlled.

Verification checklist:

- [ ] Every external input (HTTP, webhook, message payload, file upload) goes through a schema.
- [ ] Validation uses allowlists, not denylists. String lengths bounded; numeric ranges bounded; formats validated with library functions (email, URL, datetime), not regex.
- [ ] File uploads enforce size, MIME, and extension — all whitelist. Magic-byte check for high-trust uploads.
- [ ] No raw user input flows directly into queries, file paths, shell commands, or `eval`.
- [ ] URL inputs used for redirects validated against an allowlist (no open redirect).
- [ ] Validation errors return field-level messages but **do not** leak internal types, table names, or stack traces.

### 4. SQL injection prevention

**Never concatenate or interpolate user input into SQL.** Use parameterized queries or an ORM/query builder.

```ts
// FAIL — string interpolation = SQL injection
const query = `SELECT * FROM users WHERE email = '${userEmail}'`;
await db.query(query);

// PASS — parameterized
await db.query("SELECT * FROM users WHERE email = $1", [userEmail]);

// PASS — query builder (Supabase shown)
const { data } = await supabase.from("users").select("*").eq("email", userEmail);
```

```python
# FAIL — f-string into raw SQL
session.execute(f"SELECT * FROM users WHERE email = '{user_email}'")

# PASS — bound parameter
session.execute(text("SELECT * FROM users WHERE email = :email"), {"email": user_email})

# PASS — SQLAlchemy ORM
session.scalars(select(User).where(User.email == user_email)).first()
```

Verification checklist:

- [ ] Every database call uses parameters or the ORM. No string concatenation, no f-strings into SQL.
- [ ] Dynamic identifiers (table/column names) come from a hardcoded whitelist, never from user input.
- [ ] `LIKE` patterns built from user input escape `%` and `_` before binding.
- [ ] NoSQL / OS-command / LDAP queries also use parameterized or escaped APIs (no string concatenation).

### 5. Authentication & authorization

**Session tokens go in `HttpOnly; Secure; SameSite` cookies. Never `localStorage`.** `localStorage` is XSS-readable; an `HttpOnly` cookie is not reachable from JavaScript.

```ts
// FAIL — XSS-readable
localStorage.setItem("token", token);

// PASS — HttpOnly cookie set by the server
res.setHeader(
  "Set-Cookie",
  `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
);
```

**The `Secure` and `SameSite` attributes come from an env knob, read at the call site — not from a fully-validated `Settings()` object.** Production sets `SECURE_COOKIES=true`; local dev and CI (which both run over plain HTTP because there's no TLS termination in the compose stack) set `SECURE_COOKIES=false`. The trap to avoid: gating the attribute on `Settings.secure_cookies` while `Settings()` requires `DATABASE_URL` / `APP_ORIGIN` / etc — every test fixture that builds the app without those env vars (which is most of them) crashes at `Settings()` instantiation before its assertion runs.

```python
# FAIL — crashes any test fixture that builds the app without a full env.
# create_app() calls Settings() unconditionally just to resolve one boolean.
def create_app() -> FastAPI:
    settings = Settings()  # ValidationError: database_url / app_origin required
    app = FastAPI()
    app.add_middleware(SessionMiddleware, https_only=settings.secure_cookies)
    return app


# PASS — the cookie knob is readable independently of Settings.
def _secure_cookies() -> bool:
    return os.getenv("SECURE_COOKIES", "true").lower() != "false"


def create_app(*, settings: Settings | None = None) -> FastAPI:
    app = FastAPI()
    app.add_middleware(SessionMiddleware, https_only=_secure_cookies())
    # ... settings (when supplied) drives the rest of the wiring ...
    return app
```

Two properties this shape protects:

1. **Test isolation.** Fixtures can build the app with overrides (`create_app(settings=fake_settings)`) without populating the full `Settings` env. The cookie knob still resolves — defaulting to secure — without dragging the rest of `Settings` along.
2. **Production safety.** The default when the env var is absent is `True` (secure cookies on). The only way to get insecure cookies is to explicitly set `SECURE_COOKIES=false`, which lives in `compose.yaml` for local/CI and is never set in production.

Project scaffold does NOT pre-add this knob — the auth feature task that first introduces session cookies owns adding the `SECURE_COOKIES` line to `.env.example`, the compose env block, and the `_secure_cookies()` helper.

**Password hashing.** Argon2id (preferred) or bcrypt (≥12 rounds) or scrypt. Never store plaintext. Never use SHA-256/MD5 for passwords (those are checksums, not password hashes). Never compare passwords with `==` — use the library's verify function in constant time.

```ts
// FAIL — plaintext compare leaks length and allows timing attacks
if (user.password === inputPassword) { ... }

// PASS — library verify (bcrypt example)
const ok = await bcrypt.compare(inputPassword, user.passwordHash);
```

**Constant-time auth paths — no timing oracles.** Login, password-reset, and other "does this account exist?" flows must return in **the same amount of time** regardless of whether the account exists. The default trap: the handler short-circuits on `user is None` (a single index lookup, ~1ms) but runs `argon2id.verify(...)` (~50–200ms) when the user exists. The timing delta is a perfect enumeration oracle — an attacker iterates emails and reads "exists" vs "doesn't exist" from the response time alone, regardless of the response body. Two mitigations stack:

1. **Always run the password verify**, even when the user doesn't exist, against a fixed sentinel hash. The verify call's `False` result is what becomes the `LoginError`, not the missing-user branch.
   ```python
   SENTINEL_HASH = "$argon2id$v=19$m=65536,t=3,p=4$..."  # generated once at startup

   def login(email: str, password: str) -> Session:
       user = users.find_by_email(email)
       hashed = user.password_hash if user else SENTINEL_HASH
       if not argon2.verify(hashed, password) or user is None:
           raise LoginError()
       # ... issue session ...
   ```
2. **Pin the floor with a regression test.** Measure the elapsed time of `login(known_email, wrong_password)` and `login(unknown_email, wrong_password)` and assert both are above a minimum (e.g. 50ms) and within a configured ratio of each other. The threshold lives in one place — never duplicate it between the docstring and the assertion; past reviews have caught "docstring says ≥50ms, assertion says ≥10ms" drift.

Same shape applies to forgot-password: the response, the response time, and the response body must be identical on hit and miss.

**Password-reset completion must NOT auto-login the user.** A successful `POST /reset` (or `/password/reset/confirm`, etc.) consumes the reset token and updates the password hash — and STOPS. It MUST NOT:

- issue a session cookie (no `Set-Cookie: session=...` on the response),
- return a session token in the body,
- have the SPA call `invalidateQueries(['me'])` / re-fetch the current user / navigate to the authenticated landing page.

The correct shape: the server returns 200 (or 204) with no auth side-effect; the SPA navigates the user to `/login` so they re-authenticate with the new password. Two reasons stack:

1. **A stolen reset token must not become a stolen session.** Reset tokens are emailed (a different trust boundary than the password) and have a longer lifetime than a fresh login. Granting a session on reset means an attacker who reads the email gets a logged-in browser without ever knowing the password — defeating the point of also requiring the password to be set.
2. **The user just proved they didn't know their old password.** Re-prompting them with the new one in a fresh login form is the cheapest way to confirm the reset worked end-to-end and to bind the session to a real password-entry event for the audit log.

```python
# FAIL — reset endpoint silently logs the user in
@router.post("/reset")
def reset_password(body: ResetIn, response: Response, db: Session = Depends(get_db)):
    user = consume_reset_token(db, body.token)
    update_password_hash(db, user, body.new_password)
    session = create_session(db, user.id)
    response.set_cookie("session", session.id, httponly=True, secure=True)  # ← bug
    return {"ok": True}

# PASS — reset endpoint is auth-effect-free
@router.post("/reset")
def reset_password(body: ResetIn, db: Session = Depends(get_db)):
    user = consume_reset_token(db, body.token)
    update_password_hash(db, user, body.new_password)
    return Response(status_code=204)
```

```tsx
// FAIL — frontend invalidates /me, which causes the now-stale session to refetch
// the user and land them on the authenticated route.
const completeReset = useMutation({
  mutationFn: postReset,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }), // ← bug
});

// PASS — navigate to /login on success; no /me invalidation.
const completeReset = useMutation({
  mutationFn: postReset,
  onSuccess: () => navigate("/login", { state: { from: "reset" } }),
});
```

Pin this with an E2E spec that asserts both the URL (`expect(page).toHaveURL(/\/login/)`) and the absence of an auth cookie on the response. The pre-push hook's Playwright run executes the spec against the smoke stack — a reset that silently logs the user in flips that spec red before the push leaves the worktree.

**Reset / MFA / OTP tokens are time-limited (≤1 hour) and single-use.** Token consumption marks-then-checks atomically (see pattern §14 — race conditions). Never accept a token that has already been redeemed; never accept one past its expiry.

**Authorize before you act — and check ownership, not just authentication.** Authentication answers "who is this?"; authorization answers "are they allowed to do this to *this resource*?". Skipping ownership checks produces IDOR (insecure direct object reference): user A reads / mutates user B's data by guessing or scraping IDs.

```ts
// FAIL — authenticates but does not check ownership.
// Any logged-in user can delete any other user.
export async function deleteUser(userId: string, requester: User) {
  await db.users.delete({ where: { id: userId } });
}

// PASS — authn + role check + ownership check (or admin override).
export async function deleteUser(userId: string, requester: User) {
  if (requester.role !== "admin" && requester.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db.users.delete({ where: { id: userId } });
}
```

For multi-tenant data, prefer **Row-Level Security** so the database enforces the rule even if a handler forgets:

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own data"
  ON users FOR UPDATE
  USING (auth.uid() = id);
```

**JWT validation, when JWTs are used.** Verify signature with the expected algorithm (reject `alg: none`, reject algorithm-mismatch attacks); verify expiration (`exp`); verify issuer (`iss`); verify audience (`aud`) when relevant. Treat unsigned or malformed tokens as 401, not 500.

**Sessions can be revoked.** Either a server-side session store (the canonical option), or short-lived JWTs paired with a refresh-token rotation and a revocation list. A pure long-lived JWT with no revocation path is a finding.

Verification checklist:

- [ ] Session/auth tokens stored in `HttpOnly; Secure; SameSite=Strict` (or `Lax`) cookies. Never in `localStorage` or `sessionStorage`.
- [ ] `Secure` / `SameSite` driven by a `SECURE_COOKIES` env var read at the call site (default `true`), not by instantiating a full `Settings()` that test fixtures can't satisfy.
- [ ] Passwords hashed with argon2id / bcrypt(≥12) / scrypt. No plaintext comparisons; library verify only.
- [ ] Login / forgot-password run in constant time vs hit/miss — sentinel hash on the miss branch, regression test pinning the floor.
- [ ] Password-reset completion does not issue a session (server-side) and does not auto-navigate to authed routes (client-side). E2E spec covers it.
- [ ] Reset / MFA / OTP tokens time-limited (≤1 hour) and single-use; consumption is atomic.
- [ ] Every handler that mutates state checks the caller's identity AND ownership/role before doing the work.
- [ ] Multi-tenant tables have RLS (or an equivalent enforced filter) so a missing handler check still can't leak data.
- [ ] Role / permission checks happen server-side; the UI hint is not the source of truth.
- [ ] JWTs (when used): signature, `exp`, `iss`, `aud` all validated; `alg: none` rejected.
- [ ] Sessions can be revoked (server-side store or short-lived JWT + refresh token rotation).

### 6. XSS prevention & security headers

**Never inject unsanitized HTML.** React escapes by default; the moment you reach for `dangerouslySetInnerHTML`, sanitize first.

```ts
import DOMPurify from "isomorphic-dompurify";

function renderUserContent(html: string) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "p"],
    ALLOWED_ATTR: [],
  });
  return <div dangerouslySetInnerHTML={{ __html: clean }} />;
}
```

Set the **full security-header set** at the edge:

```js
// next.config.js (or equivalent reverse-proxy header block)
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: `
      default-src 'self';
      script-src 'self';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https:;
      font-src 'self';
      connect-src 'self' https://api.example.com;
      frame-ancestors 'none';
    `.replace(/\s{2,}/g, " ").trim(),
  },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
```

Verification checklist:

- [ ] All user-provided HTML passes through a sanitizer (DOMPurify, bleach, etc.) before render.
- [ ] No `dangerouslySetInnerHTML` / `v-html` / `innerHTML` on raw user input.
- [ ] CSP header is set; `script-src` avoids `'unsafe-inline'` / `'unsafe-eval'` unless there is a documented reason.
- [ ] `frame-ancestors 'none'` (or an explicit allowlist) is set to prevent clickjacking.
- [ ] `Strict-Transport-Security` is set in production (HSTS, `max-age` ≥ 1 year, `includeSubDomains`).
- [ ] `X-Content-Type-Options: nosniff` is set.
- [ ] `Referrer-Policy` is restrictive (`strict-origin-when-cross-origin` or stricter).
- [ ] `Permissions-Policy` disables unused browser capabilities (camera, microphone, geolocation, …).

### 7. CSRF protection

State-changing requests authenticated by cookies need a second proof that the request was intentional.

```ts
import { csrf } from "@/lib/csrf";

export async function POST(request: Request) {
  const token = request.headers.get("X-CSRF-Token");
  if (!csrf.verify(token)) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  // ... handle request
}
```

Pair tokens with `SameSite` cookies as defense-in-depth:

```ts
res.setHeader(
  "Set-Cookie",
  `session=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/`,
);
```

Verification checklist:

- [ ] Every cookie-authenticated POST/PUT/PATCH/DELETE checks a CSRF token (double-submit cookie or signed token).
- [ ] All session/auth cookies set `SameSite=Strict` (or `Lax` if cross-site nav is required).
- [ ] Pure-bearer-token APIs (no cookies) document that they are not CSRF-vulnerable, instead of silently skipping the check.

### 8. Rate limiting

Rate limits live on every public endpoint, with stricter limits on expensive or abuse-prone routes (login, password reset, search, AI calls).

```ts
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: "Too many requests",
});
app.use("/api/", apiLimiter);

const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: "Too many search requests",
});
app.use("/api/search", searchLimiter);
```

```python
# Python equivalent — slowapi for FastAPI
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/auth/forgot-password")
@limiter.limit("5/hour")
def forgot_password(...): ...
```

Verification checklist:

- [ ] All public API routes have a rate limit (per-IP at minimum).
- [ ] Authenticated routes also rate-limit per-user, not just per-IP (one user behind a NAT shouldn't take down everyone behind that NAT).
- [ ] Auth-adjacent routes (login, signup, forgot-password, token-refresh) have stricter limits than ordinary routes (≤10 attempts / 15 min on login is a common bar).
- [ ] Rate-limit responses use `429 Too Many Requests` with a `Retry-After` header.

### 9. Sensitive data exposure

**Logs, error responses, and API responses are the three most common leak surfaces.** Redact at the source.

```ts
// FAIL — logs the password / card data
console.log("User login:", { email, password });
console.log("Payment:", { cardNumber, cvv });

// PASS — log identifiers, not secrets
console.log("User login:", { email, userId });
console.log("Payment:", { last4: card.last4, userId });
```

```ts
// FAIL — stack trace + internal message goes to the client
catch (error) {
  return NextResponse.json(
    { error: error.message, stack: error.stack },
    { status: 500 },
  );
}

// PASS — detailed log server-side, generic message to client
catch (error) {
  console.error("Internal error:", error);
  return NextResponse.json(
    { error: "An error occurred. Please try again." },
    { status: 500 },
  );
}
```

**Strip sensitive fields from API responses** at the serializer, not at every call site:

```ts
function sanitizeUser(user: UserRecord): PublicUser {
  const { passwordHash, resetToken, mfaSecret, ...publicFields } = user;
  return publicFields;
}
```

**Log a sensitive value at exactly one layer — never twice.** A common review finding: a token prefix logged in the service module *and* the router module, or a request ID minted by the middleware *and* re-stamped by the handler. Double-logging doubles the surface area for redaction bugs and confuses log-trace correlation. Pick one layer (usually the outermost where the value is still in scope) and log there only.

**Structured-log redaction is a key-name match, not a value match.** `structlog` (and most structured loggers) redact by **field name**. Adding a new PII field requires adding its key to the project's redaction allow-list — and verifying the key the production code emits is **exactly** the key the redaction rule matches. The trap: code emits `logger.info("...", token=token_value)` but the redaction rule was written against `tokenHash` (camelCase) or `token_prefix` (different field), so the field is logged in the clear. `rg` the redaction rule's key list before pushing a new PII field, and confirm the emitted key is in it.

**Request-ID middleware must be registered first** (and therefore run first on the outbound rejection path). FastAPI middleware runs in reverse-registration order on the response, so the request-id middleware must be the **last** `app.add_middleware(...)` call — otherwise a request rejected by a rate-limit or auth middleware registered later returns its 429 / 401 body with `request_id: None`, breaking support's ability to correlate the rejection. Pin this with an explicit order test that walks `app.user_middleware` and asserts the request-id middleware is at the top.

Verification checklist:

- [ ] No passwords, tokens, secrets, full PANs, CVVs, full SSNs, or session IDs in logs. PII is logged only when necessary, with a documented retention window.
- [ ] No raw user-supplied email addresses in logs, even on auth failure paths — log a user_id when one exists, or a hashed/prefix-only identifier when one doesn't. Plaintext emails in logs leak PII to anyone who reads them and degrade the enumeration-prevention posture on `/login` and `/forgot-password`.
- [ ] Sensitive values are logged at **one** layer (service OR router, never both). Double-logging doubles the redaction-failure surface.
- [ ] Redaction allow-list key names match the keys the code emits exactly (case-sensitive, no abbreviations).
- [ ] Request-ID middleware is registered last so it runs first on rejection paths; every 4xx / 5xx body carries a non-null `request_id`.
- [ ] 5xx responses return a generic message + correlation ID. Stack traces and internal exception messages stay server-side.
- [ ] 4xx responses say what the client did wrong without revealing schema/table/column names or whether a user/email exists (for auth flows, prefer "if an account exists, we sent an email").
- [ ] Structured logger has a redaction list (cookie headers, `authorization`, `password`, `token`, `secret`, etc.).
- [ ] API response serializers strip sensitive fields (`passwordHash`, `resetToken`, `mfaSecret`, …) — verified by a unit test that fails if a new sensitive field gets added without entering the strip list.
- [ ] PII encrypted at rest where required by regulation; database backups encrypted.

### 10. Dependency security

Treat dependencies as untrusted code that runs in your process. Keep them current; keep them locked.

```bash
# JavaScript / TypeScript
npm audit                  # report
npm audit fix              # auto-fix when safe
npm outdated               # see what's behind
npm ci                     # reproducible install in CI (uses lock file)

# Python
pip-audit                  # CVE check against PyPI advisories
uv sync --locked           # or: poetry install --no-update — reproducible install
```

Verification checklist:

- [ ] Lock file (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `uv.lock`) is committed.
- [ ] CI uses the reproducible-install command (`npm ci`, `uv sync --locked`, `poetry install --no-update`), not `npm install` / `pip install`.
- [ ] `npm audit` / `pip-audit` is clean of HIGH/CRITICAL findings, or each finding has a documented exception with a review date.
- [ ] Automated dependency updates are on (Dependabot, Renovate) with grouped PRs to keep noise low.
- [ ] New dependencies are evaluated for: maintenance status, transitive footprint, known advisories, and whether the standard library / existing dep already covers it.

When a `npm audit` finding shows up, triage with this decision tree:

```
Severity: critical or high
├── Is the vulnerable code reachable in your app?
│   ├── YES → fix immediately (update, patch, or replace)
│   └── NO  (dev-only dep, unused code path) → fix soon, but not a blocker
└── Is a fix available?
    ├── YES → update to the patched version
    └── NO  → check for workarounds, replace the dep, or allowlist with a review date

Severity: moderate
├── Reachable in production → fix in the next slice
└── Dev-only                → track in backlog

Severity: low
└── Track and batch with the next dependency-update slice
```

### 11. SSRF / outbound request safety

**Server-side `fetch(userProvidedUrl)` is a server-side request forgery vector.** An attacker controls the URL → the server makes the request → the attacker reads (or causes side effects in) the server's network: cloud-provider metadata endpoints (`169.254.169.254` on AWS / GCP), internal Kubernetes services, private databases, intranet admin panels.

```ts
// FAIL — server fetches whatever the user provides
app.post("/preview", async (req) => {
  const res = await fetch(req.body.url);
  return res.text();
});

// PASS — allowlist of hosts + scheme + block private ranges
const ALLOWED_HOSTS = new Set(["images.example.com", "cdn.example.com"]);

async function safeFetch(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("https only");
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error("host not allowed");
  // Block link-local / private IP ranges by resolving and refusing them
  if (await resolvesToPrivateRange(url.hostname)) throw new Error("private range");
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
}
```

Verification checklist:

- [ ] Every server-side outbound HTTP from a user-controlled URL goes through a host allowlist OR a same-origin guard.
- [ ] Scheme allowlist: `https:` (and `http:` only if the project explicitly needs it). No `file:`, `gopher:`, `ftp:`, `data:`.
- [ ] Block RFC1918 / link-local / loopback ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`). Resolve the hostname before fetching; do not trust the literal.
- [ ] `redirect: "manual"` (or follow with re-validation) — an allowlisted host can 302 to an attacker-controlled internal IP.
- [ ] Timeouts are set on every outbound request.

### 12. CORS configuration

Permissive CORS turns a same-origin browser policy into an attacker's playground. Lock origins down to an env-driven allowlist; never wildcard with credentials.

```ts
// FAIL — wildcard origin with credentials = browser sends cookies to anyone
app.use(cors({ origin: "*", credentials: true }));

// PASS — explicit origin list from the environment, credentials only when needed
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["https://app.example.com"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
```

Verification checklist:

- [ ] `origin` is an explicit list (env-driven), never `*` in production.
- [ ] If `credentials: true`, origin MUST be an explicit list (browser rejects `*` + credentials, but a regex / function that effectively allows any origin is just as bad).
- [ ] `methods` and `allowedHeaders` are explicit; not `*`.
- [ ] Preflight cache (`maxAge`) is reasonable (not so long that origin changes can't propagate).

### 13. Webhook & OAuth integration security

**Incoming webhooks** are attacker-callable by default. Verify the HMAC signature before doing any work; compare in constant time.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(rawBody: Buffer, signatureHeader: string) {
  const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(rawBody)
    .digest();
  const provided = Buffer.from(signatureHeader, "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
```

**OAuth flows** must use PKCE + a `state` parameter to prevent code-injection and CSRF on the callback.

- Generate a per-flow `state` (random, ≥128 bits), store it server-side (or in a signed cookie), and reject any callback whose `state` doesn't match.
- For public clients (SPAs, mobile), use PKCE (`code_challenge` + `code_verifier`). Confidential clients still benefit.
- Third-party `<script>` tags loaded from CDNs use Subresource Integrity hashes (`integrity="sha384-…"`) and `crossorigin="anonymous"`.

Verification checklist:

- [ ] Every webhook receiver verifies an HMAC (or equivalent provider signature) **before** parsing the body. Compare in constant time.
- [ ] Replay protection: webhook handlers either deduplicate by event ID or check a timestamp window.
- [ ] OAuth callbacks validate the `state` parameter against a server-side / signed-cookie value.
- [ ] OAuth public clients use PKCE.
- [ ] Third-party scripts loaded from CDNs use SRI hashes.

### 14. Race conditions on critical operations

Balance / inventory / quota / token-redemption mutations done as "read → decide → write" race themselves under load and let an attacker double-spend by firing N concurrent requests.

```python
# FAIL — race: two concurrent calls both pass the balance check, then both decrement
def withdraw(user_id: int, amount: int) -> None:
    bal = db.execute("SELECT balance FROM accounts WHERE id = :id", {"id": user_id}).scalar()
    if bal < amount:
        raise InsufficientFunds()
    db.execute("UPDATE accounts SET balance = balance - :a WHERE id = :id", {"a": amount, "id": user_id})

# PASS — atomic update inside a transaction, conditional on sufficient balance
def withdraw(user_id: int, amount: int) -> None:
    with db.begin():
        result = db.execute(
            "UPDATE accounts SET balance = balance - :a "
            "WHERE id = :id AND balance >= :a",
            {"a": amount, "id": user_id},
        )
        if result.rowcount == 0:
            raise InsufficientFunds()
```

Or — when the surrounding logic needs the row in scope — `SELECT ... FOR UPDATE` to take the row lock first:

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = $1 FOR UPDATE;
-- ... decide ...
UPDATE accounts SET balance = balance - $2 WHERE id = $1;
COMMIT;
```

The same shape applies to **token redemption** (password-reset, MFA, OTP, magic-link): mark-then-check atomically so a token can be redeemed at most once.

```sql
-- PASS — UPDATE returns rowcount=1 only on first redemption
UPDATE reset_tokens
   SET consumed_at = now()
 WHERE token = $1 AND consumed_at IS NULL AND expires_at > now()
RETURNING user_id;
```

Verification checklist:

- [ ] Balance / quota / inventory / counter mutations are atomic — either an atomic `UPDATE ... WHERE balance >= …` or wrapped in a transaction with `SELECT ... FOR UPDATE`.
- [ ] Token-redemption flows (password reset, MFA, OTP, magic-link) mark-then-check atomically; second redemption attempt returns rowcount=0.
- [ ] Critical mutations have a uniqueness or row-versioning guard (optimistic locking column, unique constraint on `(user_id, idempotency_key)`).

## Constructing the finding

Every finding emitted by this skill matches this shape (the template under `templates/review-comment.md` shows the full comment wrapper the agent will compose around it):

```markdown
### [SEVERITY] <pattern-name> — <one-line title — no leading `#N`>
**Location:** `path/to/file.ext:42`   (or `image: <repo>:<slug>`)
**Required end state:** <quote this catalogue's bar verbatim>
**Evidence:**

```<lang>
<offending snippet, or scanner output for image findings>
```

**Fix:**

```<lang>
<corrected snippet, or remediation step — e.g., "bump base image alpine:3.18 → 3.20">
```
```

- `[SEVERITY]` is exactly one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, per the catalogue's CVE / pattern bar.
- `<pattern-name>` is the catalogue's slug for the pattern (`secrets-handling`, `image-cve`, `parameterized-queries`, `ssrf`, `cors`, `webhook-signature`, `race-condition`, …).
- The title is non-numeric; cross-references use the pattern name, quoted title, or `F1` / `F2`.
- For LOW image-CVE findings the fix may collapse to a one-line remediation (e.g., "bump base image"); the per-image CVE-count table in the template still carries the counts.

Hand the collected list of findings (plus the per-image CVE counts) back to the dispatching `reviewer` agent — it owns the comment composition, severity-count summary, per-image CVE-count table, verdict line, scope note, `Left unfixed (LOW only)` line, and posting.

## Standard verification flow

Before declaring the review done:

1. **Scan** — run the image scanner (`trivy image …`) and the dependency auditor (`npm audit` / `pip-audit`). Record the counts per severity band.
2. **Grep for footguns** — `grep -rE '(api[_-]?key|secret|password|token)\s*=\s*["\x27]' src/` and `grep -rE 'localStorage\.(set|get)Item\(["\x27](token|session|jwt)' src/`. Investigate any hits.
3. **Walk the new endpoints** — each new state-changing route gets: input schema, authz + ownership check, CSRF check (if cookie-auth), rate limit, redacted error path.
4. **Walk the new queries** — each new query is parameterized; each new render of user content is sanitized; each new balance / quota / token mutation is atomic.
5. **Walk the new outbound calls / integrations** — SSRF guard on user-controlled URLs; HMAC verify on webhook receivers; `state` + PKCE on OAuth flows.
6. **Re-state the unfixed MEDIUM/LOW count** so the user has the number, not just "looks fine".

**Remember**: security is a posture, not a checklist. When a rule conflicts with a real requirement, document the deviation and the compensating control instead of silently turning the rule off.
