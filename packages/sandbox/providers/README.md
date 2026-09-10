# Sandbox Providers

This directory contains the provider implementations for the pluggable sandbox system. Each provider must implement the `SandboxProviderDef` interface from `packages/sandbox/provider.ts`.

## Providers

| Provider | Environment | Notes |
|---|---|---|
| `vercel` | Production / Preview | Uses Vercel Sandbox (Firecracker microVMs). Default for deployed environments. |
| `docker` | Local development only | Uses Docker containers via dockerode. Gated to `NODE_ENV=development`. |
| `daytona` | Local or cloud (beta) | Works with any Daytona instance — self-hosted or cloud. Requires `DAYTONA_*` env vars and `DAYTONA_BETA_ENABLED=true`. |

---

## Required Sandbox Capabilities

All sandbox images/environments **must** provide the following tools on `PATH`. The platform calls these via `sandbox.exec()` — missing tools cause 500 errors or silent failures.

The canonical tool recipe is `scripts/vercel-sandbox-base-setup.sh`, invoked by `scripts/vercel-refresh-base-snapshot.ts --setup-base`. The Docker `Dockerfile` mirrors that tool set.

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
rtk docker build -t open-agents/sandbox-dev:latest packages/sandbox/providers/docker/
```

> The image includes Chromium and code-server, so the build takes several minutes and produces a ~2 GB image. On Linux ARM64 builds, Chromium comes from Debian's `chromium` package because Chrome for Testing is not published for Linux ARM64.

Start Docker Desktop or OrbStack before building. To inspect the image interactively:

```bash
rtk docker run --rm -it open-agents/sandbox-dev:latest bash
```

Inside the container, run these checks directly:

```bash
git --version
bun --version
rtk --version
code-server --version
agent-browser --version
agent-browser open 'data:text/html,<title>Sandbox Working</title><main>Browser ready</main>'
agent-browser get title
agent-browser close
```

The browser title should be `Sandbox Working`. Run `exit` to stop and remove this test container.

### Configuring the image

Set `DOCKER_SANDBOX_IMAGE` in `apps/web/.env.local`:

```
DOCKER_SANDBOX_IMAGE=open-agents/sandbox-dev:latest
```

If unset, the provider falls back to `ghcr.io/open-agents/sandbox:latest` (the production image, which is private).

### Keeping in sync with the Vercel snapshot

When `scripts/vercel-sandbox-base-setup.sh` adds or updates a tool, mirror that change in the `Dockerfile`. The two sources of truth are:

- **Vercel base snapshot tools**: `scripts/vercel-sandbox-base-setup.sh`
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
- Base snapshot is configured via `VERCEL_SANDBOX_BASE_SNAPSHOT_ID`. See `apps/web/lib/sandbox/config.ts` for the current default. To rebuild the snapshot, run `scripts/vercel-refresh-base-snapshot.ts`.

### Building the base snapshot

Run from the repository root after `rtk bun install --frozen-lockfile`. The setup recipe uses `dnf` for the `node22` runtime and installs Bun, code-server, agent-browser, Chromium, and RTK. It runs the requested RTK installer and compiles from source when the published ARM64 binary requires a newer glibc than the runtime provides. It tests browser startup and leaves the workspace clone-ready. Base snapshots do not expire.

If a project-scoped `VERCEL_OIDC_TOKEN` is already available in your environment:

```bash
rtk bun run sandbox:snapshot-base --setup-base --sandbox-timeout-ms 1200000
```

Otherwise, use your existing Vercel CLI login without linking this checkout. Confirm the account with `rtk proxy vercel whoami` (run `rtk proxy vercel login` only when logged out). This command obtains a short-lived token in memory and passes it only to the build process; it does not print or save the token:

```bash
rtk proxy bun -e '
const auth = Bun.spawn([
  "rtk", "proxy", "vercel", "api",
  "/v1/projects/prj_2CqgIIipE2rtsQ2OYyS6691dGPUM/token?source=vercel-oidc-refresh",
  "--method", "POST", "--scope", "next-degree", "--raw"
], { stdout: "pipe", stderr: "inherit" });
const response = await new Response(auth.stdout).text();
if (await auth.exited !== 0) throw new Error("Vercel authentication failed");
const { token } = JSON.parse(response);
if (typeof token !== "string") throw new Error("Missing project token");
const build = Bun.spawn([
  "rtk", "bun", "run", "sandbox:snapshot-base",
  "--setup-base", "--sandbox-timeout-ms", "1200000"
], {
  env: { ...process.env, VERCEL_OIDC_TOKEN: token },
  stdout: "inherit", stderr: "inherit"
});
process.exit(await build.exited);
'
```

The project ID above is `quack-ops-web`; forks must substitute their own project ID and team. Find the ID with `rtk proxy vercel project inspect <project-name> --scope <team>`. To refresh an existing image, add `--from <snapshot-id>` and optional repeated `--command` arguments. Without `--setup-base`, the script only runs supplied commands before snapshotting.

Set the resulting `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` in the application's environment and redeploy to activate it. Do not hardcode a private snapshot in shared TypeScript config. Building a snapshot does not update the project environment or deploy the app.

### Opening a test shell

The base snapshot built and restore-tested on 2026-09-10 belongs to `next-degree / quack-ops-web`:

```env
VERCEL_SANDBOX_BASE_SNAPSHOT_ID=snap_72AvnIK3Rz9Deda6eqLNCXBiw10G
```

Create a separate test sandbox and open its interactive shell:

```bash
rtk proxy vercel sandbox sh \
  --scope next-degree \
  --project quack-ops-web \
  --snapshot snap_72AvnIK3Rz9Deda6eqLNCXBiw10G \
  --timeout 30m \
  --non-persistent
