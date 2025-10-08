# Rune Skyhook (Server) — AI-Powered App Generation Backend

This package is currently a **design/spec README** for the Skyhook server. It documents the intended architecture and workflows so we can align on “how it should work” before we implement it.

Skyhook is built around a simple principle: **we orchestrate the sandbox and Rune-specific scaffolding, and we delegate the “coding agent” behavior to OpenCode** (running headlessly inside Docker).

This keeps the hard parts in one place:

- **Sandbox provisioning** (security + speed)
- **Rune-specific scaffolding/tools/templates** (avoid React-vs-Solid confusion)
- **Packaging + artifact delivery** (`rsbuild` → MinIO)

## 💡 The Vision: Autonomous App Creation

The core mission of this server is to enable **autonomous application development** directly from a user prompt, using a proven “coding agent” workflow (plan → edit → run → fix → deliver) **without us re-implementing an agent UI/UX**.

**We are not just generating code; we are executing a complete developer session in the cloud.**

### **Workflow: Skyhook Orchestrates, OpenCode Executes**

When a user submits a prompt from our client application (e.g., "Create a to-do list app with a dark mode toggle"), the server initiates a structured, continuous loop:

1.  **Persist request (Skyhook):** Store the prompt + metadata in Postgres and create an `agent_runs` record.
2.  **Provision sandbox (Skyhook):** Start an isolated Docker container that owns the workspace filesystem and runtime.
3.  **Prepare workspace (Skyhook):**
    - write a sandbox-local `AGENTS.md` with Rune + SolidJS rules
    - inject private package access (framework artifacts / registry / read-only mount)
    - provide deterministic scaffolding commands (e.g. `rune create-screen`, `rune create-route`)
4.  **Execute agent (OpenCode):** Run `opencode run` headlessly against the workspace with `--format json`.
5.  **Build (Skyhook):** Run `rsbuild build` inside the sandbox (same workspace) to validate output.
6.  **Package + upload (Skyhook):** Zip `dist/` + logs + an optional workspace snapshot and upload to MinIO (S3).

This loop continues until the agent either succeeds (artifact uploaded) or fails (logs + workspace snapshot persisted).

### What Skyhook owns vs. what OpenCode owns

- **Skyhook owns:** sandbox lifecycle, file boundaries, Rune conventions, scaffolding, dependency strategy, final build, artifact persistence, and audit logs.
- **OpenCode owns:** planning, editing, iterative command execution, and deciding what to change in the workspace to satisfy the task.

### **Client-Server Integration**

The server's output is not just code; it is a deployable package for our client application:

1.  **Creation:** The agent finishes its work and signals completion (ideally via a clean process exit + final status report).
2.  **Compilation:** The server performs a final, verified `rsbuild build` inside the sandbox.
3.  **Delivery:** The server zips the final production bundle (`dist/` folder) and uploads it to **MinIO (S3)**.
4.  **Client Loading:** The client application downloads this bundle and **mounts it dynamically**, allowing the user to instantly run the AI-generated application within the platform.

This architecture ensures high security (by isolating the LLM in the container) and high performance (by using pre-cached environments) while delivering a seamless, autonomous developer experience.

---

## 💻 Tech Stack Summary

| Component        | Technology                    | Purpose                                                 | Notes                                               |
| :--------------- | :---------------------------- | :------------------------------------------------------ | :-------------------------------------------------- |
| **Server**       | **Hono** (TypeScript)         | API Gateway and Agent Orchestrator.                     | Lightweight and fast.                               |
| **Database**     | **PostgreSQL** (DrizzleORM)   | Persistence for projects and agent log history.         | Transactional and reliable.                         |
| **Storage**      | **MinIO (S3)**                | Durable storage for project snapshots (`snapshot.zip`). | Centralized persistence layer.                      |
| **Execution**    | **Docker** (Sysbox, optional) | Secure, ephemeral sandbox for the Agent.                | Prefer no host mounts in prod; use `:ro` in dev.    |
| **Agent Runner** | **OpenCode**                  | Headless coding agent CLI in the sandbox.               | Run via `opencode run --format json` (or `serve`).  |
| **Package Mgmt** | **pnpm** + **Verdaccio**      | Efficient dependency install and local caching.         | Verdaccio dramatically speeds up external installs. |
| **Framework**    | **SolidJS** / **RSBuild**     | The target environment for the generated apps.          | Proprietary artifacts are injected securely.        |

