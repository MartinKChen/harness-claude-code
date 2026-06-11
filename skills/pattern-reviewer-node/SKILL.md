---
name: pattern-reviewer-node
description: "Node.js runtime audit for server-side code: blocking `*Sync`/heavy `JSON.parse` on request paths; missing `unhandledRejection`/`uncaughtException` or no SIGTERM `server.close` drain; scattered `process.env` / no zod config / `dotenv` at prod scope; floating promises + unwrapped Express async handlers; top-level side effects / no `createApp()`; `fetch` without `AbortSignal.timeout`; bare `.pipe()`; `console.log`; runtime `npm install`. Cites `file:line`. Activate on Node JS/TS or `package.json`."
---

# pattern-reviewer-node

Reviews server-side JavaScript/TypeScript running under Node for runtime-discipline defects: event-loop blocking, process lifecycle, config, module hygiene, and the Node toolchain. Pairs 1:1 with `pattern-engineer-node`.

## When to activate

- Reviewing a diff that includes Node server-side `.js` / `.ts` (Express / Fastify / Hono / Nest handlers, middleware, entrypoints, `worker_threads`, streams) or `package.json` `engines`/`scripts`.
- A user says "review the Node service / event-loop / shutdown / config".

Skip browser/Vite frontend code (`pattern-reviewer-typescript` territory), pure TS *type* findings (`pattern-engineer-typescript`), and language-agnostic backend wiring / auth (`pattern-engineer-backend-standard` / `pattern-engineer-security`). Flag only the **Node mechanics** here.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-node.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### Blocking the event loop (HIGH)

Detection: grep request-path/handler/middleware modules for `Sync(` — `readFileSync`, `writeFileSync`, `existsSync`, `scryptSync`, `pbkdf2Sync`, `randomBytes` used synchronously, `gzipSync`/`deflateSync`, `execSync`. Also flag multi-MB `JSON.parse`/`JSON.stringify` and tight synchronous loops over large arrays on hot paths.

```js
// BAD — blocks every other request while it reads
app.get("/report", (req, res) => {
  const tpl = fs.readFileSync("./big-template.html", "utf8");
  res.send(render(tpl));
});

// GOOD — async I/O, event loop stays free
app.get("/report", async (req, res) => {
  const tpl = await fs.promises.readFile("./big-template.html", "utf8");
  res.send(render(tpl));
});
```

CPU-heavy work belongs in a `worker_thread` or queue, not the main thread.

False-positive guards: `*Sync` calls are fine in **startup/bootstrap code, CLI scripts, build tooling, and migrations** (run once, no concurrent traffic). A small static config read at boot is fine. Only flag synchronous work on a per-request / per-event hot path.

### Process lifecycle — crash handlers + graceful shutdown (HIGH)

Detection: grep the entrypoint for `unhandledRejection`, `uncaughtException`, `SIGTERM`, `server.close`. A long-running server with none of these is the finding.

```js
// BAD — keeps serving in an unknown state; never drains on deploy
const server = app.listen(port);

// GOOD
process.on("unhandledRejection", (err) => { logger.fatal({ err }); process.exit(1); });
process.on("uncaughtException", (err) => { logger.fatal({ err }); process.exit(1); });

const server = app.listen(port);
process.on("SIGTERM", () => {
  server.close(() => { pool.end(); logger.flush?.(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref(); // hard-exit fallback
});
```

