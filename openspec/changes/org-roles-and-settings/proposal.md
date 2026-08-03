## Why

Integrations are currently unprotected shared state. Sign-in is open to the internet: `apps/web/lib/auth/config.ts` configures Vercel and GitHub social providers with no domain allowlist, invite, or approval step, so anyone with a GitHub account who signs in becomes a fully-privileged user. The Linear workspace connection can be created or deleted by any signed-in user (`/api/linear/connect`, `/api/linear/disconnect`), and GitHub App installations are per-user rows with no shared-ownership concept. The only authorization primitive is a `users.isAdmin` boolean plus a private `requireAdmin()` helper in `apps/web/lib/admin/actions.ts`.

Phase 1 adds substantially more org-shared, high-blast-radius configuration — observability tokens (WS-1.2), Linear repo mappings and an org agent identity (WS-1.3), sandbox provider defaults and warm-state sharing (WS-1.4), postures and run budgets (WS-1.1). None of it should be editable or deletable by an unapproved or non-admin user, and nothing destructive should be one click away.

The original plan (`docs/plans/phase-1-dev-agent-depth.md`, WS-1.0) proposed hand-rolling this: a `users.role` enum, a fixed-id `orgSettings` singleton, and hand-written admin gates. Better Auth already ships the organization and admin plugins covering memberships, roles, invitations, permission statements, ban/impersonate, and session-scoped org context. Building a parallel implementation now means rewriting every gate written this phase when Phase 2 introduces multi-scope RBAC. This change adopts the plugins instead, and shapes the QuackOps-specific tables (org settings, audit) around them.

## What Changes

- Adopt the Better Auth **organization plugin** (single seeded org, teams and dynamic access control disabled) and **admin plugin** in `apps/web/lib/auth/config.ts`, with Drizzle tables authored to match the plugin schemas.
- Introduce a shared access-control statement set (`createAccessControl`) covering org settings, integrations, repo mappings, observability config, membership, agent runs, and postures — consumed by both plugins and by a new `requirePermission()` server helper.
- Add a **membership gate**: an `ALLOWED_EMAIL_DOMAINS` allowlist auto-approves matching sign-ups into the org; everyone else lands membership-less (`pending`) and sees only an approval-request screen until an admin approves them. Every "member" capability in Phase 1 means *approved* member.
- Migrate `users.isAdmin` → the admin plugin's `users.role` via expand-contract, keeping `isUserAdmin()` as a compatibility wrapper. Bootstrap admins from an `ADMIN_EMAILS` config allowlist so a fresh deploy is never adminless.
- Add an `org_settings` table keyed by `organizationId` (not a fixed-id singleton) carrying the **global kill switch** (`agentRunsPaused`) and the **org daily token budget** consumed by WS-1.1.
- Gate integration lifecycle mutations (Linear connect/disconnect, shared GitHub installation removal, sandbox provider defaults, observability configuration) behind permission checks; read/use paths stay open to approved members.
- Add **deletion protection** for destructive shared-config actions: typed confirmation in the UI, soft delete with `deletedAt`, restore within 14 days, and a production-only purge job.
- Add a `config_audit` table recording actor, organization, target, action, and before/after summary for every shared-config mutation.
- Consolidate the Linear webhook secret to a single source of truth so a restored connection still verifies signatures.
- Remove plaintext provider API keys from `user_sandbox_configs.config`.

## Capabilities

### New Capabilities

- `org-membership-gate`: Domain-allowlist auto-approval, `pending` state for everyone else, admin approval/rejection flow, and server-side enforcement that pending users reach no org data.
- `org-roles-and-permissions`: Better Auth organization + admin plugin adoption, the shared access-control statement set, `requirePermission()`/`requireApprovedMember()` helpers, admin bootstrap, role management UI, and the last-admin protection invariant.
- `org-settings`: Org-scoped settings record holding the agent-run kill switch and org daily token budget, with an enforcement point that halts new runs within one request cycle.
- `integration-admin-gating`: Permission gates on Linear workspace lifecycle, shared GitHub installations, sandbox provider defaults, and observability configuration.
- `config-audit-trail`: Append-only audit records plus soft-delete, typed confirmation, restore, and production-only purge for destructive shared-config actions.
- `sandbox-credential-protection`: Removal of plaintext provider credentials from `user_sandbox_configs`.

### Modified Capabilities

- `linear-workspace-connection`: connect/disconnect become admin-gated, soft-deleted, audited, and restorable; the webhook secret gains a single source of truth.
- `sandbox-provider-settings`: per-user provider choice is unchanged, but org-level defaults and which providers are enabled at all become admin-gated, and stored credentials stop being plaintext.

## Impact

- **Auth**: `apps/web/lib/auth/config.ts` gains two plugins, an access-control instance, `databaseHooks` for domain-allowlist approval and admin bootstrap, and a session hook setting `activeOrganizationId`. The Drizzle adapter schema map grows to cover the new plugin models.
- **Database**: new `organizations`, `org_members`, `org_invitations`, `org_settings`, `config_audit` tables; `users.role` added (`users.isAdmin` retained then dropped); `auth_sessions.active_organization_id` added; `deleted_at` added to shared-integration tables; `user_sandbox_configs.config` credential fields removed. Drizzle migrations required for each.
- **API routes**: `/api/linear/connect`, `/api/linear/disconnect`, sandbox provider settings routes, and the admin server actions gain permission checks and audit writes. New routes for approval, role management, org settings, and restore.
- **New libs**: `apps/web/lib/auth/permissions.ts` (statement set + roles), `apps/web/lib/auth/require-permission.ts`, `apps/web/lib/org/settings.ts`, `apps/web/lib/audit/`.
- **UI**: pending-approval screen; admin area gains members/approvals, org settings (kill switch, budget), and typed-confirmation dialogs for destructive actions.
- **Environment variables**: `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `DEFAULT_ORG_NAME`/`DEFAULT_ORG_SLUG`, declared in the existing `authEnv` group (`apps/web/lib/config/auth.ts`) with axes and descriptions, read through accessors on that module, and reflected in a regenerated `apps/web/.env.example`. WS-0.1 has landed, so `scripts/check-env-boundary.ts` fails CI on any raw `process.env` read outside a config module.
- **Cron**: soft-delete purge handler, no-op unless `VERCEL_ENV === "production"`.
- **Downstream**: WS-1.1 (postures, `dangerous` gating, org daily budget), WS-1.2 (observability config gating, approved-member default), WS-1.3 (repo mappings, org agent identity, kill-switch check), WS-1.4 (org-shared warm-state opt-in), WS-1.5 (admin runs dashboard, kill switch surfacing) all consume this change's permission model.
- **Docs**: `docs/agents/architecture.md` and the CLAUDE.md Authentication section both describe the current auth story and must be updated; `docs/agents/lessons-learned.md` records the plugin-adoption decision.
