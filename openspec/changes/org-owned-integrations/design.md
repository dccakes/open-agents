## Context

See `proposal.md` — Why. The design-relevant facts about current state:

- `verifyRepoAccess` (`apps/web/lib/github/access.ts`) is a three-step check: (1) the *caller's own* GitHub OAuth token can `repos.get` the repo, at write permission when asked; (2) `getInstallationByAccountLogin(userId, owner)` finds an installation row; (3) a repo-scoped installation token can `repos.get` the same repo. Step 1 is the authorization. Step 2 is a resource lookup that merely happens to be keyed by the caller.
- `syncUserInstallations` (`apps/web/lib/github/sync.ts`) fetches `GET /user/installations` — a *per-user* view — then calls `deleteInstallationsNotInList(userId, ...)`.
- `apps/web/app/api/github/webhook/route.ts` already handles `installation` / `installation_repositories` events including `action: "deleted"`, and `getAppOctokit()` (`lib/github/app.ts:180`) can authenticate as the App itself.
- `linear_workspaces` has no `organization_id`; `getLinearWorkspace()` returns the oldest row. `resolveApprovedLinearActor` matches `actorEmail` against `users.email` and then calls `isApprovedMember`.
- `vercel_project_links` has primary key `(user_id, repo_owner, repo_name)`.
- Migrations run on every deploy, preview included, and preview databases are Neon forks of production.

## Goals / Non-Goals

**Goals:**

- One ownership convention for shared integrations that a reviewer can check by reading a table definition: org-owned rows carry `organization_id`; personal rows do not.
- Resolution of a shared integration never depends on which member is asking.
- No path in this change widens who can reach a repo, a Linear workspace, or a Vercel project beyond what that human could already reach at the provider.
- Every promotion from personal to org-owned is an explicit admin act, per `shared-config-governance` decision 4's principle.

**Non-Goals:**

- A generic integration-connection abstraction (see decision 1).
- Changing authentication, sign-in providers, or account linking.
- Making sessions, chats, or sandbox credentials org-visible.
- Multi-org support. Every helper here resolves *the* organization via `getSeededOrganizationId()`, exactly as `org-roles-and-settings` established.

## Decisions

### 1. Per-integration tables with a shared ownership convention, not one `integration_connections` table

- **Decision:** each integration keeps its own typed table. What is shared is a convention: an org-owned row carries a non-null `organization_id`; the human who created it is recorded as provenance (`installed_by_user_id` / `linked_by_user_id`), never as owner; and the resolver for an org-owned resource takes no `userId` parameter.
- **Alternative rejected:** a polymorphic `integration_connections(kind, organization_id, config JSONB)`. GitHub installations, a Linear workspace token, and Vercel project links share nothing but the word "integration" — different cardinality, different lifecycle, different credentials. `org-roles-and-settings` already rejected JSON config for `org_settings` on the grounds that a malformed blob must not fail open; the same reasoning applies harder to credentials.
- **Consequence:** the convention is enforced by review and by the resolver signatures, not by the type system. The mitigation is that a `userId` parameter on a shared-integration resolver is a visible, greppable smell.

### 2. GitHub installations are promoted by a GitHub *account* allowlist, keyed by the immutable account id

- **Decision:** a new `org_github_accounts` table records which GitHub accounts belong to the organization, keyed by GitHub's numeric `account.id` with the login stored alongside for display. An installation whose account id is on the list is org-owned; every other installation stays personal.
- **Why the account, not the installation:** an uninstall/reinstall cycle issues a *new* `installation_id`. A per-installation `is_org_shared` flag therefore silently un-shares the org's GitHub connection the first time someone reinstalls the App — the failure is invisible until a teammate's run fails with `no_installation`. The account is the durable identity of the relationship.
- **Why the numeric id, not the login:** GitHub organizations can be renamed, and the login is the rename-able field. Both `GET /user/installations` and the `installation` webhook already carry `account.id`; the current Zod schemas simply do not parse it. They will.
- **Alternative rejected:** infer org ownership from `accountType === "Organization"`. It would promote every GitHub org any member happens to belong to — including their unrelated side projects — which is exactly the silent widening `shared-config-governance` decision 4 forbids.

### 3. Installations on personal GitHub user accounts are never org-owned

- **Decision:** `accountType === "User"` rows stay personal, and the allowlist rejects a personal account id outright rather than accepting it and having no effect.
- **Rationale:** an App installation on someone's own GitHub account is that person's, and `sync.ts` already filters to the syncing user's own personal account. Making it promotable would let an admin grant the whole org access to a member's private repositories with one click, from a screen whose stated subject is "our GitHub organizations".

### 4. The backfill promotes nothing; promotion is what collapses duplicate rows

