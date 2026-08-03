## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

Task groups map to reviewable PRs. Groups 1–2 are sequential (everything depends on the
plugin schema landing); groups 3–5 can run in parallel behind them; group 6 is independent
and can start immediately. Open question 1 in `design.md` is resolved (WS-0.1 landed);
resolve questions 2 and 3 before group 1.

## 1. Auth plugins, schema, and permission model

- [ ] 1.1 Declare `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` (`required-prod`), `DEFAULT_ORG_NAME`, `DEFAULT_ORG_SLUG` as specs in the existing `authEnv` group (`apps/web/lib/config/auth.ts`) with axes + descriptions; add a `getMembershipConfig()` accessor; regenerate the example file with `bun run --cwd apps/web env:example` and commit it; add parsing tests for the domain/email list values. Unset `ALLOWED_EMAIL_DOMAINS` must mean "nothing auto-approves", not "allow all".
- [ ] 1.2 Add Drizzle tables `organizations`, `org_members`, `org_invitations` matching the Better Auth organization plugin models; add `users.role` (default `"user"`) and `auth_sessions.active_organization_id`.
- [ ] 1.3 Generate and commit the migration: `bun run --cwd apps/web db:generate`. Do **not** drop `users.is_admin` in this migration.
- [ ] 1.4 Backfill migration: `role = 'admin'` where `is_admin = true`; seed the single organization from config; grant membership to every existing user (owner for `ADMIN_EMAILS`, member otherwise).
- [ ] 1.5 Configure the organization plugin in `apps/web/lib/auth/config.ts` — `allowUserToCreateOrganization: false`, teams off, `dynamicAccessControl` off, model names mapped to `organizations`/`org_members`/`org_invitations`; extend the Drizzle adapter schema map.
- [ ] 1.6 Configure the admin plugin with `defaultRole: "user"` and `adminRoles: ["admin"]`.
- [ ] 1.7 Create `apps/web/lib/auth/permissions.ts` — `createAccessControl` statement set (`orgSettings`, `integration`, `repoMapping`, `observability`, `membership`, `agentRun`, `posture`, `warmCache`) plus the `owner`/`admin`/`member` role definitions; wire into both plugin configs and the auth client.
- [ ] 1.8 Add `databaseHooks.session.create.before` setting `activeOrganizationId` to the seeded org.
- [ ] 1.9 Create `apps/web/lib/auth/require-permission.ts` — `requirePermission()` wrapping `auth.api.hasPermission`, and `requireApprovedMember()` as a positive membership check.
- [ ] 1.10 Repoint `isUserAdmin()` to read `users.role`, keeping its signature; verify `apps/web/app/api/auth/info/route.ts`, `apps/web/lib/admin/actions.ts`, and `apps/web/hooks/use-session.ts` are unchanged.
- [ ] 1.11 Schema-conformance test asserting each hand-authored plugin table carries every column its plugin model requires.
- [ ] 1.12 Permission-matrix test: for each role × each statement action, assert allow/deny.
- [ ] 1.13 Last-admin invariant: refuse demotion, removal, and ban of the last `owner`/`admin`; tests for each path.

## 2. Membership gate

- [ ] 2.1 `databaseHooks.user.create.after` — grant `member` membership on `ALLOWED_EMAIL_DOMAINS` match; grant `owner` + platform `admin` on `ADMIN_EMAILS` match; otherwise grant nothing.
- [ ] 2.2 Verify account linking does not re-run the approval hook and cannot grant membership (`accountLinking.allowDifferentEmails` is enabled).
- [ ] 2.3 Enforce `requireApprovedMember()` on every session, integration, org-settings, and run-start route and server action; audit the route tree for misses.
- [ ] 2.4 Pending-approval screen; route pending users to it and hide all org navigation.
- [ ] 2.5 Admin-area pending-users list (`users LEFT JOIN org_members WHERE org_members.id IS NULL`) with approve/reject actions behind `membership.approve`/`membership.reject`.
- [ ] 2.6 Member list + role management UI behind `membership.setRole`.
- [ ] 2.7 Tests: allowlisted domain, non-allowlisted domain, null email, subdomain non-match, linked-account non-grant, pending 403 on each protected surface, idempotent approval.

## 3. Org settings and kill switch