---

## 🧪 Development & Debugging Workflows

There are two different “dev loops” we care about:

1. **Server dev** (iterate on Hono routes, DB models, storage code, tool parsing)
2. **Sandbox dev** (iterate on the container filesystem, dependency installs, rsbuild builds, and the “agent runs commands” loop)

In practice, **(2) is where Docker stays valuable even in dev**.

### Recommended Modes

**Mode A — “Server-only” dev (no Docker)**

- Use this to iterate on request/response shape, tool parsing, and the agent loop _without_ running untrusted builds.
- Sandbox is a **mock / local** implementation (temp folder on your machine).
- Fastest iteration, but **not safe** for running arbitrary agent code.

**Mode B — Hybrid dev (server on host, sandbox in Docker)**

- Run the Hono server locally for fast debugging.
- Still create a per-run sandbox container to execute tools.
- Best balance: good DX, still realistic sandbox behavior.

**Mode C — Full Docker dev**

- Run server + DB + MinIO + Verdaccio via Docker Compose.
- Closest to production and easiest to keep consistent across machines.

### Is Docker “necessary” in dev?

- **For API-only work:** no.
- **For “agent writes code + runs builds/tests”:** yes (or an equivalent sandbox), because you’re executing untrusted, variable code paths.
- A local/non-Docker sandbox can exist for convenience, but it should be clearly labeled **unsafe** and kept behind an explicit flag.

### Debugging Tips (Docker sandbox)

- Inspect a sandbox container: `docker ps`, then `docker exec -it <container> sh`
- Persist a failed run: keep the workspace zip + rsbuild logs in MinIO under a predictable key (e.g. `projects/<id>/runs/<runId>/snapshot.zip`).

---

## 🤖 Agent Runner: OpenCode

Skyhook uses OpenCode as the execution engine for “plan → edit → run → fix” inside the sandbox. Skyhook never drives the TUI; it runs OpenCode headlessly and consumes machine-readable output.

### Where it fits in orchestration

OpenCode runs after the workspace is prepared (templates + private package access) and before the final build:

1. Provision sandbox container
2. Materialize workspace + write sandbox `AGENTS.md`
3. Run OpenCode against that workspace
4. Run `rsbuild build`
5. Upload artifacts + logs to MinIO

### How Skyhook runs OpenCode (headless)

Inside the sandbox container (workspace mounted at `/app/workspace`):

```bash
opencode run \
  --format json \
  --agent rune-skyhook \
  --model "$SKYHOOK_OPENCODE_MODEL" \
  --file /app/workspace/AGENTS.md \
  "Build a Rune/SolidJS app screen that..."
```

Skyhook should treat OpenCode’s JSON event stream as the canonical run log (persist it alongside stdout/stderr and any build logs).

### Agent configuration (Rune-aligned)

Skyhook should provide an agent named `rune-skyhook` that bakes in the “Rune way”:

- SolidJS patterns (signals/memos, no React mental models)
- allowed packages/import patterns (especially `@rune/*`)
- instruction to prefer deterministic scaffolds (below) over inventing boilerplate
- explicit limits: only touch files inside the workspace root

This config can be injected via OpenCode config env vars (ideal for Docker):

- `OPENCODE_CONFIG_CONTENT` — inline JSON config (agent defaults, model, etc.)
- `OPENCODE_PERMISSION` — inline JSON permissions config (restrict what tools/commands can run)
- `OPENCODE_DISABLE_AUTOUPDATE=true` — avoid update checks in sandboxed runs

Provider credentials should be injected as environment variables into the sandbox (avoid writing credentials to container-local home directories in production).

### Optional: `opencode serve` for faster runs

If we want to avoid per-run startup costs, Skyhook can start a headless OpenCode server once per sandbox:

1. `opencode serve --hostname 127.0.0.1 --port 4096`
2. `opencode run --attach http://127.0.0.1:4096 ...`

### Rune-specific scaffolding tools (deterministic)

Expose simple commands in the sandbox so the agent doesn’t guess at conventions:

- `rune create-screen <Name>` → SolidJS screen template wired to router conventions
- `rune create-component <Name>` → Solid component template with Rune styling/import rules
- `rune create-api <Name>` → typed API wrapper using `@rune/*` packages

OpenCode should be instructed (via `AGENTS.md` + the `rune-skyhook` agent prompt) to prefer these tools whenever it needs new screens/components/routes.

## 📦 Private Package Artifacts (packages/\*)

Generated apps need access to Rune’s private packages (everything in `packages/`). The core problem: **the generated app is not a workspace member of this monorepo**, so it can’t resolve `workspace:*` dependencies, and it usually can’t fetch private packages from the public internet.

We should support **three artifact delivery strategies**, each optimized for a different environment:

### Strategy 1 — Read-only bind mount + dependency rewrite (best for local dev)

- Bind-mount the monorepo’s `packages/` directory into the sandbox container **read-only** (e.g. `/framework/packages:ro`).
- Before installing dependencies in the generated app, rewrite `package.json` dependencies that match `@rune/*` to `link:` specs pointing at the mount.
  - Example (conceptual): `@rune/core` → `link:/framework/packages/rune-core`
- Requirements:
  - The mounted packages must already be built (`dist/` present) if their `main` points to `dist/*`.
  - The sandbox must not be allowed to write back to the mount (use `:ro`).

This is fast and great for debugging because changes in the monorepo can be picked up quickly (after rebuilding packages).

### Strategy 2 — Prebuilt “framework artifacts” copied into the sandbox image (recommended for production)

- CI produces a minimal, immutable directory (e.g. `/opt/framework_artifacts`) containing only what generated apps need:
  - packaged tarballs (`*.tgz`) of private packages, or
  - a pre-seeded pnpm store, or
  - a vendored `node_modules` snapshot (least flexible)
- The sandbox runtime image includes these artifacts at build time (no host mounts).
- Pros: best security posture (no host source exposure), reproducible, deployable.
- Cons: requires CI to refresh artifacts when packages change.

This matches the “artifact injection” language used in the phased plan.

### Strategy 3 — Private registry (Verdaccio) seeded with private packages (optional, good for scale)

- Run Verdaccio as an internal registry.
- Seed/publish `@rune/*` packages into it (from CI or a bootstrap job).
- The sandbox installs private packages from Verdaccio and public ones from upstream (or a proxy).
- Pros: great caching and distribution model.
- Cons: you must manage versions/tags; “publish on every run” is usually the wrong tradeoff.

---

## 🚀 Getting Started (Stage 1 Scaffold)

The package now includes a minimal Hono server so we can exercise the `/health` and `/api/generate` endpoints locally while fleshing out the architecture above.

```bash
yarn install
yarn workspace @rune/skyhook dev
```

The server listens on `SKYHOOK_PORT` (falls back to `PORT`, then `8787`). Helpful manual checks:

- `curl http://localhost:8787/health` → `{ "status": "ok" }`
- `curl -X POST http://localhost:8787/api/generate -d '{"prompt":"Hello"}' -H "Content-Type: application/json"` → `202` with a JSON payload including an LLM preview and `agentRun` steps

### Project layout

```
packages/rune-skyhook/
├── src/
│   ├── index.ts            # Entry point (bootstraps HTTP server)
│   ├── app.ts              # Hono app factory
│   ├── routes/
│   │   ├── health/
│   │   │   ├── handlers/get-health-status.ts
│   │   │   └── index.ts
│   │   └── generate/
│   │       ├── handlers/post-generate-request.ts
│   │       └── index.ts
│   └── types/
│       └── generate.ts
└── README.md (this file)
```

## 🗄️ Database & Drizzle Setup

The Skyhook server now persists `/api/generate` requests in PostgreSQL via Drizzle ORM so the orchestrator has a durable queue to pull from, plus `projects` (user-owned apps) and `agent_runs` (every sandbox execution attempt).

Schemas live under `src/db/schema/` (one file per table) and `src/db/schema.ts` simply re-exports them for Drizzle. This keeps things scalable as we add more entities and lets us share enums between tables.

