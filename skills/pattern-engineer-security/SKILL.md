---
name: pattern-engineer-security
description: "Engineer-facing security guardrails to follow while writing or editing production code. Encodes the non-negotiables — env-only secrets, schema-validated input at the boundary, parameterized queries, HttpOnly+Secure+SameSite cookies, authorize-before-act + ownership checks, sanitized output + the full security-header set, CSRF + per-route rate limits on cookie-auth state changes, redacted logs, generic 5xx + correlation id, locked dependencies, SSRF allowlists, locked-down CORS, HMAC verification on webhooks, OAuth state + PKCE, atomic balance/quota/token mutations. Reads as a quick-lookup catalogue keyed by the surface being touched (new endpoint, new query, auth path, rendering user content, dependency add, container build, logs, outbound HTTP, webhook, CORS, file upload). Activate when writing code."
---

# pattern-engineer-security

Security guardrails for production-code authoring. This skill is a quiet reference catalogue — the agent reads it to know which patterns to follow, *not* a checklist to walk through with the user. Reviewer feedback is the user-facing channel for security findings; this skill exists so most findings never happen.

## When to activate

- Writing or editing any production code that touches secrets, user input, queries, auth / sessions, output rendering, CSRF, rate limits, logging, errors, dependencies, outbound HTTP, webhooks, CORS, file uploads, or balance / quota / token mutations.
- Do NOT activate for purely cosmetic changes (formatting, renaming an internal-only variable, comment edits) or conceptual questions that don't touch code.

## Always do (no exceptions)

