## Context

QuackOps today has exactly one authorization concept: `users.isAdmin` (boolean, `apps/web/lib/db/schema.ts:25`), read by `isUserAdmin()` (`apps/web/lib/db/users.ts`) and enforced by a module-private `requireAdmin()` in `apps/web/lib/admin/actions.ts`. There is no membership concept at all — `apps/web/lib/auth/config.ts` wires Vercel and GitHub social providers with `accountLinking.allowDifferentEmails: true` and no gate, so any GitHub account on the internet becomes a user with full member capabilities.

Better Auth is already the auth layer (`better-auth@^1.6.5`), configured with custom `modelName`/`fields` remapping (`users`, `auth_sessions`, `accounts`, `verification`) and `advanced.database.generateId` using nanoid. WS-0.1 has since landed, so `apps/web/lib/auth/config.ts` reads its secret and OAuth credentials through `lib/config/auth.ts` rather than `process.env`, and `scripts/check-env-boundary.ts` fails CI on any raw `process.env` read outside a config module. Two first-party plugins cover most of what WS-1.0 describes:

- **organization plugin** — `organization`, `member`, `invitation` tables; `session.activeOrganizationId`; roles on `member.role` (owner/admin/member); invitation lifecycle; before/after hooks on every membership mutation; server-side `hasPermission`.
- **admin plugin** — `user.role`, `user.banned`/`banReason`/`banExpires`, `session.impersonatedBy`; `setRole`, `listUsers`, `banUser`, `impersonateUser`, `revokeUserSessions`; `adminRoles`/`adminUserIds` config.

Both share one access-control system: `createAccessControl(statements)` → `ac.newRole({...})`, checked server-side with `hasPermission` (async, authoritative) or client-side with `checkRolePermission` (sync, static roles only, UI affordances only).

The original WS-1.0 plan predates this survey and specifies a hand-rolled `users.role` enum plus a fixed-id `orgSettings` singleton. This design replaces that with plugin adoption, because Phase 2 in the roadmap is explicitly "full multi-scope RBAC" — every gate written by hand this phase would be rewritten against `member.role` then.

## Goals / Non-Goals

**Goals:**
- Close the open-membership hole before Phase 1 hands members org PostHog data, the shared Linear integration, and org-billed sandbox runs.
- Establish one permission vocabulary that WS-1.1 through WS-1.5 consume, rather than five workstreams each inventing an admin check.
- Make Phase 2's multi-org / multi-scope migration configuration rather than schema surgery: every new table carries `organizationId NOT NULL` from day one even though exactly one org exists.
- Preserve `isUserAdmin()` call sites (`apps/web/app/api/auth/info/route.ts`, `apps/web/lib/admin/actions.ts`, `apps/web/hooks/use-session.ts`) through the migration.

**Non-Goals:**
- Multi-organization support in the UI. One org is seeded; `allowUserToCreateOrganization` is `false`.
- Teams. The organization plugin's teams feature stays disabled — the repo already overloads "team" (`linearTeamId` in WS-1.3, `vercelTeamId` on `sessions`) and a third meaning would be actively confusing.
- Dynamic (runtime-created) roles. `dynamicAccessControl` stays off; roles are static and code-defined this phase.
- Per-resource ACLs (which member may touch which repo). That is Phase 2 scope. This change answers only "who may manage shared org configuration."
- Replacing social sign-in with email/password or invitation-only sign-up. Sign-in stays open; *access* is what gets gated.

## Decisions

### 1. Adopt both the organization and admin plugins, with distinct responsibilities

- **Decision:** `users.role` (admin plugin) is the **platform** role — `"admin" | "user"` — governing instance-level operations that exist above any org: the bulk token revocation actions in `apps/web/lib/admin/actions.ts`, ban, impersonate, and session revocation. `member.role` (organization plugin) is the **org** role — `owner | admin | member` — governing shared configuration. Approved membership in the seeded org is what "member" means everywhere in Phase 1.
- **Rationale:** These are genuinely different questions. "May this person disconnect the org's Linear workspace?" is org-scoped and becomes per-org in Phase 2. "May this person revoke every OAuth token in the deployment and log out all users?" is not org-scoped and never will be. Collapsing them means the Phase 2 migration has to re-separate them.
- **Alternative:** Admin plugin only, deferring the organization plugin to Phase 2. **Why rejected:** it defers the exact thing Phase 2 needs. Every gate written this phase against a flat `users.role` gets rewritten against `member.role`, and `org_settings`, `linear_repo_mapping` (WS-1.3), and `config_audit` all get an `organizationId` backfill on live data rather than being born with one.
- **Alternative:** Organization plugin only. **Why rejected:** loses `banUser`/`impersonateUser`/`revokeUserSessions`, which WS-1.5's incident runbook wants ("revoke which tokens, in what order"), and leaves no instance-level superuser above the org for a deployment that has one.
- **Cost, stated honestly:** three additional Better Auth tables and a second role concept, in a workstream the plan called "deliberately thin." The mitigation is that the second concept is only exercised by the two existing bulk-revocation actions; everything else in Phase 1 checks org permissions.

