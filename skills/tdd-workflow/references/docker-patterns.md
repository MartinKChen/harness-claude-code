# docker-patterns

Standardize how containerized setups are authored in this project. Every Dockerfile is multi-stage, every image is pinned and non-root, every compose service exposes only what it needs, and volumes are chosen deliberately. The skill also encodes the day-to-day `docker compose` commands used to operate and debug services.

## When to activate

Activate this skill whenever the user:

- creates or edits a `Dockerfile`, `Dockerfile.*`, `docker-compose.yaml`, `docker-compose.yml`, `compose.yaml`, `compose.yml`, or `.dockerignore`
- asks to containerize / dockerize an app, scaffold a Dockerfile, or add a service to compose
- asks to shrink, slim, optimize, or harden an image (multi-stage, non-root, image size, attack surface)
- asks how to mount a volume, expose a port, wire a network, or inject secrets at runtime
- asks for the right `docker compose` command to view logs, exec into a container, rebuild, or clean up

Do NOT activate when the user is asking about Kubernetes manifests, Helm charts, or non-Docker container runtimes (containerd, podman, nerdctl) without an explicit Docker tie-in. Also skip when the user is only asking conceptual questions about containers without touching files.

## Pattern

### Multi-stage builds — always at least three stages

Every Dockerfile MUST split into at least `base` (system deps + runtime), `build` (compile / bundle / install dev deps), and `final` (minimal runtime image). This applies even for static frontends — the `final` stage copies the built static assets into a minimal server image.

```dockerfile
# syntax=docker/dockerfile:1.7

# 1. base — pinned runtime + shared system deps
FROM node:20.11.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini

# 2. build — install deps and compile/bundle
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 3. final — minimal runtime, non-root, only artifacts
FROM nginx:1.27.0-alpine AS final
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
USER app
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["nginx", "-g", "daemon off;"]
```

- **Three stages minimum**: `base`, `build`, `final`. Add more (e.g. `deps`, `test`) only when they earn their place.
- **CSR/SPA frontends still get a `final` stage**: copy the built static files (e.g. `dist/`, `build/`) into a minimal server image (nginx, caddy, distroless). Never ship the build toolchain.
- **Pinned tags, never `:latest`**: use immutable tags like `node:20.11.1-alpine`, `python:3.12.4-slim`, `nginx:1.27.0-alpine`. Prefer digest pinning (`@sha256:…`) for production base images.
- **Vet base images with `docker scout` before pinning**: run `docker scout cves <image>:<tag>` (or `docker scout quickview`) on every candidate base image. Reject any image that has CVEs at severity `MEDIUM` or above without an available fix. If a vulnerability is flagged but a fixed version exists, switch to that fixed tag/digest instead of accepting the risk. Re-run scout when bumping the base image.
- **Run as non-root**: create a dedicated user/group in `final` and end with `USER <name>`. Root in containers is a foot-gun.
- **Non-root means every writable path is user-writable.** Adding `USER app` is not enough — the process still needs to write a PID file, cache, temp scratch, and (for nginx) `*.tmp` upload bodies. The defaults for most upstream images point those paths at root-owned locations (`/run/nginx.pid`, `/var/cache/nginx`, `/var/run/...`). The container will start, then die the first time it tries to write — usually with `[emerg] open() "/run/nginx.pid" failed (13: Permission denied)` or the language equivalent. Two fixes, applied together:
  1. **Redirect every writable path to `/tmp/...`** (or another path the non-root user owns) via the server's config — for nginx, `pid /tmp/nginx.pid;` at the top of `nginx.conf`, plus `client_body_temp_path /tmp/client_body`, `proxy_temp_path /tmp/proxy`, `fastcgi_temp_path /tmp/fastcgi`, etc., when the corresponding feature is used.
  2. **Recursive chown the application directory** in the build stage, BEFORE `USER`: `RUN chown -R app:app /usr/share/nginx/html`. Chown does NOT follow symlinks, so any path the runtime touches via a symlink (or under a directory the image vendor created as root) still needs explicit redirection in config — chown alone never fixes upstream defaults.
- **No virtual environments inside images**: the container itself is the isolation boundary, so language-level venvs add layers, indirection, and PATH gymnastics for zero gain. Install Python deps directly into the system site-packages (e.g. `uv pip install --system -r requirements.txt`, `pip install --no-cache-dir -r requirements.txt`); do not create a `.venv` or use `uv venv` inside a Dockerfile. Same rule for any other ecosystem's per-project virtualenv tooling.
- **`.dockerignore` is mandatory**: exclude `.git`, `node_modules`, `.env*`, `dist/`, `build/`, `coverage/`, `*.log`, IDE folders. Keeps the build context small and prevents secrets from leaking into the image.
- **Layer ordering**: copy dependency manifests and install deps *before* copying source, so dep layers cache across source edits.