1.  Make sure a PostgreSQL instance is available and export a `DATABASE_URL` the Node process can read (e.g. `export DATABASE_URL=postgres://postgres:postgres@localhost:5432/skyhook`).
2.  Run migrations before starting the server: `yarn workspace @rune/skyhook db:migrate`.
3.  Inspect or tweak the schema with the bundled scripts:

    - `yarn workspace @rune/skyhook db:generate` — compiles the package and creates a new migration after editing anything in `src/db/schema/`.
    - `yarn workspace @rune/skyhook db:migrate` — compiles the package and applies migrations.
    - `yarn workspace @rune/skyhook db:studio` — compiles the package and launches Drizzle Studio for quick queries.

The server refuses to boot if `DATABASE_URL` is missing so we fail fast instead of accepting requests we cannot persist. `projects.user_id` is nullable for now, but it’s the hook we’ll use once agent requests are authenticated per user.

## 📦 Storage (MinIO / S3)

Snapshots and rsbuild artifacts are stored in an S3-compatible bucket via MinIO. Configuration lives in `src/storage/` (`snapshots.ts` exposes `saveSnapshot`/`loadSnapshot` helpers) and we eagerly validate credentials at server startup.

Set the following environment variables before running the server:

| Variable                         | Description                                                                           | Default                 |
| :------------------------------- | :------------------------------------------------------------------------------------ | :---------------------- |
| `SKYHOOK_STORAGE_BUCKET`         | Target bucket name.                                                                   | — (required)            |
| `SKYHOOK_STORAGE_ENDPOINT`       | HTTP/S endpoint for MinIO.                                                            | `http://127.0.0.1:9000` |
| `SKYHOOK_STORAGE_REGION`         | Region identifier (used by AWS SDK signing).                                          | `us-east-1`             |
| `SKYHOOK_STORAGE_ACCESS_KEY`     | Access key ID.                                                                        | — (required)            |
| `SKYHOOK_STORAGE_SECRET_KEY`     | Secret key.                                                                           | — (required)            |
| `SKYHOOK_STORAGE_FORCE_PATH_STYLE` | Force path-style URLs (`true` for MinIO). Set to `false` when using real S3 domains. | `true`                  |
| `SKYHOOK_STORAGE_PUBLIC_BASE_URL` | Optional public CDN/base URL to compute download links.                              | —                       |

Local bootstrap (replace creds/bucket as needed):

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=rune \
  -e MINIO_ROOT_PASSWORD=rune-secret \
  quay.io/minio/minio server /data --console-address ":9001"

