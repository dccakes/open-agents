## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

**Prerequisites:**

- `org-roles-and-settings` task group 1 must have landed — this change consumes
  `requirePermission()`, the `integration`/`orgSettings`/`observability` statements, and the
  seeded organization id.
- `org-owned-integrations` supplies the installation ownership model this change gates.
  Task 2.1 was dropped and design decision 4 amended accordingly; see both below.
  Open question 1 is answered there too — no installation is org-owned until an admin
  claims its GitHub account.

## 1. Audit trail

- [ ] 1.1 `config_audit` table (actor user id, organization id, action, target type, target id, before/after summary JSONB, timestamp) + migration.
- [ ] 1.2 Insert-only access helper in `apps/web/lib/audit/`; no update or delete path exists in application code.
- [ ] 1.3 Transactional audit wrapper for app-owned mutations, asserting the mutation rolls back if the audit insert fails.
- [ ] 1.4 Best-effort audit from the organization plugin's `afterAddMember` / `afterUpdateMemberRole` / `afterRemoveMember` hooks, with hook failures reported to the error tracker rather than swallowed.
- [ ] 1.5 Secret redaction: a mutation touching a credential records that it changed, never the value.
- [ ] 1.6 Tests: audited mutation writes a row, audit failure rolls back an app-owned mutation, plugin-mediated change is audited via hook, secret values never appear in a row.

## 2. Integration gating

- ~~2.1 Add `organization_id` + `is_org_shared` to `github_installations`.~~ **Dropped** — `org-owned-integrations` provides ownership via a non-NULL `organization_id`, set only when an admin claims the GitHub *account* in `org_github_accounts`. Adding `is_org_shared` on top would be a second ownership concept that nothing reads. See design decision 4.
- [ ] 2.2 Gate `/api/linear/connect` on `integration.connect` and the disconnect path on `integration.disconnect`; leave connection status open to approved members.
- [ ] 2.3 Gate org-shared GitHub installation removal on `integration.disconnect`; leave personal installation removal to its owner. "Org-shared" reads `organization_id IS NOT NULL`. Note the account-level path already exists and is gated: `releaseGitHubAccount()` in `lib/org/github-accounts.ts`. What is still missing is the per-installation removal route.
- [ ] 2.4 Gate org-level sandbox defaults and provider enablement on `orgSettings.update`; leave per-user provider selection open.
- [ ] 2.5 Gate observability configuration on `observability.configure` (the surface itself lands with WS-1.2).
- [ ] 2.6 Wire every gated mutation to an audit write.
- [ ] 2.7 Tests: member 403 on each gated mutation, member success on each read path, direct-API call with the UI control hidden still 403s.

## 3. Webhook secret consolidation

- [ ] 3.1 Change `apps/web/app/api/linear/webhook/route.ts` to verify against `linearWorkspaces.webhookSecret`.
- [ ] 3.2 Remove `LINEAR_WEBHOOK_SECRET` from `apps/web/lib/config/linear.ts`; regenerate `.env.example` via `bun run --cwd apps/web env:example` and commit it.
- [ ] 3.3 Test that verification behavior is unchanged with the env var unset, demonstrating no fallback remains.

## 4. Deletion protection

- [ ] 4.1 Add `deleted_at` to shared-integration tables; exclude soft-deleted rows in the per-table DB helpers so the filter lives in one place.
- [ ] 4.2 Typed-confirmation dialog for destructive shared-config actions, with the confirmation string checked **server-side**.
- [ ] 4.3 Restore action within the 14-day window, behind the same permission as delete.
- [ ] 4.4 Verify a restored Linear connection verifies inbound webhook signatures — the acceptance criterion the two-sources-of-truth bug would have broken.
- [ ] 4.5 Purge cron route: removes rows soft-deleted strictly more than 14 days ago; returns early unless `VERCEL_ENV === "production"`.
- [ ] 4.6 Tests: confirmation mismatch refuses, soft-deleted integration reads as absent, restore-then-webhook-verifies, purge no-ops in preview, record deleted exactly 14 days ago is retained.

## 5. Docs and verification

- [ ] 5.1 Update `docs/agents/architecture.md` with the audit table and soft-delete lifecycle.
- [ ] 5.2 Record in `docs/agents/lessons-learned.md`: the transactional-audit guarantee cannot cross Better Auth's plugin APIs, and why.
- [ ] 5.3 `bun run ci` green.
- [ ] 5.4 Manual: disconnect Linear as admin with typed confirmation, restore it, confirm an inbound webhook verifies.