### Backend entrypoint — run migrations before serving

A backend image that owns its DB schema MUST run `alembic upgrade head` (or the framework equivalent: `prisma migrate deploy`, `rails db:migrate`, `python manage.py migrate`, `flyway migrate`) **before** exec'ing the server. The first slice that introduces a migration discovers this the hard way: the container starts, the first authenticated request hits the DB, and the response is `relation "users" does not exist`. Two parts must both land:

1. **Copy the migration CLI into the final stage.** A common shape is to install dev deps in `build` and only the runtime deps in `final` — which means `alembic` (or `prisma`, etc.) is present in the build stage and *missing* in the runtime image. The entrypoint then fails with `command not found: alembic`. Either install the CLI into the final stage explicitly, or copy the migration tool's binary from the build stage:
   ```dockerfile
   # final stage
   COPY --from=build /app/.venv /app/.venv
   ENV PATH="/app/.venv/bin:${PATH}"
   COPY alembic.ini ./
   COPY alembic ./alembic
   ```

2. **Wire the migration call into the entrypoint, not the CMD.** The CMD is the *server*; migrations belong in the entrypoint so the server doesn't try to serve traffic against an unmigrated DB:
   ```sh
   #!/usr/bin/env sh
   # docker-entrypoint.sh
   set -e
   alembic upgrade head
   exec uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
   ```dockerfile
   COPY --chown=app:app docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
   RUN chmod +x /usr/local/bin/docker-entrypoint.sh
   USER app
   ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
   CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
   ```
   `exec` is mandatory in the last line so PID 1 is the server (not the shell) and SIGTERM is forwarded for graceful shutdown.

The pre-push hook's `container:smoke-health` probe will catch a missing migration step — the `/health` endpoint can pass without DB, but anything that touches a table (signup, login, `/me`) will 500 the moment the smoke tests hit it.

### Health endpoint — every backend exposes one

Every backend container MUST expose an HTTP `/health` route that:
- returns **200** on a normal boot,
- requires **no authentication**,
- does NOT touch the database, an external API, or any other slow / failable dependency,
- returns within **<100ms** under no load.

The `/health` route is what CI's "wait for backend to be ready" loop polls, what the pre-push hook smokes against, and what Kubernetes / ECS / Fly will use as a liveness probe. Without it the engineer agent has no way to assert "the container started cleanly" in any environment.

```python
# FastAPI
@router.get("/health", include_in_schema=False)
def health() -> dict[str, str]:
    return {"status": "ok"}
