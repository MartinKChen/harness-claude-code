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
- **No virtual environments inside images**: the container itself is the isolation boundary, so language-level venvs add layers, indirection, and PATH gymnastics for zero gain. Install Python deps directly into the system site-packages (e.g. `uv pip install --system -r requirements.txt`, `pip install --no-cache-dir -r requirements.txt`); do not create a `.venv` or use `uv venv` inside a Dockerfile. Same rule for any other ecosystem's per-project virtualenv tooling.
- **`.dockerignore` is mandatory**: exclude `.git`, `node_modules`, `.env*`, `dist/`, `build/`, `coverage/`, `*.log`, IDE folders. Keeps the build context small and prevents secrets from leaking into the image.
- **Layer ordering**: copy dependency manifests and install deps *before* copying source, so dep layers cache across source edits.

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