- **Decision:** the migration adds columns and leaves every existing row personal. Adding an account to the allowlist runs a promotion routine which, for each installation on that account, collapses the N per-user rows into one org-owned row — earliest `created_at` survives, its `user_id` becoming `installed_by_user_id` — and deletes the rest.
- **Rationale:** this honors `shared-config-governance` decision 4 ("marking none is the only default that cannot widen access") while replacing its mechanism. It also puts the duplicate-collapse where the information exists: at migration time nothing knows which GitHub accounts are ours; at allowlist time an admin has just said so.
- **Idempotence is required, not optional.** Promotion must be safe to re-run: preview deployments are forks that will replay it, and an admin will re-add an account after removing it. The routine is expressed as "ensure exactly one org-owned row per (organization, installation)", not "insert then delete".

### 5. `verifyRepoAccess` keeps its order, and step 1 is what makes step 2 safe to widen

- **Decision:** step 2 becomes `getOrgInstallationByAccountLogin(owner)` with no caller id. Steps 1 and 3 are untouched: the caller's own OAuth token must still see the repo at the required permission, and the installation token is still minted scoped to the single `repositoryId` (`withScopedInstallationOctokit`).
- **Rationale:** the effective access after this change is *repos this human can already see on GitHub, at the permission the action needs* ∩ *repos the org's installation covers*. Both operands are unchanged. What changes is that the second operand stops being accidentally per-user. A member who cannot see a repo on GitHub still gets `user_no_access` at step 1 and never reaches the installation.
- **This is the highest-consequence claim in the change, so it gets a pinning test**, not just a comment: a test asserting that a user without repo visibility is denied at step 1 even when an org-owned installation covering that repo exists, and a test asserting the write-permission branch still denies a read-only collaborator.

### 6. Sync becomes additive; authoritative removal comes from the App, never from a member's view

- **Decision:** `syncUserInstallations` stops calling `deleteInstallationsNotInList` for org-owned rows — it upserts only. Removal of an org-owned installation comes from the `installation.deleted` webhook, plus a reconciliation that lists installations via `getAppOctokit()` → `GET /app/installations`. Personal rows keep today's prune, scoped to their owner.
- **Rationale:** `GET /user/installations` returns what *that user* can see. Once one row serves the whole org, a member who leaves the GitHub org — or whose OAuth grant lapses — would, on their next sync, delete the org's installation for everyone. The App's own installation list is the only org-wide authoritative source, and it does not depend on any human's grant.
- **Alternative rejected:** keep the prune but restrict it to rows whose `installed_by_user_id` matches the syncing user. That still deletes a live org installation whenever the person who first synced it loses visibility.

### 7. Linear actors resolve by verified email *or* an explicit mapping, and never by fallback

- **Decision:** `linear_workspaces` gains `organization_id` (unique per org) and is resolved by organization. Actor resolution keeps the automatic path — match `actorEmail` to a user with `emailVerified` — and adds `linear_actor_links` (Linear user id → QuackOps user id, admin-managed) for the mismatched-address case. The membership check stays. There is no org-default actor.
- **Rationale:** the webhook has no cookie, so email matching is the only automatic signal available; requiring `emailVerified` closes the obvious spoof. But `accountLinking.allowDifferentEmails` is enabled, so a mismatch is an expected, ordinary state rather than a misconfiguration — it needs a deliberate resolution path, and an admin-curated mapping is one. A fallback identity is not: it would let anyone who can act in the connected Linear workspace start an agent run attributed to the org, which is precisely the property `resolve-actor.ts` was written to prevent.
- **Existing rows:** the backfill sets `organization_id` to the seeded org on the single existing workspace row, which is safe because the table is already documented as one-connection-per-deployment.

### 8. Vercel links are re-keyed to the repository; existing rows are dropped, not migrated

- **Decision:** `vercel_project_links` is keyed `(organization_id, repo_owner, repo_name)` with a NOT NULL organization and `user_id` as nullable provenance. There is no personal variant and no migration routine: the re-key migration deletes the existing rows.
- **Rationale:** an earlier draft carried a migration planner, a conflict table, a conflict-resolution admin surface and a dual read, all to rescue divergent per-user rows. That machinery is only worth its weight against real data that would otherwise be lost — and this deployment has one account and test data. Deleting the rows costs one re-link; keeping the machinery costs a permanent conflict concept in a model whose whole point is that there is one answer per repository.
- **What the key buys:** "one Vercel project per repository" stops being a rule someone has to remember and becomes something the database refuses to violate. The conflict case cannot arise because a second member linking the same repo updates the one row.
- **Alternative rejected:** backfilling the organization id at runtime from the seeder, the way the Linear connection was going to be claimed. It works, but it keeps a nullable column and a fallback read forever to serve rows that will not exist after the first deploy.