export SKYHOOK_STORAGE_BUCKET=rune-snapshots
export SKYHOOK_STORAGE_ENDPOINT=http://127.0.0.1:9000
export SKYHOOK_STORAGE_ACCESS_KEY=rune
export SKYHOOK_STORAGE_SECRET_KEY=rune-secret
```

Then run `yarn workspace @rune/skyhook db:migrate && yarn workspace @rune/skyhook dev` and the service will create/read objects under keys such as `projects/<projectId>/runs/<runId>/snapshot.zip`.

## 🧠 LLM Integration

`/api/generate` now pings an LLM provider (mock / OpenAI / Gemini) to produce a short “preview” sentence describing the work it will attempt, proving end-to-end access to the chosen model.

Set `SKYHOOK_LLM_PROVIDER` to `mock` (default), `openai`, or `gemini`, then export the related keys:

| Provider | Required env vars | Optional env vars |
| :------- | :---------------- | :---------------- |
| `mock`   | —                 | —                 |
| `openai` | `SKYHOOK_OPENAI_API_KEY` | `SKYHOOK_OPENAI_MODEL` (default `gpt-4o-mini`), `SKYHOOK_OPENAI_BASE_URL` |
| `gemini` | `SKYHOOK_GEMINI_API_KEY` | `SKYHOOK_GEMINI_MODEL` (default `gemini-1.5-flash`), `SKYHOOK_GEMINI_BASE_URL` |

Use `SKYHOOK_LLM_PROVIDER=mock` when you don’t have API keys handy—the server will still run and return a deterministic preview string. Once you supply a real key, the preview will come from the live model, so it’s easy to smoke test connectivity before we rely on it for richer prompts and run summaries.

## 🤖 Agent Execution (OpenCode)

In production, Skyhook runs OpenCode headlessly inside the sandbox and treats the workspace as the source of truth (plus logs and artifacts persisted to MinIO).

The current scaffold also includes a small in-process runner under `src/agent/` (`runAgentLoop`) to validate request/response shape and persistence without Docker. It uses an in-memory workspace plus mocked tools (`list_files`, `read_file`, `write_file`, `run_command`, `finish`).

`/api/generate` currently returns `{ agentRun }` from that mock runner alongside the persistence/LLM preview payload, so we can inspect the orchestration steps via HTTP while the Docker + OpenCode runner is being wired in.

Organizing handlers per route folder makes it trivial to grow the API surface (Phase 1+ work) without bloating a single `server.ts`.

`/api/generate` is the entry point where we wire the sandbox orchestration (Docker + OpenCode), final build/zip steps, and production hardening (resource limits, timeouts, and prompt-injection resistance).

---

## 🛣️ Project Phased Plan

### Phase 1: 🧩 Scaffolding & Persistence

**Goal:** Establish the foundational server, database, and S3 connection.

| Task                       | Description                                                                                                                                  |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.1 Server Setup**       | Initialize Hono server with routing for `POST /api/generate`.                                                                                |
| **1.2 DB Setup**           | Configure DrizzleORM (PostgreSQL). Create schemas for `projects` and `agent_runs`.                                                           |
| **1.3 Storage Config**     | Setup MinIO client. Implement functions for `saveSnapshot(id, file)` and `loadSnapshot(id)`.                                                 |
| **1.4 LLM Integration**    | Implement a simple LLM wrapper (`llm.ts`) that supports Gemini/OpenAI API.                                                                   |
| **1.5 Agent Runner (OpenCode, local)** | Integrate OpenCode headless execution (no Docker yet): spawn `opencode run --format json` against a real on-disk workspace, capture/parse its JSON event stream, and persist logs/status in `agent_runs`. |

### Phase 2: 🐳 Secure Containerization

**Goal:** Build the secure, performant execution sandbox.

| Task                         | Description                                                                                                                                                |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2.1 Artifact Preparation** | Build a CI/CD job to create the `/tmp/framework_artifacts` folder from the monorepo.                                                                       |
| **2.2 Docker Setup**         | Implement the Multi-Stage `Dockerfile` (dependencies & runtime stages).                                                                                    |
| **2.3 Local Caching**        | Setup Verdaccio in a local Docker Compose file. Configure the runtime image to use the local Verdaccio registry.                                           |
| **2.4 Docker Orchestration** | Integrate **Docker API (e.g., `dockerode`)** into the Hono server. Implement `sandbox.create(id)`, `sandbox.exec(cmd)`, and `sandbox.persistAndDestroy()`. |
| **2.5 Agent Runner (Sandbox)** | Run OpenCode inside the Docker sandbox via `sandbox.exec(...)` (or a sidecar), stream `--format json` events back to the server, and persist stdout/stderr + event logs. |
| **2.6 Rune Tooling**         | Provide deterministic scaffolding commands in the sandbox (e.g. `rune create-screen`) so the agent stays aligned with Rune + SolidJS conventions.          |

### Phase 3: 🤖 AI Server & Productionization

**Goal:** Connect the LLM to the sandbox and deploy the complete system.

| Task                        | Description                                                                                                                                                  |
| :-------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3.1 System Prompt**       | Finalize the instruction prompt for the LLM developer. **Crucial:** Explicitly forbid reading files outside the designated workspace (`/app/apps/user-app`). |
| **3.2 Context Window Mgmt** | Implement the history pruning and "tree-view" file summary logic.                                                                                            |
| **3.3 Final Build/Bundle**  | Integrate the final `rsbuild build` command into the `sandbox.persistAndDestroy()` hook.                                                                     |
| **3.4 Security Audit**      | Verify resource limits on the Docker containers (CPU/Memory/Timeouts). Test prompt injection attempts for source code exfiltration.                          |
| **3.5 Monitoring**          | Implement logging and metrics for container startup time and LLM token usage.                                                                                |

---

## Next Step

If we agree on the dev workflows + artifact strategy above, the most useful next concrete steps are:

1. Create an initial `@rune/skyhook` workspace with a minimal Hono server (`/health` + stub `/api/generate`).
2. Add a local Docker Compose file for Postgres + MinIO (+ optional Verdaccio).
3. Implement Strategy 1 first (read-only mount + dependency rewrite) so we can iterate quickly, then move to Strategy 2 for production hardening.
