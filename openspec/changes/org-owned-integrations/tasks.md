## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

**Prerequisites and coordination**

- `org-roles-and-settings` has landed; this change consumes `requirePermission()`, the `integration` statements, and `getSeededOrganizationId()`.
- Settle the `shared-config-governance` reconciliation in `design.md` before group 2 — specifically whether that change's task 2.1 is dropped. Groups 1–3 assume it is.
- Ships in **one deploy**. The three-deploy expand/switch/contract plan protected data across a rolling release; with one account and disposable data it cost more than it bought, so the dual reads, the Vercel migration routine, the conflict table and the contract gate were removed rather than sequenced. See `design.md` decisions 8 and 9.

## 1. Ownership schema — expand

- [x] 1.1 Add `organization_id` (nullable, FK to `organizations`) and `account_id` (GitHub's numeric account identifier) to `github_installations`. Generate the migration; do not drop the existing unique indexes yet. **Deviation:** `user_id` was *not* renamed to `installed_by_user_id`. A rename during expand risks drizzle-kit emitting drop-and-add rather than `ALTER ... RENAME`, and the semantic point — that it is provenance, not authority — is carried by the resolver signatures taking no user id and by a schema comment. Recorded in `design.md` decision 1's spirit; the column keeps its name.
- [x] 1.2 Add a partial unique index on `(organization_id, installation_id)` where `organization_id IS NOT NULL`. **Deviation:** the existing `(user_id, installation_id)` and `(user_id, account_login)` unique indexes were left non-partial — they remain satisfied under both ownership modes, and narrowing them is migration churn with no invariant gained. The contract step revisits them.
- [x] 1.3 Add `org_github_accounts` (organization id, GitHub numeric account id, account login, account type, added-by user id, timestamps) with a unique index on `(organization_id, account_id)`.
- [x] 1.4 Add `organization_id` to `linear_workspaces` with a unique index, and backfill the existing row to the seeded organization.
- [x] 1.5 Add `linear_actor_links` (organization id, Linear user id, QuackOps user id, created-by user id, timestamps) with a unique index on `(organization_id, linear_user_id)`.
- [x] 1.6 Add `organization_id` to `vercel_project_links` and a `vercel_project_link_conflicts` table (organization id, repo owner, repo name, detected-at, resolved-at, resolved-by). Keep the existing primary key for now. **Two deviations:** no `linked_by_user_id` — the existing `user_id` already serves as provenance, matching the `github_installations` decision; and the conflict table stores no candidate columns, because the per-user rows are *retained* on conflict, so the candidates are queryable from `vercel_project_links` and cannot drift out of sync with a copy.
- [x] 1.7 Verify `bun run --cwd apps/web db:check` passes and every generated `.sql` is committed.

## 2. Capture the GitHub account identifier

- [x] 2.1 Parse `account.id` in `apps/web/lib/github/sync.ts`'s installation schema and persist it through `upsertInstallation`.
- [x] 2.2 Parse `account.id` in `apps/web/app/api/github/webhook/route.ts`'s installation schema and persist it on upsert and update, including updating a changed `account_login` for the same account id.
- [x] 2.3 Backfill `account_id` for existing rows via the App-authenticated installation list; rows that cannot be resolved stay personal and are logged, not deleted.
- [x] 2.4 Tests: sync and webhook both persist the account id; a renamed account keeps its id and updates its login.

## 3. Allowlist and promotion

- [x] 3.1 `apps/web/lib/org/github-accounts.ts` — read/add/remove the allowlist, gated on `integration.connect` / `integration.disconnect`, rejecting accounts of type `User`.
- [x] 3.2 Promotion routine: for each installation on a newly allowlisted account, converge on exactly one organization-owned record, earliest `created_at` surviving with its user as `installed_by_user_id`, duplicates removed. Written as a converge, not insert-then-delete, so re-running is a no-op.
- [x] 3.3 Demotion routine: returns an account's installations to personal ownership by their recorded installing user.
- [x] 3.4 Tests: member 403 on add and remove; personal-account rejection; N duplicate rows collapse to one; promotion re-run changes nothing; demotion restores personal ownership; migration alone promotes nothing.

## 4. Org-scoped GitHub resolution — dual read

- [x] 4.1 Add `getOrgInstallationByAccountLogin(accountLogin)` and `getOrgInstallations()` to `apps/web/lib/db/installations.ts`, resolving through `getSeededOrganizationId()` with no caller id.
- [x] 4.2 Make `verifyRepoAccess` step 2 try the org-owned resolver first and fall back to the existing per-user lookup, leaving steps 1 and 3 untouched.
- [x] 4.3 Pinning tests for the authorization order: a user without repo visibility is denied at step 1 even when an org-owned installation covers the repo; a read-only collaborator is denied on a write action; a user with no linked GitHub account is denied; the minted token stays scoped to the single repository.
- [x] 4.4 Tests: a member with no personal record resolves an org-owned installation; two members resolve the same record.

## 5. Linear and Vercel — expand-side reads

- [x] 5.1 `getLinearWorkspace()` resolves by organization instead of by row age; the connecting user is provenance only.
- [x] 5.2 Read/create/delete actor mappings, gated on `integration.connect`, reads open to approved members, one QuackOps user per Linear identity. Split as `lib/db/linear-actor-links.ts` (store) + `lib/org/linear-actor-links.ts` (permissioned actions) rather than one `lib/linear/actor-links.ts`, matching how `lib/org/settings.ts` separates gating from access.
- [x] 5.3 Extend `resolveApprovedLinearActor` to consult the mapping first, then verified-email match; require `emailVerified` on the email path; keep the membership check; keep distinct outcomes for unresolved vs. pending. No fallback identity.
- [x] 5.4 Org-scoped Vercel link reader that prefers the organization row and falls back to the caller's personal row.
- [x] 5.5 Tests: connection survives removal of the connecting user; unverified email does not resolve; mapping overrides a conflicting email match; mapped-but-removed user starts no run; unresolved and pending are distinguishable.

## 6. Sync becomes additive — switch

- [x] 6.1 `syncUserInstallations` upserts only; `deleteInstallationsNotInList` is scoped to rows where `organization_id IS NULL`.
- [x] 6.2 Reconciliation against `GET /app/installations` via `getAppOctokit()` (run via `bun run --cwd apps/web org:ownership reconcile-installations --apply`), removing organization-owned rows the App no longer holds. Idempotent and safe to run repeatedly.
- [x] 6.3 Confirm the `installation.deleted` webhook removes organization-owned rows.
- [x] 6.4 Tests: a member who can no longer see the installation does not remove it by syncing; personal pruning still works and touches no other user's rows; reconciliation removes a stale org row; webhook deletion removes the org row.

## 7. GitHub read paths and routes

- [x] 7.1 Update the six `/api/github/*` routes that list installations by user (`installations`, `installations/repos`, `connection-status`, `orgs/install-status`, `app/install`, `post-link`) plus `lib/onboarding.ts` and `/api/auth/info` to present organization-owned installations to every approved member alongside that member's personal ones.
- [x] 7.2 Ensure `installations/repos` authorizes on the caller's own GitHub access rather than on record ownership.
- [x] 7.3 Tests: an approved member with no personal records sees the organization's installations; the organization's record wins over a stale personal duplicate. (A pending user is refused before reaching these paths by the existing session chokepoint, which `org-roles-and-settings` already pins — not re-tested here.)

## 8. Vercel link migration and conflict resolution

- [x] 8.1 Migration routine (run via `bun run --cwd apps/web org:ownership migrate-vercel-links --apply`; dry run without `--apply`): per repository, create one organization link where all per-user links agree; where they disagree, create no organization link, retain the per-user rows, and write a conflict record.
- [x] 8.2 Admin surface listing unresolved conflicts with competing projects and who recorded each, with resolution gated on `integration.connect`; resolving creates the organization link and clears the record.
- [x] 8.3 Organization Vercel team recorded on `org_settings` (or a colocated org table), gated on `integration.connect`, readable by approved members.
- [x] 8.4 Tests: agreeing repositories migrate; disagreeing repositories create no organization link and are recorded; no automatic winner is chosen; personal fallback still resolves during the window; member 403 on resolve and on setting the team.

## 9. Admin surfaces and docs

- [x] 9.1 GitHub account allowlist screen: add/remove accounts, show which installations each covers, and state plainly that demotion does not undo access already exercised.
- [x] 9.2 Linear actor mapping screen: list, create, delete.
- [x] 9.3 Update `docs/agents/architecture.md`, the `AGENTS.md` authentication section, and `openspec/context.md`'s schema table with the ownership model.
- [x] 9.4 Add the lesson to `docs/agents/lessons-learned.md`: a resolver for a shared resource that takes a `userId` is a scoping bug in waiting.

## 10. Simplification (replaces the contract step)

- [x] 10.1 Re-key `vercel_project_links` to `(organization_id, repo_owner, repo_name)`; delete the migration planner, conflict table, conflict-resolution surface and dual read. Existing rows are dropped — sanctioned, and stated in the migration.
- [x] 10.2 Linear connections are org-owned at connect time, so the unclaimed fallback and the seeder claim are gone.
- [x] 10.3 Drop the `account_id` backfill; new rows carry it from the sync and webhook payloads.
- [x] 10.4 Keep `verifyRepoAccess`'s org-then-personal fallback **permanently** — personal GitHub accounts are never promotable, so it is a standing category, not a backlog. An earlier draft wrongly listed it for removal.
- [x] 10.5 `bun run ci` and `next build` green; `ownership-schema.test.ts` updated for both shapes.