- **Validate every external input with a schema at the boundary** (Zod / Pydantic). Bound string lengths, numeric ranges, enum values. Trust internal callers; never trust the network.
- **Parameterize every database query** — ORM or bound parameters. Never concatenate / f-string user input into SQL, shell commands, file paths, or `eval`. Dynamic table / column names come from a hardcoded whitelist.
- **Hash passwords with argon2id (preferred) / bcrypt(≥12) / scrypt.** Never store plaintext. Use the library's constant-time verify — never `==` or `bcrypt.compare` without `await`.
- **Run constant-time on auth enumeration paths.** Login / forgot-password verify against a sentinel hash when the account doesn't exist so timing leaks `exists` vs `doesn't exist`. Pin the floor with a regression test.
- **Set session cookies `HttpOnly; Secure; SameSite=Strict`** (or `Lax` if cross-site nav is required). The `Secure` / `SameSite` attributes come from an env knob (`SECURE_COOKIES`, default `true`) read at the call site — not from a fully-populated `Settings()` that test fixtures can't satisfy. Store auth tokens in cookies, never `localStorage`.
- **Authorize before acting.** Every handler that mutates state checks identity AND ownership/role server-side — authentication answers "who is this?", authorization answers "are they allowed to do this *to this resource?*" (skipping the second produces IDOR). Multi-tenant tables get RLS where the DB supports it.
- **Encode output / sanitize HTML** before render. React escapes by default; reach for `dangerouslySetInnerHTML` only after a sanitizer (DOMPurify / bleach) with an allowlist of tags + attributes.
- **Set the full security-header set** at the edge: CSP (`default-src 'self'`, `frame-ancestors 'none'`), HSTS (`max-age=31536000; includeSubDomains`), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy disabling unused capabilities.
- **CSRF token on every cookie-authed state-changing request.** Pair with `SameSite` cookies as defense-in-depth.
- **Rate-limit every public endpoint** — per-IP at minimum, per-user on authenticated routes. Stricter limits on auth-adjacent routes (login, signup, forgot-password, token-refresh). Rate-limit responses use 429 + `Retry-After`.
- **Read secrets from env vars** (or a typed Settings that does). `.env*`, `*.pem`, `*.key` in `.gitignore`; only `.env.example` (placeholder values) committed. If a secret leaked, rotate it — purging git history is not enough.
- **Lock dependencies.** Commit `package-lock.json` / `uv.lock` / `poetry.lock`; CI uses `npm ci` / `uv sync --locked` / `poetry install --no-update`.
- **Atomic mutations for balance / quota / token redemption.** `UPDATE … SET balance = balance - :a WHERE … AND balance >= :a` (check rowcount), or `SELECT … FOR UPDATE` inside a transaction. Token redemption (reset, MFA, OTP, magic-link) marks-then-checks atomically so second attempt returns rowcount=0.
- **Validate JWTs when used.** Signature + algorithm (reject `alg: none`) + `exp` + `iss` + `aud` where relevant.
- **Sessions can be revoked.** Server-side session store, or short-lived JWT + refresh-token rotation with a revocation list — never a long-lived bearer JWT with no revocation path.
- **Reset tokens are time-limited (≤1 hour) and single-use.** Password-reset completion does NOT issue a session and does NOT auto-navigate to authed routes — the server returns 204 and the SPA navigates to `/login`.
- **CORS origin is an explicit env-driven list.** Never `*` in production; especially never `*` with `credentials: true`. `methods` and `allowedHeaders` are explicit, not `*`.
- **SSRF guard on user-controlled outbound URLs.** Host allowlist + scheme allowlist (`https:`) + block private/link-local/loopback ranges (resolve the hostname; don't trust the literal) + `redirect: "manual"` + timeouts.
- **Verify webhook signatures (HMAC) before parsing the body.** Constant-time compare (`timingSafeEqual` / `hmac.compare_digest`). Replay protection by event-ID dedupe or timestamp window.
- **OAuth public clients use PKCE; every OAuth callback validates `state`.** Third-party CDN `<script>` tags carry SRI hashes (`integrity="sha384-..."` + `crossorigin="anonymous"`).
- **Container images scanned before they ship.** Trivy / Docker Scout / Grype against the slug-tagged image; CRITICAL/HIGH count must be 0; MEDIUM/LOW counts reported.

## Never do

- Commit secrets — API keys, tokens, passwords, signing keys, connection strings.
- Log passwords, tokens, full PANs, CVVs, full SSNs, session IDs, raw user-supplied emails on failure paths. Log identifiers (user_id, request_id), not secrets.
- Log the same sensitive value at two layers — pick one (usually the outermost where the value is still in scope) and log there only.
- Trust client-side validation as a security boundary.
- Disable security headers, CSRF, rate limits, or CSP rules to make a feature work — if they're in the way, satisfy them.
- Use `eval()` / `innerHTML` / `dangerouslySetInnerHTML` / `v-html` with raw user input.
- Store sessions in `localStorage`, `sessionStorage`, or any JS-accessible storage.
- Expose stack traces, internal exception messages, schema names, or table names in 5xx (or 4xx) responses — generic message + correlation ID.
- Auto-login on password-reset completion. Consume the token, update the hash, return 204; the SPA navigates to `/login`.
- Wildcard CORS with credentials. `origin: '*'` + `credentials: true` is an exfiltration channel.
- `fetch(userProvidedUrl)` server-side without a host allowlist + private-IP-range block.
- Compare HMAC / MAC / signatures with `==`. Use a constant-time compare.
- Concatenate / interpolate user input into SQL, shell commands, file paths, or `eval`.
- Pre-create extensions / fixtures in shared session-scope test setup that the migration is supposed to install — the migration must own its own lifecycle.
- Use SHA-256 / MD5 for password hashing (those are checksums, not password hashes).
- Reveal in error bodies or timing whether a user / email exists — for auth flows, prefer "if an account exists, we sent an email".

## Quick lookup — patterns by surface

| Surface being touched | Patterns to follow |
| --- | --- |
| New POST/PUT/PATCH/DELETE endpoint | input schema at the boundary • authorize-before-act + ownership check • CSRF if cookie-auth • rate limit • redacted error path • request-id on all responses |
| New DB query | parameterized • LIMIT on user-facing reads • `FOR UPDATE` / atomic UPDATE on balance / quota / counter writes • whitelist for dynamic identifiers |
| Auth path (login / reset / OAuth / MFA) | constant-time vs hit/miss via sentinel hash • no auto-login on reset • token expiry + single-use + atomic consumption • OAuth `state` + PKCE • JWT sig/exp/iss/aud validated • sessions revocable |
| Password / credential storage | argon2id / bcrypt(≥12) / scrypt • library verify, never `==` • sentinel hash for missing-user branch |
| Rendering user-provided content | sanitize (DOMPurify / bleach) with tag+attr allowlist • CSP allows it without `unsafe-inline` in script-src • no `dangerouslySetInnerHTML` / `v-html` / `innerHTML` on raw input |
| Edge / response headers | CSP • HSTS • X-Frame-Options DENY • X-Content-Type-Options nosniff • Referrer-Policy • Permissions-Policy |
| Adding a dependency | `npm audit` / `pip-audit` clean of HIGH/CRITICAL • lock file committed • CI uses reproducible install • new dep evaluated for maintenance / transitive footprint / advisories |
| Building a container image | trivy scan: CRITICAL/HIGH = 0 • MEDIUM/LOW reported • slug-tagged image, not `:latest` |
| Touching logs or error responses | no secrets / tokens / PII in logs • structured-log redaction key matches emitted key exactly (case-sensitive) • log a sensitive value at exactly one layer • request-id middleware registered last so it runs first on rejection paths • generic 5xx + correlation id • 4xx hides schema/table/column names |
| Touching API response serializers | sensitive fields (`passwordHash`, `resetToken`, `mfaSecret`, …) stripped at the serializer — unit test fails if a new sensitive field appears without entering the strip list |
| Outbound HTTP from server (SSRF risk) | host allowlist • scheme allowlist (`https:`) • block private / link-local / loopback ranges (resolve before fetching) • timeouts • `redirect: "manual"` |
| Webhook receiver | HMAC verified before parsing the body • constant-time compare • dedupe / replay window |
| Cross-origin browser access | CORS `origin` is an explicit env-driven list (never `*` with credentials) • `methods` and `allowedHeaders` explicit • `maxAge` reasonable |
| File upload | size + MIME + extension whitelist • magic-byte check on high-trust uploads (avatars, payment attachments) |
| Migrations / DB extensions | migration owns extension lifecycle (`CREATE EXTENSION` in upgrade, `DROP EXTENSION` in downgrade) — never pre-warm in `conftest.py` |

## Guardrails — internal warning signs while authoring

If any of the patterns below is forming under the keyboard, the surrounding code is on a path the catalogue above forbids. Re-shape the code against the matching row before committing — do not surface to the user, just fix it:

- User input flowing into a query, shell command, file path, `eval`, or a server-side `fetch(url)`.
- A new endpoint missing one of: input schema, authorize-before-act, CSRF (if cookie-auth), rate limit.
- A login / signup / forgot-password / token-refresh route with no rate limit, or with a per-IP-only limit when authenticated requests are expected.
- A stack trace or internal exception message in a 5xx response body.
- A new dependency with known CRITICAL / HIGH advisories on its current version.
- A balance / inventory / quota update without a row lock or atomic-compare.
- A reset endpoint that calls `set_cookie("session", …)` or whose client invalidates `['me']` on success.
- An OAuth callback that doesn't validate `state`, or a public client without PKCE.
- A webhook handler that parses the body before verifying the signature.
- `fetch(req.body.url)` with no host allowlist and no private-range block.
- A CORS configuration with `origin: '*'` and `credentials: true`.
- An `==` comparison on a password hash, HMAC, or signature.
- A logger call with `password=…`, `token=…`, `email=<raw email>`, `card_number=…` in the structured fields.
- A `Settings()` call inside `create_app()` purely to read the cookie-secure boolean — break the boolean out into a standalone `os.getenv()` helper instead.

## Common rationalizations to push past

| Rationalization | Reality |
| --- | --- |
| "This is an internal tool, security doesn't matter" | Internal tools get compromised. Attackers target the weakest link. |
| "We'll add security later" | Security retrofitting is 10x harder than building it in. Add it now. |
| "No one would try to exploit this" | Automated scanners will find it. Security by obscurity isn't security. |
| "The framework handles security" | Frameworks provide tools, not guarantees. You still have to use them correctly. |
| "It's just a prototype" | Prototypes become production. Security habits from day one. |
