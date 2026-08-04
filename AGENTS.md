# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)
- [Policy and Postures](docs/policy-and-postures.md) · [Security](SECURITY.md)

## Authentication

Authentication uses [Better Auth](https://www.better-auth.com/) with Vercel OAuth (sign-in) and GitHub OAuth (repo access). Config lives in `apps/web/lib/auth/config.ts`. Sessions are managed by better-auth's built-in session system — there is no manual JWE/encryption layer.

Key env vars: `BETTER_AUTH_SECRET` (session signing), `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` + `VERCEL_APP_CLIENT_SECRET` (Vercel OAuth), plus GitHub App credentials for repo access. See `apps/web/.env.example` for the full list.

### Membership, roles, and permissions

Better Auth's **organization** and **admin** plugins are enabled (single seeded org; teams and dynamic access control off). Two role concepts, deliberately distinct:

- **`users.role`** (admin plugin) — the *platform* role, for instance-level operations that are not org-scoped: bulk OAuth token revocation, ban, impersonation, session revocation.
- **`org_members.role`** (organization plugin) — the *org* role (`owner | admin | member`), governing shared configuration.

**`pending` is the absence of an `org_members` row, not a role value** — that fails closed, whereas a "pending" role would appear as a member-with-no-permissions and fail open. `getServerSession()` returns `undefined` for a pending user, so every route's no-session branch already denies them; `getSessionWithMembership()` is the narrow escape hatch for the approval screen and auth info. Paths without a cookie (the Linear webhook resolves a user by actor email) need their own explicit membership check.

Permissions live in `apps/web/lib/auth/permissions.ts` as one `createAccessControl` statement set that **spreads both plugins' `defaultStatements`** before adding QuackOps resources. This is load-bearing: the org plugin's built-in `removeMember`/`updateMemberRole` authorize `member.delete`/`member.update` against the roles you supply, so a custom-only set denies them even for owners. Check permissions with `requirePermission()`; check membership with `requireApprovedMember()`. Client-side `checkRolePermission` is for hiding affordances only — never the sole enforcement.

Do **not** enable session cookie caching while permission checks resolve from the session; a cached session serves a stale role after demotion. A test pins this.

`ADMIN_EMAILS` is `required-prod`, so a production deploy fails at build time unless it is set — set it in the Vercel project environment before deploying. Both it and `ALLOWED_EMAIL_DOMAINS` require a *verified* email to match, and an unset allowlist auto-approves nobody.

### Integration ownership

Shared integrations belong to the **organization**; OAuth identities stay **personal** and only authorize the human. Concretely: a resolver for a shared resource takes no `userId`. If you find yourself adding one, that is a scoping bug in waiting — it is exactly what made GitHub installations per-person.

Ownership is discriminated by a nullable `organizationId` column: non-NULL means the organization owns the row, NULL means it is personal. On an org-owned row the `userId` is **provenance** (who set it up), never authority.

- **GitHub.** `github_installations` rows become org-owned only when an admin claims the GitHub account in `/settings/admin/integrations`. The allowlist (`org_github_accounts`) is keyed by GitHub's immutable numeric `account.id` — not the login (rename-able) and not the installation id (a reinstall issues a new one). Resolve with `getOrgInstallationByAccountLogin()`; list with `getVisibleInstallations()`.
- **Authorization did not move.** `verifyRepoAccess` step 1 checks the *caller's own* GitHub credentials and is the authorization; step 2 resolves the installation and is not. That order is why org ownership widens nothing, and `lib/github/access.test.ts` pins it. Do not reorder those steps or let step 2's result satisfy step 1.
- **Never prune org-owned rows from one user's view.** `GET /user/installations` answers "what can this user see". Removal comes from the `installation.deleted` webhook or `reconcileOrgInstallations()` (authenticated as the App). `deleteInstallationsNotInList` is scoped to `organization_id IS NULL` for this reason.
- **Linear.** The connection is resolved by organization. Actors resolve by *verified* email or an admin-recorded `linear_actor_links` mapping — never a fallback identity.
- **Vercel.** Repo→project links are org-scoped, but the migration only promotes repos whose members already agree; disagreements land in `vercel_project_link_conflicts` for a person to settle. Vercel API calls still use the acting member's own OAuth token.

## Configuration

**Never read `process.env` outside a config module.** `bun run ci` fails if you do (`scripts/check-env-boundary.ts`).

- Web app: declare the variable in `apps/web/lib/config/<concern>.ts` and read it through that module's accessor.
- Packages: declare it in `packages/<name>/config.ts`; the rest of the package takes explicit options.

Each variable declares a schema, a one-line description, and an environment axis (`required-prod` / `optional` / `dev-only`), plus `requiredWith` when it is only required once a related integration is configured. `validateServerConfig()` enforces the axes on production deployments — at server start (`instrumentation.ts`) and during `build` (`apps/web/scripts/check-env.ts`).

After adding or changing a variable, regenerate the example file and commit it:

```bash
bun run --cwd apps/web env:example   # rewrites apps/web/.env.example from the schemas
```

`NEXT_PUBLIC_*` variables live in `lib/config/public.ts` and must be written as literal `process.env.NEXT_PUBLIC_X` reads there — that is the only form Next.js inlines into client bundles.

## Database & Migrations

Schema lives in `apps/web/lib/db/schema.ts`. Migrations are managed by Drizzle Kit.

**After modifying `schema.ts`, always generate a migration:**

```bash
bun run --cwd apps/web db:generate   # Creates a new .sql migration file
```

Commit the generated `.sql` file alongside the schema change. **Do not use `db:push`** except for local throwaway databases.

Migrations run automatically during `bun run build` (via `lib/db/migrate.ts`), so every Vercel deploy — both preview and production — applies pending migrations to its own database.

### Environment isolation

Neon database branching is enabled in the Vercel project settings. Every preview deployment automatically gets its own isolated database branch forked from production. This means preview deployments never read or write production data. Production deployments use the main Neon database.

## Commands

```bash
# Development
bun run web            # Run web app

# Quality checks (REQUIRED after making any changes)
bun run ci                                 # Required: run format check, lint, typecheck, and tests
turbo typecheck                            # Type check all packages

# Linting and formatting (Ultracite - oxlint + oxfmt, run from root)
bun run check                              # Lint and format check all files
bun run fix                                # Lint fix and format all files

# Filter by package (use --filter)
turbo typecheck --filter=web # Type check web app only

# Testing
bun test                                              # Run all tests
bun test path/to/file.test.ts                         # Run single test file
bun test --watch                                      # Watch mode
bun run test:verbose                                  # Run tests with JUnit reporter streamed to stdout (useful in non-interactive shells)
bun run test:verbose path/to/file.test.ts             # Same verbose output for a single test file
```

**CI/script execution rules:**

- Run project checks through package scripts (for example `bun run ci`, `bun run --cwd apps/web db:check`).
- Prefer `bun run <script>` over invoking tool binaries directly (`bunx`, `bun x`, `tsc`, `eslint`, etc.) so local runs match CI behavior.

## Git Commands

- **Branch sync preference:** When bringing in `origin/main`, prefer a normal merge (`git fetch origin main` then `git merge origin/main`) instead of rebasing, unless explicitly requested otherwise.

**Quote paths with special characters**: File paths containing brackets (like Next.js dynamic routes `[id]`, `[slug]`) are interpreted as glob patterns by zsh. Always quote these paths in git commands:

```bash
# Wrong - zsh interprets [id] as a glob pattern
git add apps/web/app/tasks/[id]/page.tsx
# Error: no matches found: apps/web/app/tasks/[id]/page.tsx

# Correct - quote the path
git add "apps/web/app/tasks/[id]/page.tsx"
```

## Architecture (Summary)

```
Web -> Agent (packages/agent) -> Sandbox (packages/sandbox)
                 ^
                 └─ Command policy (packages/agent/policy + apps/web/lib/policy)
```

See [Architecture & Workspace Structure](docs/agents/architecture.md) for details.

### Command policy and postures

Every side-effecting tool call is evaluated against a `CommandPolicy` under the
session's posture before it runs. Full reference:
[Policy and Postures](docs/policy-and-postures.md).

- **Enforcement lives in the tool factories** (`packages/agent/tools/policy-enforcement.ts`),
  not in a wrapper around the agent loop — three of the four `ToolLoopAgent`s
  build their own tools. `needsApproval` can only pause; `execute` is
  authoritative and re-evaluates the policy before any side effect. A refusal is
  a structured tool result, never a thrown error.
- **Precedence is deny → ask → allow**, first match within a class, most
  restrictive segment of a compound command wins, posture applied last.
- **Three postures** on `sessions.posture`: `strict`, `auto` (default),
  `dangerous`. `dangerous` collapses `ask` → `allow`, never `deny`, requires the
  `posture: ["setDangerous"]` permission, and is refused for non-interactive
  triggers.
- **Fail closed.** A side-effecting tool with no policy on `experimental_context`
  refuses; `read`/`grep`/`glob` proceed. Add a tool that can mutate state or
  reach the network, and wire policy into it in the same PR.
- **Approvals are server-side records** (`approval` table), single-use and
  expiring — the approval state in a client-supplied message body is an
  assertion, not authorization. Every `ask`/`deny` is written to the append-only
  `policy_event`.
- **Runs are budgeted** (tokens, steps, org daily tokens); a breach halts in a
  distinct `budget-exceeded` state.
- **Changing the shipped baseline requires corpus entries.**
  `packages/agent/policy/golden-corpus.ts` must cover every rule id, and a new
  rule needs both the commands it should catch and a near-miss it must not.
- Workflow modules must not statically import `@open-agents/agent`,
  `@/lib/org/settings`, `@/lib/auth/require-permission`, or `next/headers` —
  `workflow-import-boundary.test.ts` enforces this.

[`SECURITY.md`](SECURITY.md) states plainly what this system does not protect
against. Read it before describing the agent as sandboxed or contained.

## File Organization & Separation of Concerns

- Do **not** append new functionality to the bottom of an existing file by default.
- Before adding code, decide whether the behavior is a separate concern that should live in its own file.
- Prefer creating a new colocated file for distinct concerns (components, hooks, utilities, schemas, data-access helpers, etc.).
- If a file is already large or handling multiple responsibilities, extract the new logic (and related helpers/types) into focused modules and import them.
- For large page/view/client components, default to adding new feature behavior in colocated hooks and colocated child components instead of growing the main file.
- If a change introduces a distinct cluster of state, effects, handlers, API calls, or derived UI labels for one feature, treat that as a strong signal to extract it.
- Keep each file focused on one primary responsibility; avoid mixing unrelated UI, business logic, and data-access code in the same file.

## Code Style (Summary)

- **Bun exclusively** (not Node/npm/pnpm)
- **Files**: kebab-case, **Types**: PascalCase, **Functions**: camelCase
- **Never use `any`** -- use `unknown` and narrow with type guards
- **No `.js` extensions** in imports
- **Ultracite** (oxlint + oxfmt) for linting and formatting (double quotes, 2-space indent)
- **Zod** schemas for validation, derive types with `z.infer`

See [Code Style & Patterns](docs/agents/code-style.md) for full conventions, tool implementation patterns, and dependency patterns.
