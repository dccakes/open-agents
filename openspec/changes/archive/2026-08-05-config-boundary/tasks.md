## 1. Config boundary core

- [x] 1.1 `apps/web/lib/config/env-source.ts` — the single raw environment reader
- [x] 1.2 `apps/web/lib/config/env-group.ts` — `defineEnvGroup()`, axis types, lazy per-group Zod parse with errors that name the variable
- [x] 1.3 `apps/web/lib/config/schemas.ts` — shared permissive value schemas
- [x] 1.4 `apps/web/lib/config/registry.ts` — every group in one list, flattened catalog

## 2. Concern modules

- [x] 2.1 `public.ts` — `NEXT_PUBLIC_*` via literal reads so Next.js still inlines them into client bundles
- [x] 2.2 `deployment.ts` — `NODE_ENV`, `VERCEL_ENV`, URLs, resource profile, BotID hosts
- [x] 2.3 `auth.ts`, `db.ts`, `github.ts`, `linear.ts`, `redis.ts`, `sandbox.ts`

## 3. Call-site migration (behavior identical)

- [x] 3.1 Database and Redis — `lib/db/client.ts`, `lib/redis.ts`, `lib/rate-limit.ts`
- [x] 3.2 Auth — `lib/auth/config.ts`, `lib/auth/actions.ts`, `lib/admin/actions.ts`, `lib/linear/token.ts`
- [x] 3.3 GitHub — `lib/github/{app,urls,pr-content}.ts`, `lib/github/actions/*`, install and webhook routes
- [x] 3.4 Linear — connect, callback, webhook routes, `lib/linear/webhook.ts`
- [x] 3.5 Sandbox — config, timeout override, env resolvers, DB provisioners, provider settings
- [x] 3.6 Deployment surface — `app/layout.tsx`, `lib/botid*.ts`, `lib/deployment/resource-profile.ts`, `lib/managed-template-trial.ts`, client components

## 4. packages/sandbox

- [x] 4.1 `packages/sandbox/config.ts` maps env to provider options
- [x] 4.2 Docker and Daytona providers take explicit config, defaulting to that module
- [x] 4.3 Export the config helpers from the package index

## 5. Enforcement and documentation

- [x] 5.1 `scripts/check-env-boundary.ts` with a narrow allowlist, wired into `bun run ci`
- [x] 5.2 `apps/web/instrumentation.ts` validates at server start
- [x] 5.3 `apps/web/scripts/check-env.ts` validates during `build` (instrumentation does not run during `next build`)
- [x] 5.4 Generated `apps/web/.env.example` plus `env:example` script
- [x] 5.5 Tests: `lib/config/validate.test.ts`, `lib/config/env-example.test.ts`
- [x] 5.6 `bun run ci` green; `next build` verified with dummy env
