---
name: pattern-engineer-node
description: "Node.js runtime for server-side JS/TS (Express/Fastify/Hono/Nest): Node LTS via `engines`+`.nvmrc`; ESM; `npm ci`; never block the event loop — no `*Sync`/heavy `JSON.parse` in request paths, CPU to `worker_threads`; `unhandledRejection`/`uncaughtException` exit non-zero; SIGTERM `server.close`+drain; one zod `process.env` config; pino not `console.log`; await/`.catch` promises; `AbortSignal.timeout` on `fetch`; `createApp()` split from listen. Activate on Node server code + `package.json`."
---

# pattern-engineer-node

Node-specific runtime discipline for server-side JavaScript/TypeScript: the event loop, process lifecycle, configuration, module hygiene, and the Node toolchain. This is the runtime sibling to `pattern-engineer-typescript` (which owns the TS language) — the relationship mirrors `pattern-engineer-python` for the Python backend.

## When to activate

Activate when writing or editing server-side JS/TS that runs under Node: Express / Fastify / Hono / Nest handlers and middleware, `process`-level lifecycle code, `process.env` config loading, a Node entrypoint or `package.json` `scripts`/`engines`, `worker_threads`, streams, outbound `fetch`, or Node test files (vitest / `node:test` / supertest).

Skip when:

- The code is browser/Vite frontend JS/TS — `pattern-engineer-typescript` and `pattern-engineer-vite` own that.
- The concern is a pure TypeScript *language* rule (types, `any`, discriminated unions, `tsconfig` strictness) — that stays in `pattern-engineer-typescript`.
- The concern is language-agnostic backend wiring (`.env.example` lockstep, the SIGTERM *concept*, retries/backoff, `/healthz` shape) — `pattern-engineer-backend-standard` owns it; this skill owns only the **Node mechanics** of those concepts. Auth/SSRF/secret handling belong to `pattern-engineer-security`.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-node.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Runtime + packaging

- Pin a Node LTS line: `"engines": { "node": ">=20" }` in `package.json` AND a matching `.nvmrc` — keep the two in lockstep.
- New services are ESM: `"type": "module"` in `package.json`; use `import`/`export`, not `require`/`module.exports`.
- Install with `npm ci` against the committed lockfile (`package-lock.json` / `pnpm-lock.yaml`); never `npm install` at runtime or in a container entrypoint.
- No on-the-fly dependency fetching in production code (`npm install`, dynamic remote `import()` of untrusted URLs).

### Don't block the event loop

- No `fs.*Sync`, `crypto.*Sync` (`randomBytes`/`scryptSync`/`pbkdf2Sync`), `zlib.*Sync`, or `child_process.execSync` in a request path — use the async/`promises` form.
- CPU-heavy work (hashing big buffers, image/crypto, large parse/transform) goes to `worker_threads` (or a queue), not the main thread.
- Beware multi-MB `JSON.parse` / `JSON.stringify` on hot paths — they block synchronously; stream or bound the size.
- Tight synchronous loops over large arrays block too; chunk or offload.

### Process lifecycle (Node mechanics of the backend-standard SIGTERM rule)

- Register `process.on('unhandledRejection', …)` and `process.on('uncaughtException', …)`: log structurally, then exit non-zero — never keep serving in an unknown state.
- On `SIGTERM` (and `SIGINT`): stop accepting new work (`server.close(...)`), let in-flight requests drain, close DB pools / queue connections, flush logs, then `process.exit(0)`.
- Arm a hard-exit timeout fallback (`setTimeout(() => process.exit(1), N).unref()`) so a stuck drain can't hang shutdown forever.
- `.unref()` background timers/intervals so they don't pin the process open during shutdown.

### Config — one typed module

- One config module validates `process.env` at boot with a zod schema and **fails fast**, reporting the full list of missing/invalid keys at once.
- No scattered `process.env.X` reads through the codebase — modules import the validated config object.
- `dotenv` is loaded only in the dev entrypoint (or via `node --env-file`), never `import`ed at production module scope.
- (`.env.example` lockstep is owned by `pattern-engineer-backend-standard`.)

### Logging

- `pino` (or equivalent structured JSON logger), one instance per service.
- No `console.log` / `console.error` in production request paths.
- Child loggers carry correlation context: `logger.child({ request_id })` per request.

### Async correctness

- Every promise is `await`ed or explicitly fire-and-forget with a `.catch(...)` — no floating promises.
- Express (≤4) async route handlers are wrapped (`express-async-handler` or a `wrap(fn)`) so rejections reach the error middleware; Express 5 / Fastify handle async rejection natively.
- Every outbound `fetch` carries a timeout: `fetch(url, { signal: AbortSignal.timeout(ms) })`.
- Choose `Promise.all` (fail-fast) vs `Promise.allSettled` (collect all) deliberately, per call site.
- Compose streams with `stream.pipeline()` (or `pipeline` from `node:stream/promises`) — never bare `a.pipe(b).pipe(c)` chains that drop errors and leak handles.
- No `array.forEach(async …)` — it ignores the returned promise (also flagged by `pattern-engineer-typescript`).

### Module hygiene

- No side effects at module top level — don't open a DB connection, bind a port, or kick off work at import time.
- Export a `createApp()` factory that builds and returns the app/server; a separate entrypoint (`server.ts` / `index.ts`) calls `createApp()` then `.listen(...)`, so tests inject the app without binding a port.
- No circular imports — they yield `undefined` exports at load time depending on resolution order; break the cycle with a shared module or dependency injection.

### Tests

- `vitest` (or `node:test`) as the runner.
- HTTP tests run against the app factory: `supertest(createApp())` for Express, Fastify's `app.inject(...)` — never spin up a real listening port.
- Fake timers (`vi.useFakeTimers()`) for time-dependent logic (timeouts, retries, intervals) instead of real `setTimeout` waits.
- (Coverage substance — what to test — lives in the shared `pattern-test-coverage`.)
