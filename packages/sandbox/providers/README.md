# Sandbox Providers

This directory contains the provider implementations for the pluggable sandbox system. Each provider must implement the `SandboxProviderDef` interface from `packages/sandbox/provider.ts`.

## Providers

| Provider | Environment | Notes |
|---|---|---|
| `vercel` | Production / Preview | Uses Vercel Sandbox (Firecracker microVMs). Default for deployed environments. |
| `docker` | Local development only | Uses Docker containers via dockerode. Gated to `NODE_ENV=development`. |
| `daytona` | Local development only | Uses a self-hosted Daytona server. Requires `DAYTONA_*` env vars. |

---

## Required Sandbox Capabilities

All sandbox images/environments **must** provide the following tools on `PATH`. The platform calls these via `sandbox.exec()` — missing tools cause 500 errors or silent failures.

The canonical reference is `scripts/create-base-snapshot.ts`, which builds the Vercel base snapshot. The Docker `Dockerfile` mirrors that tool set.

### Mandatory

| Tool | Used for |
|---|---|
| `git` | Diff computation, file listing, git-status, PR branch detection |
| `curl` | Port health checks (code-editor launch), agent HTTP fetch tool |
| `find` | Dev-server detection (locating `package.json` in workspace) |
| `ps` | Finding running code-server / dev-server processes by PID |
| `kill` | Stopping code-server and dev-server processes |
| `stat` | `sandbox.stat()` — file metadata (type, size, mtime) |
| `base64` | `sandbox.writeFile()` — binary-safe file writes |
| `printf` | `sandbox.writeFile()` — base64 decode pipeline |
| `cat` | `sandbox.readFile()` |
| `mkdir` | `sandbox.mkdir()` |
| `test` | `sandbox.access()` — path existence checks |
| `nohup` | `sandbox.execDetached()` — background process launch |
| `jq` | JSON manipulation in agent shell commands |
| `bun` | Agent tooling, dev-server startup, script execution |
| `bunx` | Running bun-installed CLIs (e.g. `bunx agent-browser`) |
| `code-server` | In-browser VS Code editor (`/api/sessions/[id]/code-editor`) |
| `agent-browser` | Browser automation for agent UI validation (Playwright-based) |

### Optional (graceful degradation)

| Tool | Used for |
|---|---|
| `npm` | Dev-server startup when bun is unavailable |
| `yarn` | Dev-server startup (detected via `yarn.lock`) |
| `pnpm` | Dev-server startup (detected via `pnpm-lock.yaml`) |
| `node` | Direct Node.js execution |
| `grep` | Agent grep tool |

---

## Docker Provider

### Building the dev image

```bash
docker build -t open-agents/sandbox-dev:latest packages/sandbox/providers/docker/
```

> The image includes Chromium (via `agent-browser install chromium`) and code-server, so the build takes several minutes and produces a ~2 GB image.

### Configuring the image

Set `DOCKER_SANDBOX_IMAGE` in `apps/web/.env.local`:

```
DOCKER_SANDBOX_IMAGE=open-agents/sandbox-dev:latest
```

If unset, the provider falls back to `ghcr.io/open-agents/sandbox:latest` (the production image, which is private).

### Keeping in sync with the Vercel snapshot

When `scripts/create-base-snapshot.ts` adds or updates a tool, mirror that change in the `Dockerfile`. The two sources of truth are:

- **Vercel base snapshot**: `scripts/create-base-snapshot.ts`
- **Docker dev image**: `packages/sandbox/providers/docker/Dockerfile`

### Notes

- Docker provider is only available when `NODE_ENV=development`. It will not appear as a selectable provider in production builds.
- Containers are started with ephemeral port bindings (`:0`) for each exposed port. The resolved host ports are stored in `DockerState.portBindings` and retrieved after container start via `container.inspect()`.
- `expiresAt` in `DockerState` is a hint to the web layer only — Docker containers do not self-terminate. The value is refreshed each time `connect()` is called.
- The lifecycle hibernation workflow skips non-vercel sandbox types — Docker containers are only stopped when a session is explicitly archived.

---

## Vercel Provider

Uses [Vercel Sandbox](https://vercel.com/docs/sandbox) (Firecracker microVMs). Requires `VERCEL_*` credentials.

- Sandboxes auto-expire; `expiresAt` is authoritative.
- Persistent sandboxes are identified by `sandboxName` (session-scoped).
- Lifecycle hibernation is handled by the durable workflow in `apps/web/app/workflows/`.
- Base snapshot is configured via `VERCEL_SANDBOX_BASE_SNAPSHOT_ID`. See `apps/web/lib/sandbox/config.ts` for the current default. To rebuild the snapshot, run `scripts/create-base-snapshot.ts`.

---

## Daytona Provider

Uses a self-hosted [Daytona](https://daytona.io/) server. For local testing only.

Start the server via the included Compose profile:

```bash
docker compose --profile daytona up -d
```

Required env vars: `DAYTONA_SERVER_API_URL`, `DAYTONA_SERVER_API_KEY`.
