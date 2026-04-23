# TODO

## Upgrade from Hobby to Pro Plan

The following changes were made to work within Vercel's Hobby plan limits and should be revisited when upgrading to Pro.

### Sandbox timeout (apps/web/app/api/chat/route.ts)
- **Current**: `maxDuration = 300` (Hobby plan max)
- **Pro plan**: Can be set up to `800`
- The original codebase had `maxDuration = 800`

### GitHub credential brokering (packages/sandbox/vercel/sandbox.ts)
- **Current**: Disabled via `VERCEL_SANDBOX_CREDENTIAL_BROKERING=false` env var — network policy transformations require Pro plan
- **Pro plan**: Remove the env var (or set to `true`) to re-enable automatic GitHub token injection into sandbox network requests
- Without this, the GitHub token must be passed via git remote URL (less secure but functional)

### Sandbox VM timeout (scripts/create-base-snapshot.ts)
- **Current**: `timeout: 2_670_000` (44.5 min — Hobby plan max is 45 min)
- **Pro plan**: Up to 5 hours (`DEFAULT_SANDBOX_TIMEOUT_MS = 5 * 60 * 60 * 1000`)
- Switch back to using `DEFAULT_SANDBOX_TIMEOUT_MS` from `apps/web/lib/sandbox/config.ts`

### Base snapshot (apps/web/lib/sandbox/config.ts)
- **Current**: `snap_UKY5ZynoTp6asvvZZSFzJ7qWKeJq` — minimal snapshot (bun + jq only)
- **Original**: included agent-browser + chromium + code-server
- Re-run `bun run sandbox:snapshot-base` with the full tool installation commands to build a richer snapshot
