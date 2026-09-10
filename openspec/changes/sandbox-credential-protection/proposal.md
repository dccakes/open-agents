## Why

`user_sandbox_configs.config` is a JSONB column holding per-user, per-provider sandbox settings — and it stores provider API keys and tokens as **plaintext**. This is a live violation of the Phase 1 ground rule that integration credentials live in environment configuration and never in database rows, and the reason that rule exists applies directly here: Neon database branching gives every preview deployment a fork of the production database, so a plaintext credential in a production row is readable from every preview of every pull request.

The parent plan (`docs/plans/phase-1-dev-agent-depth.md`, WS-1.0) tracked this fix as a trailing task group inside the org-roles workstream. An adversarial review of that proposal noted it is self-contained — it shares no schema, no permission model, and no sequencing with plugin adoption — so it is its own change. It can be implemented in parallel with the org work rather than queued behind it.

## What Changes

- Stop persisting sandbox provider API keys and tokens as plaintext in `user_sandbox_configs.config`. Credentials are resolved from environment configuration where the provider allows it, and otherwise stored encrypted at rest using the same helper that protects the Linear workspace token.
- Keep `config` for non-secret settings and references only.
- Mask credential presence in API responses to the settings UI — the client learns whether a credential is set, never its value.
- Sequence the change expand-contract so a rolling deploy never has a running deployment that can no longer resolve credentials.
- Prompt affected users to re-enter credentials rather than silently failing sandbox provisioning.

## Capabilities

### New Capabilities

- `sandbox-credential-protection`: Removal of plaintext provider credentials from `user_sandbox_configs`, with masked reads and a rolling-deploy-safe migration.

### Modified Capabilities

- `sandbox-provider-settings`: the settings surface is unchanged in shape, but credential values stop round-tripping to the client and stop being stored in plaintext.

## Impact

- **Depends on**: nothing in this Phase 1 series. It is independent of `org-roles-and-settings` and `shared-config-governance` and can land in parallel.
- **Database**: `user_sandbox_configs.config` loses its credential fields. Two migrations, not one — see the expand-contract requirement.
- **Code**: `apps/web/lib/sandbox-provider-settings.ts` and the provider resolution path in `packages/sandbox` (which now takes explicit options via `packages/sandbox/config.ts` after WS-0.1).
- **Config**: any provider credential moved to environment sourcing is declared in `apps/web/lib/config/sandbox.ts` with an axis and description, and `.env.example` is regenerated.
- **UI**: `apps/web/app/settings/sandboxes` shows a masked "credential set" indicator and a re-entry prompt for users whose stored value was removed.
- **Security**: closes a plaintext-credential-readable-from-every-preview hole. Worth calling out in `SECURITY.md` alongside the WS-1.4 warm-state note.
