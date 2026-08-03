## Why

Integrations are currently unprotected shared state. Sign-in is open to the internet: `apps/web/lib/auth/config.ts` configures Vercel and GitHub social providers with no domain allowlist, invite, or approval step, so anyone with a GitHub account who signs in becomes a fully-privileged user. The Linear workspace connection can be created or deleted by any signed-in user (`/api/linear/connect`, `/api/linear/disconnect`), and GitHub App installations are per-user rows with no shared-ownership concept. The only authorization primitive is a `users.isAdmin` boolean plus a private `requireAdmin()` helper in `apps/web/lib/admin/actions.ts`.

Phase 1 adds substantially more org-shared, high-blast-radius configuration — observability tokens (WS-1.2), Linear repo mappings and an org agent identity (WS-1.3), sandbox provider defaults and warm-state sharing (WS-1.4), postures and run budgets (WS-1.1). None of it should be editable or deletable by an unapproved or non-admin user, and nothing destructive should be one click away.

The original plan (`docs/plans/phase-1-dev-agent-depth.md`, WS-1.0) proposed hand-rolling this: a `users.role` enum, a fixed-id `orgSettings` singleton, and hand-written admin gates. Better Auth already ships the organization and admin plugins covering memberships, roles, invitations, permission statements, ban/impersonate, and session-scoped org context. Building a parallel implementation now means rewriting every gate written this phase when Phase 2 introduces multi-scope RBAC. This change adopts the plugins instead, and shapes the QuackOps-specific tables (org settings, audit) around them.

## What Changes

- Adopt the Better Auth **organization plugin** (single seeded org, teams and dynamic access control disabled) and **admin plugin** in `apps/web/lib/auth/config.ts`, with Drizzle tables authored to match the plugin schemas.
- Introduce a shared access-control statement set (`createAccessControl`) built by spreading **both plugins' `defaultStatements`** and adding QuackOps resources (org settings, integrations, repo mappings, observability config, agent runs, postures) — consumed by both plugins and by a new `requirePermission()` server helper. The defaults are load-bearing: the org plugin's built-in `removeMember`/`updateMemberRole` authorize against `member.delete`/`member.update` from *your* roles, so a custom-only statement set would deny them even for owners.
- Add a **membership gate**: an `ALLOWED_EMAIL_DOMAINS` allowlist auto-approves matching sign-ups into the org; everyone else lands membership-less (`pending`) and sees only an approval-request screen until an admin approves them. Every "member" capability in Phase 1 means *approved* member.
- Migrate `users.isAdmin` → the admin plugin's `users.role` via expand-contract, keeping `isUserAdmin()` as a compatibility wrapper. Bootstrap admins from an `ADMIN_EMAILS` config allowlist so a fresh deploy is never adminless.
- Add an `org_settings` table keyed by `organizationId` (not a fixed-id singleton) carrying the **global kill switch** (`agentRunsPaused`) and the **org daily token budget** consumed by WS-1.1.
- Enforce membership at a **structural chokepoint** (the server session helper) rather than a per-route checklist, and add an explicit membership check to the Linear webhook path, which resolves a user by actor email and has no browser session.
- Make removal and demotion effective immediately: revoke sessions on removal/ban, prohibit session cookie caching, gate share creation on membership, and revoke a removed user's shares.
- Give the platform role a managed lifecycle (grant/revoke at runtime, last-platform-admin invariant) and constrain the admin plugin's newly exposed impersonation and user-management endpoints.

## Capabilities

### New Capabilities

- `org-membership-gate`: Verified-email domain-allowlist auto-approval, `pending` state for everyone else, admin approval/rejection, structural enforcement, immediate revocation, and the share-link carve-out.
- `org-roles-and-permissions`: Better Auth organization + admin plugin adoption, the shared access-control statement set built on the plugins' `defaultStatements`, `requirePermission()`/`requireApprovedMember()` helpers, admin bootstrap, role management, platform-role lifecycle, and last-admin invariants.
- `org-settings`: Org-scoped settings record holding the agent-run kill switch and org daily token budget.

### Modified Capabilities

- None. Integration gating and the audit trail moved to `shared-config-governance`; provider-credential protection moved to `sandbox-credential-protection`. Both stack on this change.

## Impact

- **Auth**: `apps/web/lib/auth/config.ts` gains two plugins, an access-control instance, `databaseHooks` for domain-allowlist approval and admin bootstrap, and a session hook setting `activeOrganizationId`. The Drizzle adapter schema map grows to cover the new plugin models.
- **Database**: new `organizations`, `org_members`, `org_invitations`, `org_settings` tables; `users.role`, `users.banned`, `users.ban_reason`, `users.ban_expires`, `auth_sessions.active_organization_id`, `auth_sessions.impersonated_by` added (`users.isAdmin` retained then dropped in a later PR). The four ban/impersonation columns are not optional: Better Auth selects every field its plugin schemas declare, so omitting them is a SQL error on authenticated requests.
- **Boot**: an idempotent runtime seeder in `instrumentation.ts` creates the organization, its settings row, membership for existing users, and backfills `active_organization_id` on existing sessions. Seeding cannot live in a migration — migrations are static SQL and cannot read configuration.
- **API routes**: new routes for approval, role management, and org settings. The Linear webhook route gains a membership check on the matched user. Share creation gains a membership gate.
- **New libs**: `apps/web/lib/auth/permissions.ts` (statement set + roles), `apps/web/lib/auth/require-permission.ts`, `apps/web/lib/org/seed.ts`, `apps/web/lib/org/settings.ts`.
- **UI**: pending-approval screen; admin area gains members/approvals, role management, and org settings (kill switch, budget).
- **Environment variables**: `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `DEFAULT_ORG_NAME`/`DEFAULT_ORG_SLUG`, declared in the existing `authEnv` group (`apps/web/lib/config/auth.ts`) with axes and descriptions, read through accessors on that module, and reflected in a regenerated `apps/web/.env.example`. WS-0.1 has landed, so `scripts/check-env-boundary.ts` fails CI on any raw `process.env` read outside a config module.
- **Downstream**: `shared-config-governance` and `sandbox-credential-protection` stack directly on this change. WS-1.1 (postures, `dangerous` gating, org daily budget), WS-1.2 (observability config gating, approved-member default), WS-1.3 (repo mappings, org agent identity, kill-switch check), WS-1.4 (org-shared warm-state opt-in), and WS-1.5 (admin runs dashboard, per-run stop, kill-switch surfacing) all consume this change's permission model. WS-1.5 in particular owns terminating a removed member's in-flight runs, which this change explicitly does not do.
- **Docs**: `docs/agents/architecture.md` and the AGENTS.md Authentication section both describe the current auth story and must be updated; `docs/agents/lessons-learned.md` records the plugin-adoption decision and the two schema traps it exposed.
