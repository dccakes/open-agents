## Why

`process.env` was read in ~90 places across ~40 non-test files. There was no
single place to see which variables exist, no startup validation, and a typo
failed silently at runtime — or, worse, turned a route into a 500 on the first
request that needed the variable (`LINEAR_WEBHOOK_SECRET` did exactly that).
`apps/web/.env.example` was referenced by `CLAUDE.md` but did not exist.

This is Phase 0, WS-0.1 of
[Foundation Hardening](../../../docs/plans/phase-0-foundation-hardening.md).

## What Changes

- New `apps/web/lib/config/` boundary: one Zod-validated module per concern
  (`auth`, `db`, `deployment`, `github`, `linear`, `public`, `redis`,
  `sandbox`), each declaring its variables with an environment axis
  (`required-prod` / `optional` / `dev-only`), a description, and a schema
- New `packages/sandbox/config.ts`: the package's single env boundary; provider
  factories take explicit config options that default to it
- Every non-allowlisted call site reads config through those modules instead of
  `process.env`
- New `scripts/check-env-boundary.ts`, wired into `bun run ci`, fails on a
  `process.env` / `Bun.env` read outside the allowlist
- New `apps/web/instrumentation.ts` validates the server config at boot, and
  `apps/web/scripts/check-env.ts` runs the same validation during `build` so a
  production deploy fails instead of the first request
- New generated `apps/web/.env.example`, rendered from the schemas, with a test
  that fails when it drifts

## Capabilities

### New Capabilities

- `config-boundary`: All configuration is declared in config modules, validated
  per environment axis at boot and at build, documented in a generated
  `.env.example`, and enforced by a CI check.

## Impact

- **No behavior change**: every default value and user-facing error message is
  preserved; the existing test suite passes unmodified
- **New failure mode (intended)**: a production build missing a required
  variable now fails the deploy, naming the variable
- **Files**: `apps/web/lib/config/**` (new), `packages/sandbox/config.ts` (new),
  ~30 migrated call sites, root `ci` script, `apps/web` `build` script
- **turbo.json**: `VERCEL_ENV` added to the build env list so preview builds are
  correctly identified as non-production