### 2. `pending` is the absence of a membership row, not a role value

- **Decision:** A signed-in user with no `org_members` row for the seeded org is `pending`. Approval = an admin creating that row with role `member`. There is no `"pending"` role value.
- **Rationale:** Modeling `pending` as a role would make pending users appear in the plugin's `listMembers()` output and in any future `hasPermission` evaluation as members-with-no-permissions — a fail-open shape, since a missed permission statement grants access rather than denying it. Absence of a row fails closed by construction. It also means the user row *is* the access request; no separate request table.
- **Alternative:** `member.role = "pending"`. **Why rejected:** fail-open shape, and pollutes built-in member APIs.
- **Alternative:** Better Auth invitations for approval. **Why rejected:** the invitation flow is admin-initiates-first; this flow is user-signs-in-first, then requests approval. Invitations remain available for the (supported, not required) invite-ahead path.
- **Consequence:** the "pending users" list is `users LEFT JOIN org_members ... WHERE org_members.id IS NULL`, and `requireApprovedMember()` must be a positive membership check, never `role !== "pending"`.

### 3. Domain allowlist auto-approves; everyone else is pending

- **Decision:** `ALLOWED_EMAIL_DOMAINS` (e.g. `nextdegree.org`) is checked in a Better Auth `databaseHooks.user.create.after` hook. Match → create an `org_members` row with role `member`. No match → no membership row; the user can sign in and sees only the approval-request screen.
- **Rationale:** Keeps sign-in open (social providers still work, no invite plumbing needed) while making *access* explicit. The hook is the single place membership is granted automatically, so there is one place to audit.
- **Sharp edge:** `accountLinking.allowDifferentEmails: true` is set today. A user may sign in with Vercel using an allowlisted email and later link a GitHub account with a different one. The allowlist decision is therefore made once, from the email on the **user record** at creation, and linking a second account never grants membership. Account linking must not re-run the approval hook.
- **Second sharp edge:** `users.email` is nullable in the schema, and GitHub accounts can withhold email. A null or unverified email never matches the allowlist — it lands `pending`. Domain matching is case-insensitive on the domain part, exact (no subdomain wildcards).

### 4. Admin bootstrap by email allowlist, not `adminUserIds`

- **Decision:** `ADMIN_EMAILS` in config grants platform `role: "admin"` **and** org `owner` membership on first sign-in, via the same `user.create.after` hook.
- **Rationale:** The admin plugin's `adminUserIds` takes user IDs, and IDs are nanoid-generated at first sign-in (`advanced.database.generateId`), so they cannot be known ahead of a deploy. Email is the only stable pre-deploy identifier. This is the one place a built-in doesn't fit the deployment model.
- **Note:** `adminUserIds` is still useful as a break-glass escape hatch once IDs exist and can be set later without a migration; the bootstrap path does not preclude it.

### 5. One access-control statement set, shared by both plugins

- **Decision:** `apps/web/lib/auth/permissions.ts` defines a single `createAccessControl` statement set and the static roles, imported by both plugin configs and by the client. Statements are named for the resources Phase 1 actually gates:

  | Resource | Actions | Consumed by |
  |---|---|---|
  | `orgSettings` | `read`, `update` | WS-1.0 kill switch, budget |
  | `integration` | `read`, `connect`, `disconnect` | WS-1.0 Linear/GitHub lifecycle |
  | `repoMapping` | `read`, `create`, `update`, `delete` | WS-1.3 |
  | `observability` | `read`, `configure` | WS-1.2 |
  | `membership` | `approve`, `reject`, `setRole`, `remove` | WS-1.0 admin area |
  | `agentRun` | `create`, `read`, `stop` | WS-1.5 dashboard |
  | `posture` | `setDangerous` | WS-1.1 |
  | `warmCache` | `shareOrgWide`, `discard` | WS-1.4 |

  Role assignment: `member` gets read actions plus `agentRun.create`/`read`; `admin` gets everything except org deletion; `owner` gets everything. Downstream workstreams add actions to this table rather than inventing new gates.
