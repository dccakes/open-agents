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

### 5. One access-control statement set, built on top of the plugins' `defaultStatements`

- **Decision:** `apps/web/lib/auth/permissions.ts` defines a single `createAccessControl` statement set and the static roles, imported by both plugin configs and by the client. The set is the plugins' own `defaultStatements` **spread in first**, then the QuackOps-specific resources added alongside:

  ```ts
  import { defaultStatements as orgDefaults } from "better-auth/plugins/organization/access"
  import { defaultStatements as adminDefaults } from "better-auth/plugins/admin/access"

  const statement = { ...orgDefaults, ...adminDefaults, /* custom resources below */ } as const
  ```

  | Resource | Actions | Owner | Consumed by |
  |---|---|---|---|
  | `organization` | `update`, `delete` | org plugin default | built-in org endpoints |
  | `member` | `create`, `update`, `delete` | org plugin default | approve / setRole / remove |
  | `invitation` | `create`, `cancel` | org plugin default | built-in invite endpoints |
  | `ac` | `create`, `read`, `update`, `delete` | org plugin default | unused (dynamic AC off) |
  | `user`, `session` | admin plugin defaults | admin plugin default | ban, impersonate, revoke |
  | `orgSettings` | `read`, `update` | custom | WS-1.0 kill switch, budget |
  | `integration` | `read`, `connect`, `disconnect` | custom | shared-config-governance |
  | `repoMapping` | `read`, `create`, `update`, `delete` | custom | WS-1.3 |
  | `observability` | `read`, `configure` | custom | WS-1.2 |
  | `agentRun` | `create`, `read`, `stop` | custom | WS-1.5 dashboard |
  | `posture` | `setDangerous` | custom | WS-1.1 |
  | `warmCache` | `shareOrgWide`, `discard` | custom | WS-1.4 |

  Role assignment: `member` gets read actions plus `agentRun.create`/`read`; `admin` gets everything except `organization.delete`; `owner` gets everything. Downstream workstreams add rows to this table rather than inventing new gates.
- **Why the defaults must be spread in — verified, not assumed:** the organization plugin's built-in endpoints authorize against the roles *you* pass it, using its own resource names. `removeMember` requires `member: ["delete"]` and `updateMemberRole` requires `member: ["update"]` (`node_modules/better-auth/dist/plugins/organization/routes/crud-members.mjs`), checked against `options.roles`. A statement set containing only custom resources produces roles that deny every built-in member mutation — including for `owner` — which would silently defeat the whole "adopt the plugin instead of hand-rolling" premise. `defaultStatements` is exported from each plugin's `access` entrypoint (`organization/access/statement.d.mts` declares `organization`/`member`/`invitation`/`team`/`ac`; `admin/access/statement.d.mts` declares `user`/`session`).
- **Consequence:** there is **no custom `membership` resource.** Approve / set-role / remove map onto the plugin's existing `member.create` / `member.update` / `member.delete`. An earlier draft of this design invented a parallel `membership` vocabulary; that was redundant with the plugin's own statements and is removed.
- **Rationale:** WS-1.1's "`dangerous` posture is admin-only", WS-1.2's "configuration is admin-only", WS-1.3's "mappings are admin-only", WS-1.4's "org-shared cache is opt-in by an admin", and WS-1.5's dashboard are five separate ad-hoc admin checks in the plan. One statement set makes them one mechanism with one test surface.
- **Enforcement:** a `requirePermission(permissions)` helper wrapping `auth.api.hasPermission` — server-side, authoritative. `checkRolePermission` is used **only** to hide UI affordances; every hidden control also has a server-side check, because hiding a button is not authorization.

### 6. `org_settings` is a table keyed by `organizationId`, not a singleton and not org `metadata`

- **Decision:** `org_settings` has `organizationId` as a unique FK to `organizations.id`, with typed columns `agentRunsPaused boolean` and `dailyTokenBudget integer`.
- **Rationale:** The organization plugin offers a `metadata` JSON column, which is tempting and wrong for these two fields. The kill switch is read on the hot path before every agent run starts (chat and webhook), needs a typed non-null value, and must not depend on unvalidated JSON parsing succeeding — a malformed `metadata` blob must not fail open into "runs allowed." Keying by `organizationId` rather than a fixed id makes the Phase 2 multi-org migration a no-op for this table.
- **Kill-switch semantics:** enforcement is at every run-start path, not in the workflow loop, so "within one request cycle" means the next run-start request. In-flight runs are unaffected — stopping those is WS-1.5's per-run stop. This boundary is stated in the spec because "the agent is doing something bad at 3am" implies both, and only one is in scope here.

### 7. Seeding and org-context backfill are runtime work, not migration work

