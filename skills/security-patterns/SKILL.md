---
name: security-patterns
description: "Enforce baseline application-security patterns when writing, editing, reviewing, or auditing code, container images, dependencies, or infrastructure. Activate on any security-shaped task — CVE scans, secrets handling, input validation, SQL/ORM queries, auth/session/cookie wiring, output sanitization, CSP, CSRF, rate limiting, log redaction, error sanitization, dependency audits. Encodes the non-negotiables: zero shipped CRITICAL/HIGH CVEs, secrets in env only, schema-validated input, parameterized queries, httpOnly+Secure+SameSite cookies, authorization-before-action, RLS where applicable, HTML sanitization + CSP, CSRF + per-route rate limits on state-changing endpoints, redacted logs, generic client errors, and lock-file hygiene."
---

# security-patterns

Baseline application-security checks that apply to every change touching code, dependencies, container images, or infrastructure. The goal is a small set of non-negotiable rules: no shipped CRITICAL/HIGH CVEs, no hardcoded secrets, validated input, parameterized queries, secure auth/cookies, sanitized output, CSRF + rate-limit coverage on state-changing endpoints, redacted logs, and clean dependencies.

## When to activate

Activate this skill whenever the user:

- builds, tags, or scans a container image, or asks about CVEs / `trivy` / `grype` / `docker scout` output
- writes or edits anything that handles secrets, credentials, tokens, API keys, passwords, or `.env` files
- accepts user-supplied input (HTTP body/query/headers, form data, file uploads, webhooks, message payloads)
- writes or edits database queries, ORM calls, or raw SQL
- touches authentication, authorization, sessions, cookies, JWTs, or row-level security policies
- renders user-provided content (HTML, Markdown, SVG) or configures CSP / security headers
- adds a state-changing endpoint (POST/PUT/PATCH/DELETE) and needs CSRF / rate-limit coverage
- writes log statements or error responses that could leak sensitive data
- updates `package.json` / `pyproject.toml` / lock files, or runs `npm audit` / `pip-audit` / Dependabot work

Do NOT activate for purely cosmetic changes (formatting, renaming an internal-only variable, comment edits) or for conceptual questions that don't touch code, config, or infrastructure.

## Pattern

### 1. Container image CVE policy

Every image built from this repo MUST be scanned before it ships, and the result MUST meet this bar:

- **CRITICAL / HIGH: zero tolerated.** Fix every one — bump the base image, upgrade the offending package, or switch to a slimmer base. Do not ship until the count is zero.
- **MEDIUM / LOW: fix if it's an easy fix** (a base-image bump or a single-package upgrade with no breaking change). Otherwise, **report the counts** in the PR / status update so the user can make an informed call.

Run the scanner against the actual built tag, not just the base:

```bash
# Trivy (preferred — also works in CI)
trivy image --severity CRITICAL,HIGH --exit-code 1 myapp:local
trivy image --severity MEDIUM,LOW   --exit-code 0 myapp:local   # report only

# Or: docker scout / grype — pick one and stick with it
docker scout cves myapp:local
grype myapp:local
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
- [ ] `.env`, `.env.local`, `.env.*.local` are in `.gitignore`. Only `.env.example` (with placeholder values) is committed.
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

Verification checklist:

- [ ] Every external input (HTTP, webhook, message payload, file upload) goes through a schema.
- [ ] File uploads enforce size, MIME, and extension — all whitelist.
- [ ] No raw user input flows directly into queries, file paths, shell commands, or `eval`.
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

**Authorize before you act.** The auth check happens at the top of the handler, before the side effect.

```ts
export async function deleteUser(userId: string, requesterId: string) {
  const requester = await db.users.findUnique({ where: { id: requesterId } });

  if (requester?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

Verification checklist:

- [ ] Session/auth tokens stored in `HttpOnly; Secure; SameSite=Strict` (or `Lax`) cookies. Never in `localStorage` or `sessionStorage`.
- [ ] Every handler that mutates state checks the caller's identity AND permission before doing the work.
- [ ] Multi-tenant tables have RLS (or an equivalent enforced filter) so a missing handler check still can't leak data.
- [ ] Role / permission checks happen server-side; the UI hint is not the source of truth.
- [ ] Sessions can be revoked (server-side store or short-lived JWT + refresh token).

### 6. XSS prevention

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

Set a **Content Security Policy** at the edge:

```js
// next.config.js (or equivalent reverse-proxy header)
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
    `
      .replace(/\s{2,}/g, " ")
      .trim(),
  },
];
```

Verification checklist:

- [ ] All user-provided HTML passes through a sanitizer (DOMPurify, bleach, etc.) before render.
- [ ] CSP header is set; `script-src` avoids `'unsafe-inline'` / `'unsafe-eval'` unless there is a documented reason.
- [ ] `frame-ancestors 'none'` (or an explicit allowlist) is set to prevent clickjacking.
- [ ] No `dangerouslySetInnerHTML` / `v-html` / `innerHTML` on raw user input.

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
- [ ] Auth-adjacent routes (login, signup, forgot-password, token-refresh) have stricter limits than ordinary routes.
- [ ] Rate-limit responses use `429 Too Many Requests` with a `Retry-After` header.

### 9. Sensitive data exposure

**Logs and error responses are the two most common leak surfaces.** Redact at the source.

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

Verification checklist:

- [ ] No passwords, tokens, secrets, full PANs, CVVs, full SSNs, or session IDs in logs. PII is logged only when necessary, with a documented retention window.
- [ ] 5xx responses return a generic message + correlation ID. Stack traces and internal exception messages stay server-side.
- [ ] 4xx responses say what the client did wrong without revealing schema/table/column names or whether a user/email exists (for auth flows, prefer "if an account exists, we sent an email").
- [ ] Structured logger has a redaction list (cookie headers, `authorization`, `password`, `token`, `secret`, etc.).

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
- [ ] `npm audit` / `pip-audit` is clean of HIGH/CRITICAL findings, or each finding has a documented exception.
- [ ] Automated dependency updates are on (Dependabot, Renovate) with grouped PRs to keep noise low.
- [ ] New dependencies are evaluated for: maintenance status, transitive footprint, known advisories, and whether the standard library / existing dep already covers it.

## Standard verification flow

Before reporting a security-relevant change as done:

1. **Scan** — run the image scanner (`trivy image …`) and the dependency auditor (`npm audit` / `pip-audit`). Report the results.
2. **Grep for footguns** — `grep -rE '(api[_-]?key|secret|password|token)\s*=\s*["\x27]' src/` and `grep -rE 'localStorage\.(set|get)Item\(["\x27](token|session|jwt)' src/`. Investigate any hits.
3. **Walk the new endpoints** — each new state-changing route gets: input schema, authz check, CSRF check (if cookie-auth), rate limit, redacted error path.
4. **Walk the new queries** — each new query is parameterized; each new render of user content is sanitized.
5. **Re-state the unfixed MEDIUM/LOW count** so the user has the number, not just "looks fine".

**Remember**: security is a posture, not a checklist. When a rule conflicts with a real requirement, document the deviation and the compensating control instead of silently turning the rule off.
