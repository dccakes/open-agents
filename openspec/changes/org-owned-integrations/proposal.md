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
- **Vercel:** repo→project links become org-scoped (`organization_id, repo_owner, repo_name`), with an org-level Vercel team recorded as the org's tie-in. The per-user Vercel OAuth token remains the credential used to *perform* the call. Migration collapses divergent per-user links deterministically and records every discarded mapping rather than dropping it silently.
- Sign-in stays personal. Vercel OAuth and GitHub OAuth remain per-user identity providers; this change does not touch how anyone authenticates.

## Capabilities

### New Capabilities

- `org-owned-github-installations`: GitHub App installations are owned by the organization, resolved without a caller id, admitted via an admin-declared GitHub account allowlist, and never pruned by one member's sync.
- `org-scoped-linear-connection`: the Linear workspace connection is scoped to the organization, and Linear actors resolve to org members through an explicit identity mapping rather than an email-string coincidence.
- `org-scoped-vercel-project-links`: repo→Vercel-project mappings belong to the organization, with a recorded org Vercel team and a deterministic, audited collapse of today's per-user duplicates.

### Modified Capabilities

- `integration-admin-gating`: the org-shared/personal distinction becomes a property of *ownership* (org-owned installation rows admitted by an account allowlist) rather than an `is_org_shared` flag on a per-user row. The permission gates themselves are unchanged; the thing being gated gains a real owner. This capability is defined by the sibling change `shared-config-governance` and has not been archived into `openspec/specs/`, so no delta file is authored against it — the amendment is a coordination item, settled in `design.md` under "Reconciliation with `shared-config-governance`" and to be applied to that change's own spec.

## Impact

- **Depends on**: `org-roles-and-settings` (landed) for `requirePermission()`, the `integration` statements, and `getSeededOrganizationId()`.
- **Overlaps with**: `shared-config-governance`, which is proposed and unimplemented (0 of 26 tasks). Its task 2.1 (`organization_id` + `is_org_shared` on `github_installations`, all rows personal) and design decision 4 are superseded by this change's ownership model. Sequencing and the reconciliation are settled in `design.md`; this is the one open coordination item for review.
- **Database**: `github_installations` re-keyed to `(organization_id, installation_id)` with `installed_by_user_id` provenance; new `org_github_accounts` allowlist table; `organization_id` on `linear_workspaces`; new `linear_actor_links` table; `vercel_project_links` re-keyed to `(organization_id, repo_owner, repo_name)` with `linked_by_user_id`. Drizzle migrations for each, plus backfills.
- **Code**: `lib/db/installations.ts`, `lib/github/access.ts`, `lib/github/sync.ts`, `app/api/github/webhook/route.ts`, `lib/db/linear-workspaces.ts`, `lib/linear/resolve-actor.ts`, `lib/db/vercel-project-links.ts`, and the six `/api/github/*` routes that read installations by user.
- **UI**: admin surfaces for the GitHub account allowlist and the Linear actor mapping; connection screens show org-owned connections to every approved member instead of only to whoever synced them.
- **Non-goals**: session sharing between members (`sessions.user_id` stays personal — Phase 2's scope model), per-resource ACLs, and multi-org support. Sandbox provider credentials are `sandbox-credential-protection`'s subject, not this change's.