- **Decision:** the organization row is created by an **idempotent runtime seeder** (`ensureSeededOrganization()`), invoked from `instrumentation.ts` alongside the existing boot validation and guarded by a unique index on `organizations.slug` so concurrent boots converge on one row. Migrations only create structure. Membership backfill for existing users runs in the same seeder, not in SQL.
- **Rationale:** Drizzle migrations are static committed `.sql` executed by `lib/db/migrate.ts` during build. They cannot read `DEFAULT_ORG_NAME`, `DEFAULT_ORG_SLUG`, or `ADMIN_EMAILS`. The alternatives are hardcoding config values into committed SQL — which drifts, and bakes one environment's values into every environment, including previews — or a runtime seeder. An earlier draft of this design specified "migration seeds the org from config," which is not implementable; this decision replaces it.
- **`activeOrganizationId` must be backfilled, not only set on create.** Sessions issued before this change have `active_organization_id` NULL, and the organization plugin resolves the org for `hasPermission` from the session. Setting it only in `databaseHooks.session.create.before` (Decision 1's original wording) would leave every signed-in user — admins included — hitting fail-closed denials until they signed out and back in, directly contradicting the "existing users are not locked out" requirement. Two mitigations, both required: the seeder backfills `active_organization_id` on existing `auth_sessions` rows, **and** `requirePermission()` resolves the seeded organization id explicitly rather than trusting the session field, so a NULL is never load-bearing while exactly one org exists.

### 8. `isAdmin` → `role` by expand-contract, in that order

- **Decision:** (1) add `users.role` with default `"user"`; (2) backfill `role = 'admin'` where `is_admin = true`; (3) repoint `isUserAdmin()` to read `role`, keeping the function signature so `apps/web/app/api/auth/info/route.ts`, `apps/web/lib/admin/actions.ts`, and `apps/web/hooks/use-session.ts` are untouched; (4) drop `is_admin` in a **later** PR.
- **Rationale:** Migrations run automatically during `bun run build` on every Vercel deploy, including previews (`apps/web/lib/db/migrate.ts`). A single migration that adds `role` and drops `is_admin` leaves the previous deployment's still-running code reading a dropped column during the rollout window. Expand-contract is required here, not stylistic.
- **Note:** the same discipline applies to the `user_sandbox_configs.config` credential removal, which is why it is now a separate change (`sandbox-credential-protection`) rather than a trailing task group here.

### 9. Table naming follows the repo, not the plugin defaults

- **Decision:** Drizzle remains the source of truth for schema and migrations; the Better Auth CLI generator is not used. Plugin tables are hand-authored in `apps/web/lib/db/schema.ts` and mapped via each plugin's `schema.<model>.modelName` / `fields` options: `organization → organizations`, `member → org_members`, `invitation → org_invitations`. The new `session.activeOrganizationId` maps to `auth_sessions.active_organization_id`.
- **Rationale:** consistent with how `users`/`auth_sessions`/`accounts` are already remapped, and avoids a bare `member` table colliding with the reader's expectations in a schema that already has `sessions` (coding sessions) distinct from `auth_sessions`.
- **Every declared field must exist, including ones this change does not use.** Better Auth selects the fields its plugin schemas declare, so a missing column is a SQL error on ordinary requests, not a dormant gap. The full set:
  - `users`: `role`, **`banned`**, **`banReason`**, **`banExpires`** (`plugins/admin/schema.d.mts`)
  - `auth_sessions`: `activeOrganizationId`, **`impersonatedBy`** (admin plugin)
  - `organizations`: `id`, `name`, `slug`, `logo`, **`metadata`**, `createdAt` — `metadata` is a real column on the plugin model even though Decision 6 declines to *store settings in it*
  - `org_members`: `id`, `userId`, `organizationId`, `role`, `createdAt`
  - `org_invitations`: `id`, `email`, `inviterId`, `organizationId`, `role`, `status`, `createdAt`, `expiresAt`
- **Risk and mitigation:** hand-authored columns that don't match what the plugins query fail at runtime rather than at typecheck. The conformance test therefore covers **the extended `users` and `auth_sessions` tables as well as the three new ones** — an earlier draft checked only the new tables, which is exactly where the four admin-plugin columns above went missing. Membership tests exercise the plugin APIs rather than raw SQL, so a schema mismatch surfaces as a test failure.

### 10. New env vars extend the existing `authEnv` group rather than adding a config module

- **Decision:** `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `DEFAULT_ORG_NAME`, and `DEFAULT_ORG_SLUG` are declared as specs inside the existing `authEnv` group in `apps/web/lib/config/auth.ts`, each with an `axis`, a one-line `description`, and a Zod schema; they are read through accessors on that module (a `getMembershipConfig()` alongside the existing `getAuthConfig()`), never via `process.env`.
- **Rationale:** these are all sign-in-time membership decisions, which is what `authEnv` already covers, and a group is the unit of validation and `.env.example` generation. A separate group would fragment one concern across two files and add a `registry.ts` entry for no benefit.
- **Axes:** `ADMIN_EMAILS` is `required-prod` — a production deploy without it is adminless, which is exactly the failure the bootstrap exists to prevent, so boot validation should catch it rather than a human noticing later. `ALLOWED_EMAIL_DOMAINS` is `optional`, and unset means "no domain auto-approves" (every sign-up lands `pending`) — the fail-closed reading, not "allow everyone". `DEFAULT_ORG_NAME`/`DEFAULT_ORG_SLUG` are `optional` with defaults.
- **Consequences for the task list:** `.env.example` is generated, not hand-edited — `bun run --cwd apps/web env:example` regenerates it and `lib/config/env-example.test.ts` fails CI if it drifts. The Phase 1 ground rule's "add a schema-parse test" is already satisfied structurally by `validate.test.ts` and `env-example.test.ts`; what this change adds is coverage for the *parsing* of the new values (domain lists, email lists), not new boot-validation plumbing.

### 11. Revocation is effective on the next request, and cookie caching is prohibited

- **Decision:** demotion, removal, and ban take effect on the caller's **next request**. This holds today only because every check is a per-request DB lookup and `session.cookieCache` is not configured in `apps/web/lib/auth/config.ts`. That is an accident of configuration, so this change pins it: enabling Better Auth's session cookie cache is prohibited while permission checks read from the session, and a test asserts the option stays unset. On removal or ban, `revokeUserSessions` is called for the target so existing sessions die immediately rather than merely failing their next check.
- **Rationale:** the whole permission model is a per-request lookup. Cookie caching would serve a stale role for the cache TTL — a demoted admin keeps admin for that window — and nothing in the code would flag it. Prohibiting it explicitly is cheaper than making every check cache-aware.
- **Explicitly out of scope:** a removed member's **in-flight agent runs** keep executing in a sandbox holding their GitHub token. Stopping them requires per-run termination, which is WS-1.5's admin runs dashboard. This change does not pretend to cover it; the incident runbook (WS-1.5) is where "revoke, then reap the runs" is sequenced. Recorded here because "remove a member" reads as complete and is not.

### 12. Enforcement needs a structural backstop, not a route inventory

- **Decision:** approved-membership enforcement lives at a chokepoint every authenticated path already crosses — the server session helper (`apps/web/lib/session/get-server-session.ts`) returns a session carrying membership state, and callers cannot get an authenticated session without it — plus middleware for page routes. A per-route audit is a *supplement*, not the mechanism.
- **Rationale:** "audit the route tree and add a check to each" fails open on exactly one miss, and stays wrong for every route added afterwards. The design's own fail-closed claim (Decision 2) is only as strong as its weakest enforcement point.
- **The webhook path does not have a session at all.** `apps/web/app/api/linear/webhook/route.ts` matches a Linear actor's **email** to a user and creates a session as them — no cookie, so `requireApprovedMember()` never runs. Webhook-triggered runs must check the *matched user's* membership explicitly before creating anything. Without this, delegating a Linear issue to a pending user's email produces an agent run for someone who has never been approved.

### 13. Public share links are an explicit carve-out, stated rather than implied

- **Decision:** creating a share requires approved membership, and shares created by a user are revoked when that user is removed or banned. Already-issued share links remain publicly readable by anyone holding the URL — that is what the `shares` feature is — so the membership gate's guarantee is scoped to *authenticated access paths*, not to previously published links.
- **Rationale:** `apps/web/app/shared/[shareId]/` serves chat content to unauthenticated viewers by design (`shares`, `apps/web/lib/db/schema.ts`). An unqualified "pending users cannot reach organization data" claim is false while that exists, and a spec that overpromises is worse than one that carves out honestly. WS-1.2 must decide the *harder* version of this question for telemetry data (the parent plan says silence is not an option); this change states the baseline rule so WS-1.2 has something to narrow.

## Open Questions

1. ~~**Phase 0 config module sequencing.**~~ **Resolved** — WS-0.1 landed in `main` (`openspec/changes/config-boundary/`). The four new env vars extend the existing `authEnv` group per Decision 10; there is no longer a sequencing question.
2. ~~**`githubInstallations` org ownership.**~~ **Moved** — installation ownership is gated by the `shared-config-governance` change; the open question travels with it.
3. **Existing users at cutover.** Every current user predates the membership gate. The seeder (Decision 7) grants membership to all existing users and relies on `ADMIN_EMAILS` for owner assignment, rather than dropping everyone into `pending`, which would lock out a live deployment. If the intent is instead to re-approve the existing user list, that is a one-line change in the seeder — flag it before it runs, because the first production boot after deploy is the only chance to decide.
