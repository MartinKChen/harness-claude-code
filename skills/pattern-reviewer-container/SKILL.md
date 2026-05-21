---
name: pattern-reviewer-container
description: "Docker / compose audit: Dockerfile is multi-stage (`base`/`build`/`final`); tags pinned (no `:latest`) and `docker scout` shows zero MEDIUM+ CVEs with available fixes; non-root user with every writable path redirected (PID, cache, nginx `*_temp_path`); `.dockerignore` excludes secrets / build outputs / IDE folders; backend entrypoint runs `alembic upgrade head` before exec'ing the server; `/healthz` endpoint exists and is no-dep; frontend nginx puts API `location` blocks ABOVE the SPA `try_files` fallback; no secrets baked into the image."
---

# pattern-reviewer-container

## When to activate

- Reviewing a diff that touches `Dockerfile`, `docker-compose.yaml` / `.yml`, `compose.yaml` / `.yml`, `.dockerignore`, or backend entrypoint scripts.
- A user says "review the Docker setup / image build / compose wiring".

## Iron rules

## Patterns to review

### Multi-stage build (HIGH)

- Dockerfile has at least three stages: `base`, `build`, `final` (use `AS` aliases).
- Single-stage Dockerfile → flag.
- `final` stage carries build tools / dev deps → flag (ship a minimal runtime).

### Pinned tags + `docker scout` (HIGH)

- `:latest` anywhere → flag.
- Pinned major-only tag (`node:20`) → flag; use full immutable tag (`node:20.11.1-alpine`).
- `docker scout cves <image>` reports MEDIUM+ CVEs that have a fix available → flag; bump to the fixed tag.
- Production base images can additionally use digest pinning (`@sha256:...`) — informational.

### Non-root user (HIGH)

- `final` stage ends with `USER <name>` (not `USER root` or no `USER`) → flag.
- Process tries to write to root-owned paths (`/run/nginx.pid`, `/var/cache/nginx`, `/var/run/...`) → HIGH. Fixes:
  1. Redirect writable paths to `/tmp/...` via server config — for nginx, `pid /tmp/nginx.pid;` + `client_body_temp_path /tmp/client_body`, etc.
  2. Recursive `chown -R app:app /usr/share/nginx/html` (or equivalent) in the build stage BEFORE `USER`.
- The container starts but dies on first write attempt (`[emerg] open() "/run/nginx.pid" failed (13: Permission denied)` or equivalent) → flag.

### No in-image virtualenvs (MEDIUM)

- `RUN uv venv` or `python -m venv .venv` inside a Dockerfile → flag.
- `uv pip install --system -r requirements.txt` (system site-packages) → correct.

### `.dockerignore` mandatory (HIGH)

- No `.dockerignore` next to the Dockerfile → flag.
- `.dockerignore` doesn't exclude: `.git`, `node_modules`, `.env*`, `dist/`, `build/`, `coverage/`, `*.log`, `.vscode`, `.idea` → MEDIUM.
- `.env` accidentally in the build context (not excluded) → CRITICAL (potential secret leak into image history).

### Layer ordering (LOW)

- `COPY . .` before `COPY package*.json + npm ci` → flag (dep layer cache never hits on source edits).

### Backend entrypoint (HIGH)

- Backend image owns its DB schema but no migration step in entrypoint → flag.
- Migration step in `CMD` instead of `ENTRYPOINT` → flag (CMD is the server).
- Migration step in a FastAPI `startup` hook instead of the entrypoint → flag (the app accepts traffic against a stale schema; N replicas race).
- Migration CLI (`alembic`) missing from `final` stage even though entrypoint calls it (`command not found: alembic`) → flag; copy the CLI from the build stage or install it in `final`.
- Missing `exec` on the server line in the entrypoint (`uvicorn ...` instead of `exec uvicorn ...`) → MEDIUM (SIGTERM doesn't forward to the server).

### `/healthz` endpoint (HIGH)

- Backend exposes no `/healthz` route → flag; the pre-push hook's `container:smoke-health` probe can't pass.
- `/healthz` requires auth → flag.
- `/healthz` touches the DB or an external API → flag; move that to `/readyz`.
- `/healthz` takes >100ms → flag.

### Frontend nginx ordering (HIGH)

```nginx
# BAD — try_files catches /api/* too; backend POSTs receive index.html
server {
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
  location /api/ {
    proxy_pass http://backend:8000;
  }
}

# GOOD — API location blocks ABOVE the SPA fallback
server {
  location = /health {
    proxy_pass http://backend:8000/health;
  }
  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- `try_files $uri $uri/ /index.html` missing → flag (any SPA route 404s on direct load).
- `try_files` without `$uri/` → flag (directory-path requests 404).
- The pre-push hook's `container:smoke-api-proxy` probe detects this exact misconfig by `Content-Type` (`text/html` on an API probe = SPA catch-all intercepted).

### Secrets in image (CRITICAL)

- `ENV API_KEY=...` / `ARG API_KEY=...` / `COPY .env ./` in Dockerfile → CRITICAL.
- Hardcoded values in `docker-compose.yaml` `environment:` (committed) → CRITICAL.
- Use `${VAR}` in compose `environment:` pulling from host env / `.env` (gitignored).

### Networking (MEDIUM)

- `ports:` on internal services (DB, cache, queue) that the host doesn't need → flag; use `expose:` (or omit, since compose networks allow all ports between services).
- Publishing a dev-only port without binding to `127.0.0.1` (e.g. `"5432:5432"` instead of `"127.0.0.1:5432:5432"`) → flag (reachable on the LAN).

### Volumes (LOW)

- Named volume for persistent state present and declared at top level → correct.
- Bind mount over an in-image path that has generated content (e.g. `node_modules`) without an anonymous-volume shield → flag.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/Dockerfile` | Three-stage Node Dockerfile reference; compare the project's Dockerfile against this. |
| `templates/docker-compose.yaml` | `app` + `db` services with healthcheck + named volume reference. |
| `templates/.dockerignore` | Exclusions reference for `.dockerignore` audits. |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