Flag: missing crash handlers; a handler that swallows and keeps serving (logs but doesn't exit non-zero); SIGTERM without `server.close` + pool/connection teardown; no hard-exit timeout fallback.

False-positive guards: a short-lived CLI / one-shot script / serverless function handler doesn't own signal handling — the platform does. Only flag persistent servers. (The *requirement* for graceful shutdown is `pattern-engineer-backend-standard`; flag the **Node wiring** of it here.)

### Config — one typed module, no scattered `process.env` (HIGH)

Detection: grep for `process.env.` across the codebase. More than a handful of distinct read sites outside one config module → scattered config. Check that the config module validates (zod `.parse`) and fails fast.

```js
// BAD — read inline, all over, unvalidated, silently undefined
const ttl = Number(process.env.CACHE_TTL); // NaN if unset, no error

// GOOD — one validated module, fails fast with the full missing list
// config.js
export const config = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  CACHE_TTL: z.coerce.number(),
}).parse(process.env);
```

Flag: `process.env.X` reads sprinkled through handlers/services; no boot-time validation (so a missing key surfaces as a runtime `undefined` deep in a request); `import "dotenv/config"` (or `dotenv.config()`) imported at production module scope rather than only in the dev entrypoint / via `--env-file`.

False-positive guards: a single read inside the one config module is correct, not a violation. `process.env.NODE_ENV` checks are conventionally fine inline.

### Floating promises + unwrapped async handlers (HIGH)

Detection: look for `async` functions called without `await`/`.then`/`.catch`/`void`; Express 4 routes registered with `async` handlers and no wrapper; `.forEach(async …)`.

```js
// BAD — rejection becomes an unhandledRejection; Express 4 won't catch it
app.get("/u/:id", async (req, res) => {
  const user = await db.find(req.params.id); // if this throws → crash/hang
  res.json(user);
});
sendEmail(user); // floating: a rejection is lost

// GOOD
app.get("/u/:id", wrap(async (req, res) => { ... }));      // or Express 5 / Fastify
sendEmail(user).catch((err) => logger.error({ err }));     // explicit fire-and-forget
```

Flag: an awaitable call whose promise is neither awaited nor `.catch`-handled nor `void`-marked; Express ≤4 async handler with no wrapper. Pair with `pattern-engineer-typescript`'s `forEach(async)` rule.

False-positive guards: Fastify and Express 5 catch async-handler rejections natively — don't demand a wrapper there. A promise intentionally fire-and-forget **with** a `.catch` is fine.

### `fetch` / outbound calls without a timeout (MEDIUM)

Detection: grep for `fetch(` and `http.request`/`https.request`; check for `signal:`/`AbortSignal.timeout`/`setTimeout` abort.

```js
// BAD — hangs forever if the peer stalls, pinning a connection
const res = await fetch(url);

// GOOD
const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
```

False-positive guards: a thin SDK wrapper that configures timeouts at the client level is fine — don't double-flag. (SSRF/allowlisting is `pattern-engineer-backend-standard`/`security`, not here.)

### Bare `.pipe()` stream chains (MEDIUM)

Detection: grep for `.pipe(`; flag chains without a `pipeline(...)` wrapper or per-stream `error` handlers.

```js
// BAD — an error on any stage is unhandled; sources leak on failure
fs.createReadStream(src).pipe(gzip).pipe(res);

// GOOD
import { pipeline } from "node:stream/promises";
await pipeline(fs.createReadStream(src), gzip, res);
```

False-positive guards: a single `.pipe()` between two trusted in-memory streams with an attached `error` listener is acceptable; the hazard is multi-stage chains that drop errors.

### Side-effectful module top-level / no `createApp()` factory (HIGH)

Detection: look for `app.listen(`, `.connect(`, `createPool(`, or work kicked off at module top level (not inside a function/factory). Check whether the app is built by an exported factory separate from the listen entrypoint.

```js
// BAD — importing this binds a port and connects a DB as a side effect
const app = express();
app.use(routes);
app.listen(3000);          // tests can't import without a live port
export default app;

// GOOD — factory split from entrypoint
export function createApp(deps) { const app = express(); app.use(routes(deps)); return app; }
// server.js
createApp(deps).listen(config.PORT);
```

Flag: `listen`/DB-connect at import time; no factory seam so tests must bind a real port; module-load side effects generally.

False-positive guards: the dedicated entrypoint file (`server.js`/`index.js`) *should* call `listen` at top level — that's its job. Only flag side effects in modules that are also imported elsewhere (especially by tests).

### Circular imports (MEDIUM)

Detection: a module whose export reads as `undefined` at load time, or `madge --circular`; mutual `import` between two modules.

False-positive guards: type-only cycles (`import type`) are erased at compile time and harmless — don't flag those.

### `console.log` in production paths (MEDIUM)

Detection: grep for `console.log`/`console.error`/`console.warn` in `src/` server modules.

```js
// BAD
console.log("user", userId, "logged in");
// GOOD
logger.info({ user_id: userId }, "login");
```

False-positive guards: `console.*` is fine in **scripts/, tools/, CLI entrypoints, and seed/migration files**. The structured logger's own transport may legitimately use `console` under the hood.

### Runtime + packaging (MEDIUM)

Detection: check `package.json` for `engines.node` and a matching `.nvmrc`; grep Dockerfile/CI/entrypoints for `npm install` (vs `npm ci`); check `"type": "module"` for new services.

- No `engines.node` pin or `.nvmrc` (or the two disagree) → MEDIUM.
- `npm install` in a Dockerfile/CI/entrypoint instead of `npm ci` against the committed lockfile → MEDIUM; missing/uncommitted lockfile → HIGH.
- Runtime `npm install` or dynamic remote `import()` of untrusted code → HIGH.
- A new service authored in CommonJS (`require`) rather than ESM (`"type": "module"`) → LOW (informational; existing CJS services are fine).

False-positive guards: an established CommonJS codebase need not be flagged file-by-file. Lockfile-install lives partly in `pattern-engineer-backend-standard`; flag the Node-specific `npm ci`/lockfile mechanics here.

### Tests bind a real port / real timers (MEDIUM)

Detection: test files calling `.listen(`, hardcoded ports, or real `setTimeout` waits for time-dependent logic.

- Test spins up a listening server instead of `supertest(createApp())` / Fastify `inject` → MEDIUM.
- Real-clock waits for timeout/retry/interval logic instead of fake timers → MEDIUM.

(Coverage substance lives in the shared `pattern-test-coverage`.)

## Constructing the finding

Use the shape in `templates/review-comment.md`.
