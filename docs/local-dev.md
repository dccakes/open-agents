# Local Development Runbook

This runbook is for local development only. Treat all values in `apps/web/.env.local` as non-production credentials.

## Prerequisites

- Docker Desktop (or Docker Engine) with `docker compose`
- Bun 1.x

## Quick Start

```bash
bash scripts/dev-setup.sh
bun install
bun run web
```

What this does:
- `scripts/dev-setup.sh` verifies `docker` and `bun`
- starts local Postgres via Docker Compose
- creates `apps/web/.env.local` with local-only defaults if the file does not exist

## Provider Configuration

### Vercel (default)

- `vercel` is the default sandbox provider for new sessions.
- Uses cloud sandboxes (no extra local Docker profile needed).

### Docker (local)

- Uses local container sandboxes.
- Keep Docker running, then choose `Docker` in the session provider selector.

### Daytona (beta, optional opt-in)

Daytona is off by default and only starts when you opt in to its compose profile.

```bash
docker compose --profile daytona up -d daytona
```

Add Daytona local-testing env vars to `apps/web/.env.local`:

```env
DAYTONA_API_KEY=local-dev-key
DAYTONA_SERVER_URL=http://localhost:3986
```

## Optional Database Provisioning (`provisionDb`)

`provisionDb` is a per-session option that injects a session-scoped `POSTGRES_URL` into the sandbox runtime.

Provider backend mapping:
- `docker` -> Docker Postgres provisioner (local container)
- `vercel` -> Neon provisioner (branch database)
- `daytona` -> Neon provisioner (branch database)

For Neon-backed provisioning (`vercel`/`daytona`), set:

```env
NEON_API_KEY=...
NEON_PROJECT_ID=...
```

If Neon credentials are not configured, leave `provisionDb` disabled.

## Verification

1. Run quick start (`bash scripts/dev-setup.sh`, `bun install`, `bun run web`).
2. Open `http://localhost:3000`.
3. Create a new session with provider set to `Docker`.
4. Run:

```bash
echo hello from docker sandbox
```

5. Confirm the command output appears in chat.

Optional Daytona verification:
1. Start Daytona with `docker compose --profile daytona up -d daytona`.
2. Ensure Daytona env vars are set in `apps/web/.env.local`.
3. Create a session with provider `Daytona` and run `pwd` to confirm the workspace is reachable.

## Local Credential Safety

- `apps/web/.env.local` is for local testing only, never production.
- Do not copy `devpassword`, `local-dev-key`, or similar placeholders into deployed environments.
- Do not commit local secrets or tokens to git.
