# AGENTS.md

This file provides guidance for AI coding agents working in this repository.

**This is a living document.** When you make a mistake or learn something new about this codebase, add it to [Lessons Learned](docs/agents/lessons-learned.md).

## Quick Links

- [Architecture & Workspace Structure](docs/agents/architecture.md)
- [Code Style & Patterns](docs/agents/code-style.md)
- [Lessons Learned](docs/agents/lessons-learned.md)

## Authentication

Authentication uses [Better Auth](https://www.better-auth.com/) with Vercel OAuth (sign-in) and GitHub OAuth (repo access). Config lives in `apps/web/lib/auth/config.ts`. Sessions are managed by better-auth's built-in session system — there is no manual JWE/encryption layer.

Key env vars: `BETTER_AUTH_SECRET` (session signing), `NEXT_PUBLIC_VERCEL_APP_CLIENT_ID` + `VERCEL_APP_CLIENT_SECRET` (Vercel OAuth), plus GitHub App credentials for repo access. See `apps/web/.env.example` for the full list.

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
bun run test:isolated                                 # Run all tests (one process per file) -- this is what CI runs
bun test path/to/file.test.ts                         # Run single test file
bun test --watch path/to/file.test.ts                 # Watch mode for a single test file
bun run test:verbose path/to/file.test.ts             # Single file with JUnit reporter on stdout (useful in non-interactive shells)
```

**Never run bare `bun test` (or `bun run test:verbose`) across the whole suite.** Bun runs every
file in one process, and `mock.module()` registrations leak across files -- a partial mock
installed by one test replaces the real module for every file loaded afterwards, producing
hundreds of bogus failures like `SyntaxError: Export named 'x' not found in module '...'`.

Tests in this repo lean heavily on `mock.module()`, so they are only valid in isolation.
`bun run test:isolated` (`scripts/test-isolated.ts`) spawns a separate `bun test` process per
file, which is why it is the command wired into `bun run ci` and `.github/workflows/ci.yml`.
Passing an explicit file path to `bun test` is fine -- that is already a single-file process.

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
```

See [Architecture & Workspace Structure](docs/agents/architecture.md) for details.

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
