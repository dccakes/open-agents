# TODO

## Upgrade from Hobby to Pro Plan

The following changes were made to work within Vercel's Hobby plan limits and should be revisited when upgrading to Pro.

### Sandbox timeout (apps/web/app/api/chat/route.ts)
- **Current**: `maxDuration = 300` (Hobby plan max)
- **Pro plan**: Increase to `800`
- The original codebase had `maxDuration = 800`

### Sandbox VM timeout (apps/web/lib/sandbox/config.ts)
- **Current**: `DEFAULT_SANDBOX_TIMEOUT_MS = 2_670_000` (44.5 min — Hobby plan max is 45 min)
- **Pro plan**: Set env var `VERCEL_SANDBOX_TIMEOUT_MS=18000000` (5 hours) in Vercel

### GitHub credential brokering (packages/sandbox/vercel/sandbox.ts)
- **Current**: Disabled via `VERCEL_SANDBOX_CREDENTIAL_BROKERING=false` env var — network policy transformations require Pro plan
- **Side effects of disabling**:
  - Public repos clone anonymously (works fine)
  - Private repos clone via token-in-URL (functional but less secure)
  - Git push to private repos may fail without brokering
- **Pro plan**:
  1. Delete `VERCEL_SANDBOX_CREDENTIAL_BROKERING` env var from Vercel
  2. In `packages/sandbox/vercel/sandbox.ts`, remove `isCredentialBrokeringSupported()` — revert `buildGitHubCredentialBrokeringPolicy` and `syncGitHubCredentialBrokering` to always apply when a token is present
  3. In `sandbox.ts` SDK git source block, remove the `useTokenInSdkSource` variable and restore the original `source.token ? { username, password } : {}` conditional
  4. Private repos will work fully again

### Base snapshot (apps/web/lib/sandbox/config.ts)
- **Current**: `snap_5BjSWhQukFHehaEmU8FHPDFj1rfe` (bun + jq + code-server + agent-browser + chromium)
- **Pro plan**: Rebuild snapshot using `bun run sandbox:snapshot-base` without the 44.5 min timeout constraint for a more reliable install
