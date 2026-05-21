---
name: pattern-engineer-container
description: "Containerized setups: every Dockerfile is multi-stage (`base`/`build`/`final`), pinned (no `:latest`) and vetted via `docker scout`, non-root with writable paths redirected, no in-image virtualenvs, `.dockerignore` required. Backends `alembic upgrade head` in entrypoint before exec'ing the server; expose fast `/health`. Frontend nginx puts API `location` blocks ABOVE the SPA `try_files` fallback. Secrets are runtime env vars. Activate on Dockerfile, compose, `.dockerignore`."
---

# pattern-engineer-container

Engineer-side bullet reminders for container work. Detailed audit criteria + trap stories live in `pattern-reviewer-container`. Drop-in starting files live in `templates/`.

## When to activate

Activate when editing `Dockerfile`, `docker-compose.yaml` / `.yml`, `compose.yaml` / `.yml`, `.dockerignore`, or scaffolding container artifacts. Skip for Kubernetes / Helm / non-Docker runtimes without an explicit Docker tie-in.

## Patterns

### Dockerfile shape

- **Multi-stage, always at least three:** `base` (system deps + runtime), `build` (compile / bundle), `final` (minimal runtime).
- **Pinned tags, never `:latest`.** Use immutable tags (`node:20.11.1-alpine`, `python:3.12.4-slim`, `nginx:1.27.0-alpine`). Digest pinning (`@sha256:...`) for production base images.
- **Vet base images with `docker scout`** before pinning. Reject any image with MEDIUM+ CVEs that have a fix available; switch to the fixed tag.
- **Run as non-root** in `final`: `RUN addgroup -S app && adduser -S app -G app` then `USER app`.
- **Every writable path is user-writable.** Redirect PID files, cache, nginx `*_temp_path` (and `client_body_temp_path`, `proxy_temp_path`, `fastcgi_temp_path` when in use) to `/tmp/...` via config, AND recursively `chown` the app directory in the build stage before `USER`.
- **No virtual environments inside images.** Install Python deps system-wide (`uv pip install --system`); no `.venv` / `uv venv` in the Dockerfile.
- **`.dockerignore` is mandatory.** Exclude `.git`, `node_modules`, `.env*`, `dist/`, `build/`, `coverage/`, `*.log`, IDE folders.
- **Layer ordering:** copy dep manifests + install deps before copying source, so dep layers cache across source edits.

### Backend entrypoint

- Run `alembic upgrade head` (or framework equivalent) in the entrypoint script, BEFORE `exec`'ing the server.
- Copy the migration CLI into the final stage explicitly (or copy from build stage); `alembic` in the build stage is not enough.
- Use `exec` on the server line so PID 1 is the server (not the shell) and SIGTERM forwards correctly.

### `/health` endpoint

- Every backend exposes HTTP `/health`: 200 on normal boot, no auth, no DB / external-dep call, <100ms.
- Separate `/ready` path (different URL) for readiness checks that DO touch the DB.

### Frontend nginx

- **API `location` blocks go ABOVE the SPA `try_files` fallback.** Putting `try_files $uri $uri/ /index.html` at the top catches `/api/...` too and returns `index.html` as the response body.
- Order: `/health` → API prefixes (each with its own `location`) → root `location /` with `try_files`.
- `try_files $uri $uri/ /index.html` is mandatory for any SPA — without `$uri/`, directory-path requests 404.
- Pre-push hook's `container:smoke-api-proxy` probe catches misconfig by `Content-Type` (`text/html` on an API probe = SPA catch-all intercepted).

### Secrets

- Runtime env vars only. Never `COPY` / `ARG` / `ENV` baked into the image.
- Read from `.env` (gitignored) or host environment / secret manager.
- For prod: `secrets:` (file-based) in Swarm; platform secret store (Vercel / Railway / Fly / SSM) on managed hosts.

### Networking

- Default to internal-only. `ports:` publishes to the host (use sparingly, user-facing only).
- `expose:` documents intra-network ports (optional but useful).
- Bind to `127.0.0.1` (`"127.0.0.1:5432:5432"`) when publishing dev-only ports.

### Volumes

- **Named volume** (`db_data:/var/lib/postgresql/data`): persistent state across restarts (DBs, queues, caches).
- **Bind mount** (`./src:/app/src`): development source for live reload.
- **Anonymous volume** (`/app/node_modules`): preserve container-generated content from bind-mount shadowing.

### `docker compose` commands

Prefer `docker compose` (V2 plugin) over the legacy `docker-compose` binary.

| Operation | Command |
|-----------|---------|
| Follow logs | `docker compose logs -f <service>` |
| Exec shell | `docker compose exec <service> sh` |
| Rebuild changed images | `docker compose up --build` |
| Force full rebuild | `docker compose build --no-cache <service>` |
| Stop + remove | `docker compose down` |
| Stop + remove + wipe named volumes (DESTRUCTIVE) | `docker compose down -v` |

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/Dockerfile` | Three-stage Node Dockerfile (base + build + final), pinned `node:20.11.1-alpine`, non-root `app` user, `tini` as PID 1. |
| `templates/docker-compose.yaml` | `app` + `db` (Postgres `16.3-alpine`) services with healthcheck, named `db_data` volume, host-bound `127.0.0.1:3000` mapping. |
| `templates/.dockerignore` | Excludes `.git`, `node_modules`, `.env*`, build outputs, IDE folders, and `Dockerfile*` / `docker-compose*` from the build context. |

## Related skills

| Skill | Purpose |
|-------|---------|
| `pattern-engineer-coding-standard` | Always. |
| `pattern-engineer-database` | When the migration story touches the `migrate` compose service. |
| `pattern-engineer-backend-standard` | When wiring `/health`, env-var loading, graceful shutdown. |
| `pattern-engineer-security` | For CVE / secrets handling on the image. |
| `pattern-reviewer-container` | Detailed audit criteria + trap stories (reviewer lens). |