### 9. One deploy, because nothing here needs to survive a rollout window

- **Decision:** ship it in one deploy. The additive columns land, the Vercel table is re-keyed, and the resolvers read the new shape immediately.
- **Rationale:** the three-deploy expand/switch/contract plan existed to protect data across a rolling release. With one account and disposable data, the window it protects is worth less than the machinery it requires — and that machinery (dual reads, a migration routine, a conflict table, a contract-readiness gate) was most of the change's surface area.
- **What survived, and why it is not migration machinery:** `verifyRepoAccess` keeps its org-then-personal fallback permanently. An installation on someone's own GitHub account is never promotable, so personal records are a standing category, not a backlog. An earlier draft listed that fallback for removal in the contract step, which was simply wrong.

## Risks / Trade-offs

- **Widening access by accident is the whole risk of this change.** → Step 1 of `verifyRepoAccess` is untouched and pinned by tests (decision 5); promotion is explicit and account-scoped (decisions 2–4); personal GitHub accounts are non-promotable (decision 3).
- **An admin adds the wrong GitHub account to the allowlist.** → Promotion is reversible: demotion re-personalizes the installation to its `installed_by_user_id` and drops the org row. This is a real, expected operation, not an emergency path, so it ships with the allowlist rather than after it. Note it does not un-see what was seen in the interim; the allowlist screen says so.
- **Preview deployments fork the allowlist along with everything else**, so a preview resolves org-owned installations pointing at real GitHub installations. → This is not new exposure: the installation rows were already forked and already resolvable. What is new is that a preview's approved members resolve them uniformly, which is bounded by the unchanged step-1 check. The durable fix is per-preview secret and data isolation, which belongs to whichever workstream owns it.
- **The `install.deleted` webhook can be missed** (delivery failure, App reconfiguration), leaving a stale org-owned row that resolves to an installation GitHub no longer has. → Token minting fails and the action surfaces the existing `app_no_access` message; the `GET /app/installations` reconciliation converges the row on its next run.
- **The Vercel re-key deletes existing links.** → Accepted, not mitigated: this deployment has one account and test data, and re-linking a repo restores it in a click. The migration says so in a comment rather than doing it quietly. On a deployment with links worth keeping, this would need the migration routine that was removed instead.
- **`shared-config-governance` is proposed but unimplemented, and its task 2.1 conflicts with this design.** → Reconciliation below; this is the one item that needs a human decision before implementation starts.

## Migration Plan

One deploy. Migration `0043` adds the ownership columns and the new tables; `0044` re-keys `vercel_project_links` to the repository, deletes its existing rows (see Risks), and drops the conflict table. The resolvers read the new shape immediately.

**Rollback:** redeploying the previous build restores the previous code, but `0044` is not reversible — the deleted Vercel links are gone and are re-created by linking a repo again.

## Reconciliation with `shared-config-governance`

That change is proposed and unimplemented (0 of 26 tasks). Its task 2.1 adds `organization_id` + `is_org_shared` to `github_installations` and leaves every row personal; its decision 4 explains why. This design keeps that principle and replaces the mechanism, because a boolean on a per-user row does not survive a reinstall (decision 2) and does not resolve the duplicate-row problem at all.

The split, now applied to that change's artifacts:

- **This change owns ownership**: the schema, promotion, resolution, and sync behavior for org-owned integrations.
- **`shared-config-governance` keeps gating, audit, soft delete, restore, purge, and the webhook-secret consolidation.** Its task 2.1 is dropped and its design decision 4 amended to point at decision 2 above; its task 2.3 ("gate org-shared installation removal") now reads `organization_id IS NOT NULL`. Note the *account-level* release path already exists and is gated (`releaseGitHubAccount`); what that change still owes is the per-installation removal route.
- **Order:** either may land first. If `shared-config-governance` lands first, task 2.1 must still be dropped or this change inherits a column it does not use. If this change lands first, its promotion and demotion actions are ungated until gating arrives — so they are guarded with `requirePermission({ integration: ["connect", "disconnect"] })` here, using statements `org-roles-and-settings` already defines, and the audit write is added by `shared-config-governance` when it lands.

## Open Questions

1. **Which GitHub accounts go on the allowlist on day one.** A data decision for an operator, not a design decision — the design defaults to none, and getting it wrong is reversible per the demotion path.
2. **Whether the Linear actor mapping needs a self-service request flow** (a member claims their own Linear identity, an admin confirms) or stays admin-entry-only. Admin-entry-only is assumed; adding a request flow later changes no requirement here.