```

A separate `/ready` (or `/readiness`) endpoint that *does* check the DB / external deps is fine — but it MUST be a different URL from `/health` so the liveness probe doesn't flap during routine dependency hiccups.

### Frontend nginx — SPA fallback first, API proxy first

A reverse-proxy nginx that fronts both a React/Vite SPA and a backend API needs two blocks, and they must be in the right order. The trap to avoid: putting `try_files $uri $uri/ /index.html;` at the top of the server block catches `/api/v1/auth/signup` too, and the backend POST gets `index.html` as its response body — every E2E test then fails because the SPA stayed on the form instead of navigating. The order that works:

```nginx
server {
  listen 80;
  server_name _;

  # 1. Liveness — straight through, no auth, no proxy.
  location = /health {
    proxy_pass http://backend:8000/health;
    proxy_set_header Host $host;
  }

  # 2. API — every backend path prefix gets an explicit proxy_pass BEFORE
  #    the SPA catch-all. If you add a new prefix (e.g. /admin, /webhooks),
  #    add a `location` block for it HERE, above try_files.
  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 3. SPA — every other request falls through to index.html so React
  #    Router can take over. MUST be last; MUST include `$uri/` to handle
  #    the case where the path is a directory.
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

- **`try_files $uri $uri/ /index.html` is mandatory** for any SPA — without it, `/signup`, `/groups/123`, etc. all 404 because there's no `signup` file on disk.
- **Every backend path prefix needs its own `location` block ABOVE the SPA fallback.** If a new backend route lives outside `/api/` (e.g. `/webhooks/stripe`, `/health`, `/auth/callback`), add a sibling `location` for it. Do NOT collapse them into a single `/` catch-all that conditionally proxies — order is easier to read and reason about.
- The pre-push hook's `container:smoke-api-proxy` probe detects this exact misconfig by checking the `Content-Type` of the API probe response: if it's `text/html`, the SPA catch-all is intercepting the request.

### Secrets — runtime env vars, never baked in

Secrets (DB passwords, API keys, tokens) are injected at runtime via environment variables — never `COPY`'d, `ARG`'d, or `ENV`'d into the image. Build-time `ARG`s are visible in image history; runtime `environment:` in compose stays out of the image.

```yaml
# docker-compose.yaml
services:
  app:
    environment:
      DATABASE_URL: ${DATABASE_URL}        # from host env / .env
      JWT_SECRET: ${JWT_SECRET}
    # never: build args, ENV in Dockerfile, or committed values
```

- Read from a `.env` file that is `.gitignore`d, or from the host environment / a secret manager.
- For Docker Swarm or production, use `secrets:` (file-based) instead of `environment:`.

### Networking — expose only what's needed

Default to internal-only networking. Publish a port to the host (`ports:`) only for services the host or browser actually needs to reach (typically: a frontend, a reverse proxy, sometimes the API in dev). Internal services (databases, queues, caches) communicate over the compose network using service names — no host port required.

```yaml
services:
  web:
    ports:
      - "8080:8080"          # exposed to host — user-facing
  api:
    expose:
      - "3000"               # reachable only inside the compose network
  db:
    # no ports / no expose — only api talks to it via "db:5432"
```

- `ports:` publishes to the host. Use sparingly.
- `expose:` documents intra-network ports; not strictly required (compose networks allow all ports between services) but useful as documentation.
- Bind to `127.0.0.1` (`"127.0.0.1:5432:5432"`) when publishing dev-only ports, so they aren't reachable on the LAN.

### Volumes — pick the right kind

Three volume types, three jobs:

| Type | Syntax | Use it for |
|------|--------|------------|
| **Named volume** | `db_data:/var/lib/postgresql/data` | Persistent state across restarts (DBs, queues, caches). Managed by Docker, survives `docker compose down`, removed only with `down -v`. |
| **Bind mount** | `./src:/app/src` | Development — map host source into container for live reload. |
| **Anonymous volume** | `/app/node_modules` | Preserve container-generated content from being shadowed by a bind mount (e.g. keep the image's `node_modules` when bind-mounting `./` over `/app`). |

```yaml
services:
  app:
    volumes:
      - ./src:/app/src                 # bind mount — host source for dev
      - /app/node_modules              # anonymous — protect image's node_modules
  db:
    volumes:
      - db_data:/var/lib/postgresql/data  # named — durable DB state

volumes:
  db_data:                              # declare named volumes at top level
```

## Template

Drop-in starting point for a Node-based service. Adjust language/runtime, but keep the three-stage shape, pinning, non-root user, and `.dockerignore`.

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:20.11.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache tini

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM base AS final
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
```

```yaml
# docker-compose.yaml
services:
  app:
    build:
      context: .
      target: final
    image: myorg/app:0.1.0
    environment:
      DATABASE_URL: ${DATABASE_URL}
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16.3-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

volumes:
  db_data:
```

```gitignore
# .dockerignore
.git
.gitignore
node_modules
npm-debug.log*
.env
.env.*
dist
build
coverage
.vscode
.idea
*.md
Dockerfile*
docker-compose*.yaml
docker-compose*.yml
```

## Command

Day-to-day operational commands. Prefer `docker compose` (V2 plugin) over the legacy `docker-compose` binary.

### View logs

```bash
docker compose logs -f app           # follow logs for the `app` service
docker compose logs --tail=50 db     # last 50 lines from `db`
```

### Exec into a running container

```bash
docker compose exec app sh                  # interactive shell in `app`
docker compose exec db psql -U postgres     # psql against the db service
```

Use `exec`, not `run`, when the container is already up — `run` spawns a new one-off container.

### Inspect

```bash
docker compose ps                    # running services and their status
docker compose top                   # processes inside each container
docker stats                         # live CPU / memory / IO per container
```

### Rebuild

```bash
docker compose up --build            # rebuild changed images, then start
docker compose build --no-cache app  # force a full rebuild of `app` (cache-busting)
```

Reach for `--no-cache` only when you suspect stale layers — it's slow.

### Clean up

```bash
docker compose down                  # stop and remove containers + default network
docker compose down -v               # ALSO remove named volumes — DESTRUCTIVE, wipes DB data
docker system prune                  # remove dangling images, stopped containers, unused networks
```

`down -v` deletes named volumes — confirm with the user before running it against any environment that holds real data.
