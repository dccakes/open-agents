## Why

QuackOps now has an organization — `org-roles-and-settings` landed the seeded org, membership gate, roles, and permission model — but none of the integrations it exists to govern actually belong to it. Every external connection is keyed by a *person*:

- **GitHub.** `github_installations` is keyed `(user_id, installation_id)`, so one GitHub App installation on a shared GitHub organization produces N rows, one per teammate who happened to sync it. `verifyRepoAccess` resolves the installation with `getInstallationByAccountLogin(userId, owner)` — a lookup keyed by the caller. An approved org member who has not personally synced gets `no_installation` and cannot start a sandbox, commit, or open a PR against a repo the org demonstrably has access to.
- **Linear.** `linear_workspaces` is a deployment singleton with an `installed_by_user_id` and no `organization_id`; `getLinearWorkspace()` returns whichever row is oldest. Actor resolution matches the Linear actor's email string against `users.email`, so a teammate whose Linear address differs from their Vercel sign-in address cannot delegate an issue at all.
- **Vercel.** `vercel_project_links` has primary key `(user_id, repo_owner, repo_name)`. A repo→project mapping is a fact about the repo, not about the person who recorded it, yet each teammate maintains their own copy and they can silently disagree.

The organization is what holds the relationship with GitHub, Linear, and Vercel. The person is only the human proving they may act. Today those two ideas are the same database column, and the cost is a team where each member sees a different subset of the org's own tools.

`shared-config-governance` gates *who may change* these integrations. It does not change *how they are found and used*, which is the defect above. This change supplies the ownership model that gating assumes.

## What Changes

- Establish one convention across shared integrations: the **connection** is org-owned; the **identity** is personal and is used only to authorize the actor, never to locate the resource. Resolution helpers for shared integrations stop taking a `userId`.
- **BREAKING (internal):** `github_installations` becomes org-owned — one row per `installation_id` scoped to `organization_id`, with the installing user demoted from owner to provenance (`installed_by_user_id`). `getInstallationByAccountLogin(userId, owner)` is replaced by an org-scoped resolver. No route signature changes; the change is to who can resolve what.
- Authorization for repo actions is unchanged in substance and stays ordered as it is today: `verifyRepoAccess` first proves the *caller's own* GitHub token can see the repo at the required permission, and only then resolves the installation. Making step 2 org-scoped widens nothing beyond "repos this human can already see on GitHub ∩ repos the org's installation covers".
- Replace per-installation sharing toggles with an **org GitHub account allowlist**: an admin declares which GitHub organizations are ours, and installations on those accounts are org-owned on arrival — current and future. Installations on personal GitHub *user* accounts stay personal, always.
- **Fix a destructive sync:** `syncUserInstallations` currently calls `deleteInstallationsNotInList(userId, ...)`. Once rows are org-owned, one member's narrower view of `GET /user/installations` would delete the org's installations for everyone. Sync becomes additive; removal comes only from the GitHub App `installation.deleted` webhook, which is the authoritative signal.
- **Linear:** add `organization_id` to `linear_workspaces` (unique per org) and resolve the connection by organization rather than by row age. Replace email-string actor matching with an explicit, admin-managed `linear_actor_links` mapping (Linear user id → QuackOps user id), with verified-email matching retained as the automatic path. Unmatched actors are still refused — no fallback identity.
- **Vercel:** repo→project links are re-keyed to `(organization_id, repo_owner, repo_name)` — no personal variant, so the resolver takes no caller id and two members cannot disagree. An org-level Vercel team is recorded as the org's tie-in. The per-user Vercel OAuth token remains the credential used to *perform* the call. **Existing links are dropped rather than migrated** (see Impact).
- Sign-in stays personal. Vercel OAuth and GitHub OAuth remain per-user identity providers; this change does not touch how anyone authenticates.

## Capabilities

### New Capabilities

- `org-owned-github-installations`: GitHub App installations are owned by the organization, resolved without a caller id, admitted via an admin-declared GitHub account allowlist, and never pruned by one member's sync.
- `org-scoped-linear-connection`: the Linear workspace connection is scoped to the organization, and Linear actors resolve to org members through an explicit identity mapping rather than an email-string coincidence.
- `org-scoped-vercel-project-links`: repo→Vercel-project mappings belong to the organization and are keyed by the repository, with a recorded org Vercel team.

### Modified Capabilities

- `integration-admin-gating`: the org-shared/personal distinction becomes a property of *ownership* (org-owned installation rows admitted by an account allowlist) rather than an `is_org_shared` flag on a per-user row. The permission gates themselves are unchanged; the thing being gated gains a real owner. This capability is defined by the sibling change `shared-config-governance` and has not been archived into `openspec/specs/`, so no delta file is authored against it. Its spec requirement is mechanism-agnostic — it says "distinguish organization-shared installations from personal ones", which this change satisfies — so only that change's `tasks.md`, `design.md` and `proposal.md` needed amending, and they have been.

## Impact

- **Depends on**: `org-roles-and-settings` (landed) for `requirePermission()`, the `integration` statements, and `getSeededOrganizationId()`.
- **Reconciled with**: `shared-config-governance` (proposed, unimplemented). Its task 2.1 is **dropped** and design decision 4 **amended** in that change, so ownership comes from here and gating stays there. Task 2.3's "org-shared" now reads `organization_id IS NOT NULL`. Applied, not merely proposed — see that change's `tasks.md` and `design.md`.
- **Database**: `organization_id` + `account_id` on `github_installations` with a partial unique index; new `org_github_accounts` allowlist table; `organization_id` on `linear_workspaces`; new `linear_actor_links` table; `vercel_project_links` re-keyed to `(organization_id, repo_owner, repo_name)`. **The Vercel re-key deletes existing rows** — they all carry a NULL organization and static SQL cannot know the seeded org's id. Sanctioned: this deployment has one account and test data, and a link is re-created by linking a repo again.
- **Code**: `lib/db/installations.ts`, `lib/github/access.ts`, `lib/github/sync.ts`, `app/api/github/webhook/route.ts`, `lib/db/linear-workspaces.ts`, `lib/linear/resolve-actor.ts`, `lib/db/vercel-project-links.ts`, and the six `/api/github/*` routes that read installations by user.
- **UI**: admin surfaces for the GitHub account allowlist and the Linear actor mapping; connection screens show org-owned connections to every approved member instead of only to whoever synced them.
- **Non-goals**: session sharing between members (`sessions.user_id` stays personal — Phase 2's scope model), per-resource ACLs, and multi-org support. Sandbox provider credentials are `sandbox-credential-protection`'s subject, not this change's.