- **Rationale:** WS-1.1's "`dangerous` posture is admin-only", WS-1.2's "configuration is admin-only", WS-1.3's "mappings are admin-only", WS-1.4's "org-shared cache is opt-in by an admin", and WS-1.5's dashboard are five separate ad-hoc admin checks in the plan. One statement set makes them one mechanism with one test surface.
- **Enforcement:** a `requirePermission(permissions)` helper wrapping `auth.api.hasPermission` — server-side, authoritative. `checkRolePermission` is used **only** to hide UI affordances; every hidden control also has a server-side check, because hiding a button is not authorization.

### 6. `org_settings` is a table keyed by `organizationId`, not a singleton and not org `metadata`

- **Decision:** `org_settings` has `organizationId` as a unique FK to `organizations.id`, with typed columns `agentRunsPaused boolean` and `dailyTokenBudget integer`.
- **Rationale:** The organization plugin offers a `metadata` JSON column, which is tempting and wrong for these two fields. The kill switch is read on the hot path before every agent run starts (chat and webhook), needs a typed non-null value, and must not depend on unvalidated JSON parsing succeeding — a malformed `metadata` blob must not fail open into "runs allowed." Keying by `organizationId` rather than a fixed id makes the Phase 2 multi-org migration a no-op for this table.
- **Kill-switch semantics:** enforcement is at every run-start path, not in the workflow loop, so "within one request cycle" means the next run-start request. In-flight runs are unaffected — stopping those is WS-1.5's per-run stop. This boundary is stated in the spec because "the agent is doing something bad at 3am" implies both, and only one is in scope here.

### 7. `isAdmin` → `role` by expand-contract, in that order

- **Decision:** (1) add `users.role` with default `"user"`; (2) backfill `role = 'admin'` where `is_admin = true`; (3) repoint `isUserAdmin()` to read `role`, keeping the function signature so `apps/web/app/api/auth/info/route.ts`, `apps/web/lib/admin/actions.ts`, and `apps/web/hooks/use-session.ts` are untouched; (4) drop `is_admin` in a **later** PR.
- **Rationale:** Migrations run automatically during `bun run build` on every Vercel deploy, including previews (`apps/web/lib/db/migrate.ts`). A single migration that adds `role` and drops `is_admin` leaves the previous deployment's still-running code reading a dropped column during the rollout window. Expand-contract is required here, not stylistic.
- **Note:** the same discipline applies to the `user_sandbox_configs.config` credential removal (task group 6) and is the reason it is sequenced last.

### 8. Table naming follows the repo, not the plugin defaults

- **Decision:** Drizzle remains the source of truth for schema and migrations; the Better Auth CLI generator is not used. Plugin tables are hand-authored in `apps/web/lib/db/schema.ts` and mapped via each plugin's `schema.<model>.modelName` / `fields` options: `organization → organizations`, `member → org_members`, `invitation → org_invitations`. The new `session.activeOrganizationId` maps to `auth_sessions.active_organization_id`.
- **Rationale:** consistent with how `users`/`auth_sessions`/`accounts` are already remapped, and avoids a bare `member` table colliding with the reader's expectations in a schema that already has `sessions` (coding sessions) distinct from `auth_sessions`.
- **Risk:** the hand-authored columns must match what the plugins query, or failures appear at runtime rather than at typecheck. Mitigated by a schema-conformance test that asserts each mapped model's columns against the plugin's expected field set, and by exercising the plugin APIs (not raw SQL) in the membership tests.

### 9. Linear webhook secret: DB is the source of truth