```

The CLI prints the sandbox name. If it returns to your local prompt, or you need to reconnect, replace `<sandbox-name>` below with that name:

```bash
rtk proxy vercel sandbox connect <sandbox-name> \
  --scope next-degree --project quack-ops-web
```

Inside the sandbox, run these checks directly:

```bash
pwd
ls -la /vercel/sandbox
git --version
bun --version
rtk --version
code-server --version
agent-browser --version
agent-browser open 'data:text/html,<title>Sandbox Working</title><main>Browser ready</main>'
agent-browser get title
agent-browser snapshot
agent-browser close
curl -I https://github.com
```

The workspace should initially be empty, with no `.git`. This snapshot contains Bun `1.3.14`, RTK, code-server `4.136.2`, and agent-browser `0.37.1`. Expect title `Sandbox Working`, browser content `Browser ready`, and a successful HTTP response from GitHub. Changes in this test sandbox do not modify the base snapshot.

Run `exit` to leave the shell, then stop the test sandbox from your local terminal rather than waiting for its 30-minute timeout:

```bash
rtk proxy vercel sandbox stop <sandbox-name> \
  --scope next-degree --project quack-ops-web
```

---

## Daytona Provider

Uses any [Daytona](https://daytona.io/) instance — cloud-hosted or self-hosted. The provider is beta-gated and requires three env vars:

```
DAYTONA_SERVER_URL=<your-daytona-instance-url>
DAYTONA_API_KEY=<your-daytona-api-key>
DAYTONA_BETA_ENABLED=true
```

### Cloud Daytona

Sign up at [app.daytona.io](https://app.daytona.io), create an API key from your account settings, and set the env vars in `apps/web/.env.local` (local) or your Vercel project settings (production/preview):

```
DAYTONA_SERVER_URL=<api-url-from-daytona-dashboard>
DAYTONA_API_KEY=<api-key-from-daytona-dashboard>
DAYTONA_BETA_ENABLED=true
```

### Self-hosted Daytona (local)

Start the bundled Daytona server via the included Compose profile:

```bash
docker compose --profile daytona up -d
```

Then add to `apps/web/.env.local`:

```
DAYTONA_SERVER_URL=http://localhost:3986
DAYTONA_API_KEY=local-dev-key
DAYTONA_BETA_ENABLED=true
```
