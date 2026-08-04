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

### 8. Vercel links auto-migrate only where members already agree; conflicts are surfaced, not resolved by guess

- **Decision:** re-key `vercel_project_links` to `(organization_id, repo_owner, repo_name)` with `linked_by_user_id` provenance. For each repo where all per-user rows name the same `project_id`, migrate to one org row. Where they disagree, migrate **nothing** for that repo, retain the per-user rows, and record the conflict for an admin to resolve on a settings screen.
- **Rationale:** a Vercel project link determines where a deployment lands. "Most recently updated wins" is a defensible rule for a preference and an indefensible one for a deploy target — the failure mode is a member's work being deployed to the wrong project with no signal that a choice was ever made. Leaving a conflicted repo unmapped degrades to today's behavior for that repo while an admin decides.
- **Consequence:** the code path must tolerate a repo having org rows, per-user rows, or neither, for the duration of the resolution window. Reads prefer the org row and fall back to the caller's personal row; that fallback is removed in the contract step (decision 9) once conflicts are drained.

### 9. Expand-contract, because previews and production run the same migrations against different code

- **Decision:** three deploys. **Expand** — add columns and tables, backfill, keep every existing resolver working and dual-read (org row first, per-user row second). **Switch** — resolution reads org-owned rows only; promotion and allowlist UI ship; admins promote accounts and drain Vercel conflicts. **Contract** — drop the per-user fallbacks and the now-unused columns/indexes.
- **Rationale:** migrations run during `bun run build` on every deploy, so there is always a window where the previous build's code is serving against the new schema. A single add-and-drop migration breaks that window — the same reasoning `org-roles-and-settings` applied to `users.isAdmin`.
- **Rollback:** expand and switch are both revertible by deploying the previous build, because expand only adds and switch only changes reads. Contract is the one-way door, and it is gated on an operator confirming no rows remain in the conflict table.

## Risks / Trade-offs

- **Widening access by accident is the whole risk of this change.** → Step 1 of `verifyRepoAccess` is untouched and pinned by tests (decision 5); promotion is explicit and account-scoped (decisions 2–4); personal GitHub accounts are non-promotable (decision 3).
- **An admin adds the wrong GitHub account to the allowlist.** → Promotion is reversible: demotion re-personalizes the installation to its `installed_by_user_id` and drops the org row. This is a real, expected operation, not an emergency path, so it ships with the allowlist rather than after it. Note it does not un-see what was seen in the interim; the allowlist screen says so.
- **Preview deployments fork the allowlist along with everything else**, so a preview resolves org-owned installations pointing at real GitHub installations. → This is not new exposure: the installation rows were already forked and already resolvable. What is new is that a preview's approved members resolve them uniformly, which is bounded by the unchanged step-1 check. The durable fix is per-preview secret and data isolation, which belongs to whichever workstream owns it.
- **The `install.deleted` webhook can be missed** (delivery failure, App reconfiguration), leaving a stale org-owned row that resolves to an installation GitHub no longer has. → Token minting fails and the action surfaces the existing `app_no_access` message; the `GET /app/installations` reconciliation converges the row on its next run.
- **Vercel conflicts may never be drained**, stranding the contract step. → The conflict table is small and enumerable; the contract step is explicitly gated on it being empty, so the failure mode is "step 3 waits", not "step 3 corrupts".
- **`shared-config-governance` is proposed but unimplemented, and its task 2.1 conflicts with this design.** → Reconciliation below; this is the one item that needs a human decision before implementation starts.

## Migration Plan

1. **Expand** — add `organization_id` + `installed_by_user_id` to `github_installations` with partial unique indexes for the two ownership modes; add `org_github_accounts`; add `organization_id` to `linear_workspaces` and backfill the seeded org; add `linear_actor_links`; add `organization_id` + `linked_by_user_id` to `vercel_project_links`; add the Vercel conflict table. Parse `account.id` in the sync and webhook schemas and start persisting it. All resolvers dual-read.
2. **Switch** — org-scoped resolvers become the only path for org-owned resources; sync goes additive; the App-authenticated reconciliation lands; allowlist and Linear-actor-mapping admin surfaces ship; the non-conflicting Vercel links migrate and conflicts are written to the conflict table.
3. **Contract** — after admins have promoted their accounts and drained conflicts, drop the per-user fallback reads, the old unique indexes, and any column left unused.

**Rollback:** revert to the previous deploy at steps 1 or 2; both are additive with respect to reads. Step 3 requires a forward fix.

## Reconciliation with `shared-config-governance`

That change is proposed and unimplemented (0 of 26 tasks). Its task 2.1 adds `organization_id` + `is_org_shared` to `github_installations` and leaves every row personal; its decision 4 explains why. This design keeps that principle and replaces the mechanism, because a boolean on a per-user row does not survive a reinstall (decision 2) and does not resolve the duplicate-row problem at all.

Recommended split, to be confirmed in review:

- **This change owns ownership**: the schema, promotion, resolution, and sync behavior for org-owned integrations.
- **`shared-config-governance` keeps gating, audit, soft delete, restore, purge, and the webhook-secret consolidation.** Its task 2.1 is dropped; its task 2.3 ("gate org-shared installation removal") consumes `organization_id IS NOT NULL` from here instead of `is_org_shared`, and its design decision 4 is amended to point at decision 2 above.
- **Order:** either may land first. If `shared-config-governance` lands first, task 2.1 must still be dropped or this change inherits a column it does not use. If this change lands first, its promotion and demotion actions are ungated until gating arrives — so they are guarded with `requirePermission({ integration: ["connect", "disconnect"] })` here, using statements `org-roles-and-settings` already defines, and the audit write is added by `shared-config-governance` when it lands.

## Open Questions

1. **Which GitHub accounts go on the allowlist on day one.** A data decision for an operator, not a design decision — the design defaults to none, and getting it wrong is reversible per the demotion path.
2. **Whether the Linear actor mapping needs a self-service request flow** (a member claims their own Linear identity, an admin confirms) or stays admin-entry-only. Admin-entry-only is assumed; adding a request flow later changes no requirement here.
