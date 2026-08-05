## Why

Once `org-roles-and-settings` establishes who may manage shared organization configuration, the lifecycle operations themselves still need gating, reversibility, and a record. Today the Linear workspace connection can be created or deleted by any signed-in user (`/api/linear/connect`, `/api/linear/disconnect`), deletion is immediate and unrecoverable, GitHub App installations are per-user rows with no shared-ownership concept, and no mutation of shared state leaves any trace of who did it.

That is tolerable while the only shared integration is Linear. It stops being tolerable in Phase 1, which adds observability tokens (WS-1.2), Linear repo mappings and an org agent identity (WS-1.3), and org-level sandbox provider defaults (WS-1.4) — each of them one click from destruction, each of them affecting every member.

There is also a live correctness bug in the neighbourhood: the Linear webhook secret has two sources of truth. `apps/web/lib/linear/webhook.ts` generates it locally and stores it on the workspace row, while the webhook route reads a `LINEAR_WEBHOOK_SECRET` environment variable. Adding a restore path on top of that would produce restored connections that silently fail signature verification.

This change was split out of `org-roles-and-settings` after review found that change too large for one workstream. It stacks directly on it and cannot land first.

## What Changes

- Gate integration lifecycle mutations behind the permission model from `org-roles-and-settings`: Linear workspace connect/disconnect, organization-shared GitHub installation removal, org-level sandbox provider defaults and provider enablement, and observability configuration. Read and use paths stay open to approved members.
- Distinguish organization-shared GitHub App installations from personal ones. Existing installations stay personal; sharing one is an explicit admin action.
- Add **deletion protection** for destructive shared-config actions: typed confirmation checked server-side, soft delete via `deletedAt`, restore within a 14-day window, and a purge job that no-ops outside production.
- Add an append-only `config_audit` table recording actor, organization, action, target, and a before/after summary for every shared-config mutation — with the transactional guarantee scoped honestly to mutations this app owns.
- Consolidate the Linear webhook secret onto the workspace record and remove the environment variable, so a restored connection verifies signatures.

## Capabilities

### New Capabilities

- `integration-admin-gating`: Permission gates on the Linear workspace lifecycle, organization-shared GitHub installations, org-level sandbox provider defaults, and observability configuration.
- `config-audit-trail`: Append-only audit records plus soft delete, typed confirmation, restore, and production-only purge for destructive shared-config actions.

### Modified Capabilities

- `linear-workspace-connection`: connect/disconnect become admin-gated, soft-deleted, audited, and restorable; the webhook secret gains a single source of truth.
- `sandbox-provider-settings`: per-user provider choice is unchanged, but org-level defaults and which providers are enabled at all become admin-gated.

## Impact

- **Depends on**: `org-roles-and-settings` — this change consumes `requirePermission()`, the `integration`/`orgSettings`/`observability` statements, and the seeded organization id. It cannot land before that one.
- **Database**: new `config_audit` table; `deleted_at` added to shared-integration tables. The installation-ownership columns are **no longer this change's work** — `org-owned-integrations` supplies `github_installations.organization_id` and the `org_github_accounts` allowlist (see design decision 4). Drizzle migrations for the rest.
- **API routes**: `/api/linear/connect`, `/api/linear/disconnect`, GitHub installation removal, and sandbox provider settings routes gain permission checks, confirmation checks, and audit writes. New restore routes.
- **Removed env var**: `LINEAR_WEBHOOK_SECRET` is deleted from `lib/config/linear.ts` and the regenerated `.env.example`. The webhook route reads the workspace record instead.
- **Cron**: soft-delete purge handler, returning early unless `VERCEL_ENV === "production"` — preview databases are Neon forks whose rows point at real external resources.
- **UI**: typed-confirmation dialogs for destructive actions, restore affordance within the retention window.
- **Downstream**: WS-1.2's observability configuration and WS-1.3's repo mappings both land behind gates defined here.
