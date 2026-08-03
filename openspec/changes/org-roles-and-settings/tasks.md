## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

Task groups map to reviewable PRs. Group 1 gates everything else. Groups 2 and 3 can run in
parallel behind it. The `shared-config-governance` and `sandbox-credential-protection`
changes stack on this one — do not start them until group 1 has landed.

Resolve open question 3 in `design.md` (whether existing users are auto-approved at cutover)
before group 1 ships, because the first production boot after deploy is the only chance to
decide.

## 1. Auth plugins, schema, and permission model

- [x] 1.1 Declare `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` (`required-prod`), `DEFAULT_ORG_NAME`, `DEFAULT_ORG_SLUG` as specs in the existing `authEnv` group (`apps/web/lib/config/auth.ts`) with axes + descriptions; add a `getMembershipConfig()` accessor; regenerate the example file with `bun run --cwd apps/web env:example` and commit it; add parsing tests for the domain/email list values. Unset `ALLOWED_EMAIL_DOMAINS` must mean "nothing auto-approves", not "allow all".
- [x] 1.2 Add Drizzle tables `organizations` (incl. `metadata` — a real plugin column even though this change stores nothing in it), `org_members`, `org_invitations`, with a unique index on `organizations.slug`.
- [x] 1.3 Extend existing tables with **every** field the plugins declare: `users.role`, `users.banned`, `users.banReason`, `users.banExpires`, `auth_sessions.activeOrganizationId`, `auth_sessions.impersonatedBy`. Missing any of these is a SQL error on authenticated requests, not a dormant gap — see `design.md` Decision 9.
- [x] 1.4 Generate and commit the migration: `bun run --cwd apps/web db:generate`. Do **not** drop `users.is_admin` in this migration. Backfill `role = 'admin'` where `is_admin = true` (this part is static SQL and belongs in the migration).
- [x] 1.5 Idempotent runtime seeder `ensureSeededOrganization()` invoked from `instrumentation.ts`: creates the org from config, creates its `org_settings` row, grants membership to all existing users, assigns `owner` to `ADMIN_EMAILS` holders, and backfills `active_organization_id` on existing `auth_sessions`. Must be concurrency-safe via the slug unique index, not check-then-insert.
- [x] 1.6 Configure the organization plugin — `allowUserToCreateOrganization: false`, teams off, `dynamicAccessControl` off, model names mapped to `organizations`/`org_members`/`org_invitations`; extend the Drizzle adapter schema map.
- [x] 1.7 Configure the admin plugin with `defaultRole: "user"` and `adminRoles: ["admin"]`.
- [x] 1.8 Create `apps/web/lib/auth/permissions.ts` — `createAccessControl` over `{...orgDefaultStatements, ...adminDefaultStatements, ...customResources}` plus the `owner`/`admin`/`member` role definitions; wire into both plugin configs and the auth client. There is **no** custom `membership` resource: approve/set-role/remove map onto the plugin's `member.create`/`update`/`delete`.
- [x] 1.9 Add `databaseHooks.session.create.before` setting `activeOrganizationId`; assert session cookie caching stays unset.
- [x] 1.10 Create `requirePermission()` wrapping `auth.api.hasPermission` (resolving the seeded org explicitly, not trusting `active_organization_id`) and `requireApprovedMember()` as a positive membership check.
- [x] 1.11 Repoint `isUserAdmin()` to read `users.role`, keeping its signature; verify `apps/web/app/api/auth/info/route.ts`, `apps/web/lib/admin/actions.ts`, and `apps/web/hooks/use-session.ts` are unchanged.
- [x] 1.12 Schema-conformance test covering the three new tables **and** the extended `users`/`auth_sessions`, asserting every plugin-declared column exists.
- [x] 1.13 Permission-matrix test: role × statement action allow/deny, plus an assertion that every resource in both plugins' `defaultStatements` survives in the shared set.
- [x] 1.14 Test that built-in plugin endpoints (`removeMember`, `updateMemberRole`) are authorized for `owner`/`admin` — the regression that catches a statement set drifting away from the defaults.
- [x] 1.15 Last-admin invariants: refuse demotion/removal/ban of the last org `owner`/`admin`, and of the last **platform** admin.