- [ ] 3.1 `org_settings` table keyed by unique `organizationId` FK with `agentRunsPaused` (non-null, default false) and `dailyTokenBudget` (nullable); migration; row seeded for the seeded org.
- [ ] 3.2 `apps/web/lib/org/settings.ts` — typed read/update accessors; update path gated on `orgSettings.update` and audited.
- [ ] 3.3 Kill-switch check at every run-start path (interactive chat and webhook-triggered), returning a structured paused response; fail closed if the settings read errors.
- [ ] 3.4 Admin-area org settings UI: kill switch and daily token budget.
- [ ] 3.5 Tests: paused blocks chat run start, paused blocks webhook run start, unpause restores without restart, read failure fails closed, member update returns 403, in-flight runs unaffected.

## 4. Integration gating

- [ ] 4.1 Gate `/api/linear/connect` on `integration.connect` and the disconnect path on `integration.disconnect`; leave connection status open to approved members.
- [ ] 4.2 Consolidate the Linear webhook secret to the workspace record; remove `LINEAR_WEBHOOK_SECRET` from the webhook route, `.env.example`, and docs.
- [ ] 4.3 Add `organizationId` + `isOrgShared` to `githubInstallations`; migration leaves all existing rows personal; gate org-shared removal on `integration.disconnect`.
- [ ] 4.4 Gate org-level sandbox defaults and provider enablement on `orgSettings.update`; leave per-user provider selection open.
- [ ] 4.5 Gate observability configuration on `observability.configure` (surface lands with WS-1.2; the gate and permission land here).
- [ ] 4.6 Tests: member 403 on each gated mutation, member success on each read path, direct-API call with the UI control hidden still 403s.

## 5. Audit trail, soft delete, and purge

- [ ] 5.1 `config_audit` table (actor user id, organization id, action, target type, target id, before/after summary JSONB, timestamp) + migration; insert-only access helper in `apps/web/lib/audit/`.
- [ ] 5.2 Write audit entries in the same transaction as every shared-config mutation from groups 2–4; assert rollback-on-audit-failure; assert secrets are summarized, never recorded.
- [ ] 5.3 Add `deletedAt` to shared-integration tables; exclude soft-deleted rows from all read paths.
- [ ] 5.4 Typed-confirmation dialog for destructive shared-config actions; server-side confirmation-string check (not UI-only).
- [ ] 5.5 Restore action within the 14-day window, behind the same permission as delete; verify a restored Linear connection verifies webhook signatures.
- [ ] 5.6 Purge cron route: permanently removes soft-deleted rows older than 14 days; returns early unless `VERCEL_ENV === "production"`.
- [ ] 5.7 Tests: confirmation mismatch refuses, soft-deleted integration reads as absent, restore-then-webhook-verifies, purge no-ops in preview, purge boundary at exactly 14 days.

## 6. Sandbox credential protection

- [ ] 6.1 Move sandbox provider credentials out of plaintext `user_sandbox_configs.config` — environment-sourced where possible, otherwise encrypted at rest with the existing Linear AES-GCM helper.
- [ ] 6.2 Expand-contract sequencing: land the new read path before the plaintext-removal migration.
- [ ] 6.3 Mask credential presence in API responses to the settings UI; never return values.
- [ ] 6.4 Removal migration; prompt affected users to re-enter credentials rather than silently failing provisioning.
- [ ] 6.5 Tests: saved config contains no plaintext credential, provisioning still succeeds, settings response is masked.

## 7. Docs and verification

- [ ] 7.1 Update the CLAUDE.md Authentication section — it currently states there is no plugin layer beyond better-auth sessions; describe the organization + admin plugins, the two role concepts, and the membership gate.
- [ ] 7.2 Update `docs/agents/architecture.md` with the org/permission layer and the new tables.
- [ ] 7.3 Update `openspec/context.md`'s schema table with `organizations`, `org_members`, `org_invitations`, `org_settings`, `config_audit`, and the `users.role` change.
- [ ] 7.4 Record the plugin-adoption decision and the `pending`-is-absence-of-membership rationale in `docs/agents/lessons-learned.md`.
- [ ] 7.5 Follow-up PR (after one deploy): drop `users.is_admin`.
- [ ] 7.6 `bun run ci` green.
- [ ] 7.7 Manual: sign in from a non-allowlisted domain → pending screen; approve → access; demote last admin → refused; flip kill switch → next run start blocked; disconnect Linear with typed confirmation → restore → webhook verifies.