- **Decision:** `linearWorkspaces.webhookSecret` (written at OAuth callback by the existing `registerLinearWebhook` helper) is authoritative. The webhook route stops reading `LINEAR_WEBHOOK_SECRET`; the env var is removed rather than left as a silent fallback.
- **Rationale:** Two sources of truth is exactly why the restore path is unsafe today: soft-deleting and restoring a connection restores the DB row, so a rotation that updated only the env var would leave a restored connection failing signature verification with no signal. The secret is generated per-webhook-registration by Linear, so the DB is the only source that can be correct.
- **Ground-rule tension, acknowledged:** the Phase 1 ground rules say integration tokens live in env, never DB rows, because preview deployments get a Neon fork of production. The webhook *secret* is not an access token — it grants no API access, only signature verification — but it is still forked into previews. Encryption at rest does **not** fix that: `lib/config/auth.ts` documents that `BETTER_AUTH_SECRET` also derives the AES key for the stored Linear workspace token, and that secret is shared with previews, so a preview can decrypt what it forked. The real mitigation is behavioral, not cryptographic — webhook-triggered runs are gated on `VERCEL_ENV === "production"` in WS-1.3, so a preview holding a valid secret still starts no run. Recorded plainly so this is not mistaken for a solved problem; giving previews their own `BETTER_AUTH_SECRET` is the durable fix and belongs to whichever workstream owns preview secret isolation.

### 10. New env vars extend the existing `authEnv` group rather than adding a config module

- **Decision:** `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `DEFAULT_ORG_NAME`, and `DEFAULT_ORG_SLUG` are declared as specs inside the existing `authEnv` group in `apps/web/lib/config/auth.ts`, each with an `axis`, a one-line `description`, and a Zod schema; they are read through accessors on that module (a `getMembershipConfig()` alongside the existing `getAuthConfig()`), never via `process.env`.
- **Rationale:** these are all sign-in-time membership decisions, which is what `authEnv` already covers, and a group is the unit of validation and `.env.example` generation. A separate group would fragment one concern across two files and add a `registry.ts` entry for no benefit.
- **Axes:** `ADMIN_EMAILS` is `required-prod` — a production deploy without it is adminless, which is exactly the failure the bootstrap exists to prevent, so boot validation should catch it rather than a human noticing later. `ALLOWED_EMAIL_DOMAINS` is `optional`, and unset means "no domain auto-approves" (every sign-up lands `pending`) — the fail-closed reading, not "allow everyone". `DEFAULT_ORG_NAME`/`DEFAULT_ORG_SLUG` are `optional` with defaults.
- **Consequences for the task list:** `.env.example` is generated, not hand-edited — `bun run --cwd apps/web env:example` regenerates it and `lib/config/env-example.test.ts` fails CI if it drifts. The Phase 1 ground rule's "add a schema-parse test" is already satisfied structurally by `validate.test.ts` and `env-example.test.ts`; what this change adds is coverage for the *parsing* of the new values (domain lists, email lists), not new boot-validation plumbing.

### 11. Soft delete + audit are custom; Better Auth has no primitive for them

- **Decision:** `deletedAt` on shared-integration rows, a 14-day production-only purge cron, typed confirmation in the UI, and an append-only `config_audit` table (actor user id, organization id, action, target type/id, before/after summary JSON, timestamp).
- **Rationale:** no plugin covers this. `config_audit` is written in the same transaction as the mutation so an audited action cannot succeed unaudited; it is the seed of the Phase 2 audit log alongside WS-1.1's `policy_event`.
- **Purge safety:** the handler returns early unless `VERCEL_ENV === "production"`, per the Phase 1 ground rules — preview DBs are forks of prod and their rows reference real external resources.

## Open Questions

1. ~~**Phase 0 config module sequencing.**~~ **Resolved** — WS-0.1 landed in `main` (`openspec/changes/config-boundary/`). The four new env vars extend the existing `authEnv` group per Decision 10; there is no longer a sequencing question.
2. **`githubInstallations` org ownership.** The proposal gates "shared GitHub installation removal," but installations are per-user rows today with no shared/org concept. This change adds `organizationId` and an `isOrgShared` flag; deciding *which* existing installations become org-shared on migration (all? none? admin-selected?) needs a call. The tasks default to none — existing rows stay personal, and org-sharing is an explicit admin action — because it is the only choice that cannot broaden access on deploy.
3. **Existing users at migration time.** Every current user predates the membership gate. The tasks grant membership to all existing users at migration and rely on `ADMIN_EMAILS` for owner assignment, rather than dropping everyone into `pending` (which would lock out a live deployment). If the intent is to re-approve the existing user list, that is a one-line change to the backfill migration — flag it before running.