## 2. Membership gate and enforcement

- [x] 2.1 `databaseHooks.user.create.after` — grant `member` membership on verified-email `ALLOWED_EMAIL_DOMAINS` match; grant `owner` + platform `admin` on verified-email `ADMIN_EMAILS` match; otherwise grant nothing. Unverified or absent email never matches either list.
- [x] 2.2 Verify account linking does not re-run the approval hook and cannot grant membership (`accountLinking.allowDifferentEmails` is enabled).
- [x] 2.3 Enforce approved membership at the **structural chokepoint** — the server session helper — so a new authenticated route is gated by default; add middleware for page routes. A per-route audit is a supplement, not the mechanism.
- [x] 2.4 Add an explicit membership check to the Linear webhook run-creation path, which resolves a user by actor email and has no browser session.
- [x] 2.5 Pending-approval screen; route pending users to it and hide all org navigation.
- [x] 2.6 Admin-area pending-users list (`users LEFT JOIN org_members WHERE org_members.id IS NULL`) with approve/reject behind `member.create`.
- [x] 2.7 Member list + role management UI behind `member.update`; platform-role grant/revoke UI for platform admins.
- [x] 2.8 Revocation: call `revokeUserSessions` on removal and ban; confirm demotion takes effect on the next request; state in the removal UI that in-flight runs are not terminated (WS-1.5 owns per-run stop).
- [x] 2.9 Gate share creation on approved membership; revoke a user's shares on removal or ban.
- [x] 2.10 Restrict admin-plugin capabilities (impersonate, createUser, setUserPassword, session listing) to platform admins; audit impersonation start and stop.
- [x] 2.11 Tests: allowlisted domain, non-allowlisted, null email, unverified email, subdomain non-match, unset allowlist, linked-account non-grant, pending 403 on each protected surface, idempotent approval, webhook-to-pending-user refusal, removal revokes sessions and shares, cookie-cache assertion.

## 3. Org settings and kill switch

- [x] 3.1 `org_settings` table keyed by unique `organizationId` FK with `agentRunsPaused` (non-null, default false) and `dailyTokenBudget` (nullable); migration; row created by the seeder from 1.5.
- [x] 3.2 `apps/web/lib/org/settings.ts` — typed read/update accessors; update path gated on `orgSettings.update` and audited transactionally (app-owned mutation).
- [x] 3.3 Kill-switch check at every run-start path (interactive chat and webhook-triggered), returning a structured paused response; fail closed if the settings read errors.
- [x] 3.4 Admin-area org settings UI: kill switch and daily token budget, stating that the switch stops new runs in this deployment only.
- [x] 3.5 Tests: paused blocks chat run start, paused blocks webhook run start, unpause restores without restart, read failure fails closed, member update returns 403, in-flight runs unaffected.

## 4. Docs and verification

- [x] 4.1 Update the AGENTS.md Authentication section — it currently says sessions are better-auth's built-in system with no further layer; describe the organization + admin plugins, the two role concepts, and the membership gate.
- [x] 4.2 Update `docs/agents/architecture.md` with the org/permission layer and the new tables.
- [x] 4.3 Update `openspec/context.md`'s schema table with `organizations`, `org_members`, `org_invitations`, `org_settings`, and the `users.role` change.
- [x] 4.4 Record in `docs/agents/lessons-learned.md`: plugin `defaultStatements` must be spread into a custom statement set or built-in endpoints deny; plugin-declared columns must all exist; migrations cannot read config.
- [ ] 4.5 Follow-up PR (after one deploy): drop `users.is_admin`.
- [x] 4.6 `bun run ci` green.
- [ ] 4.7 Manual: sign in from a non-allowlisted domain → pending screen; approve → access; demote last admin → refused; remove a member → their sessions and shares die; flip kill switch → next run start blocked.
