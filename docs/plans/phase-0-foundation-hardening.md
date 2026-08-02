# Phase 0 — Foundation Hardening: Execution Plan

Detailed, self-contained work plan for programming agents. Parent context:
[QM Learnings → QuackOps Roadmap](./qm-learnings-roadmap.md), Phase 0.

Each workstream below is independently executable and should land as its own PR.
Workstreams are ordered by suggested execution, but only WS-0.4's postgres step depends on
anything else (nothing). All can run in parallel.

## Status

| Workstream | State |
| --- | --- |
| WS-0.2a Bun version bump | ✅ Done — see [sub-plan](./ws-0.2a-bun-version-bump.md). Bun `1.2.14` → `1.3.14`; soaking before WS-0.2b. |
| WS-0.2b bunfig cooldown | ⬜ Not started — blocked on WS-0.2a soak |
| WS-0.3 knip | ⬜ Not started |
| WS-0.4 CI hardening | ⬜ Not started |
| WS-0.1 config boundary | ⬜ Not started |
| WS-0.5 SECURITY.md | ⬜ Not started |

## Ground rules for executing agents

- Follow `AGENTS.md` / `docs/agents/*` conventions: Bun only, kebab-case files, no `any`,
  Zod for validation, new concerns in new colocated files.
- After any change: `bun run ci` must pass. After schema changes:
  `bun run --cwd apps/web db:generate` and commit the migration.
- Substantial changes should go through the repo's OpenSpec process (`openspec/changes/`)
  — WS-0.1 and WS-0.4 qualify; the rest are small enough to skip.
- Record any surprises in `docs/agents/lessons-learned.md`.

---

## WS-0.1 — Config boundary: single validated env module per package

**Problem.** `process.env` is read in 261 places across 53 files (auth config alone has 12).
There is no single place to see what env vars exist, no startup validation, and typos fail
silently at runtime. QM enforces one `config.ts` boundary with a lint ban elsewhere.

**Target state.**
- `apps/web/lib/config/` — a Zod-validated config module, split by concern
  (e.g. `auth.ts`, `github.ts`, `linear.ts`, `sandbox.ts`, `db.ts`, `observability.ts`),
  each exporting a parsed, typed object. Lazy-parse per group (Next.js edge/runtime splits
  make one eager root parse impractical) but validate the full server group in
  `instrumentation.ts` at boot so missing vars fail deploys, not requests.
- `packages/sandbox`: providers stop reading `process.env` directly; provider factories
  take explicit options, and a single `packages/sandbox/config.ts` maps env → options for
  callers that want env-driven defaults.
- `packages/agent`: already env-light; route the few reads through one module.

**Enforcement.** Ultracite/oxlint may not support `no-restricted-syntax`; do not block on
it. Add `scripts/check-env-boundary.ts` (invoked from `bun run ci`) that greps for
`process.env` and fails unless the file is allowlisted. Allowlist: `**/config/**`,
`**/config.ts`, `*.test.ts`/`*.test.tsx`, `drizzle.config.ts`, `next.config.ts`,
`lib/db/migrate.ts`, `instrumentation*.ts`, `scripts/**`. If oxlint gains rule support
later, replace the script with the rule.

**Steps.**
1. Inventory all non-test `process.env` reads (`grep -rn "process.env" --include="*.ts" --include="*.tsx"`), grouping by concern.
2. Create the config modules with Zod schemas; `z.infer` the types. Give every var an
   explicit environment axis: `required-prod | optional | dev-only` — several vars are
   legitimately absent in previews but must fail a production boot (e.g.
   `LINEAR_WEBHOOK_SECRET`, whose absence today turns the webhook route into a 500 at
   request time). Boot validation in `instrumentation.ts` enforces the axis per
   `VERCEL_ENV`, not one flat "required" list.
3. Migrate call sites incrementally (one concern per commit), keeping behavior identical —
   including current default values and error messages where user-facing.
4. Add the boundary-check script + wire into root `ci` script.
5. Regenerate `apps/web/.env.example` from the schemas — **note: CLAUDE.md references this
   file but it does not exist today; creating it is part of this workstream.** Every var
   with a one-line comment, secrets left blank.

**Acceptance criteria.**
- `bun run ci` fails if a new `process.env` read is added outside the allowlist.
- Boot with a deliberately missing required var → clear startup error naming the var.
- `apps/web/.env.example` exists and matches the schema (add a test that parses the
  example file against the schema with dummy values).
- No behavior change: existing tests pass unmodified (except direct-env-read tests).

---

## WS-0.2 — Supply-chain cooldown (Bun `minimumReleaseAge`)

**Problem.** Nothing prevents installing a package version published minutes ago —
the window in which npm supply-chain attacks live. QM enforces a 7-day cooldown via
`.npmrc min-release-age`.

**Steps.**
1. ✅ **Bun bump as its own PR first** — this is a runtime upgrade across a monorepo whose
   tests, workflow execution, and toolchain are all Bun-native, not an "S" config
   change. **Done:** `packageManager` and `.github/workflows/ci.yml` now both pin
   `bun@1.3.14` (was `1.2.14`), which clears the `1.2.20` floor step 2 requires.
   `bun run ci` passes on the new version. Detail, scope decisions, and the
   pre-existing failures this PR had to absorb are in
   [WS-0.2a — Bun version bump](./ws-0.2a-bun-version-bump.md). **Let this soak on main
   for a couple of days before step 2.**
2. ⬜ Then create root `bunfig.toml` with `[install]` → `minimumReleaseAge = 604800`
   (seconds; 7 days — requires Bun ≥ 1.2.20).
3. Verify enforcement: temporarily add a dependency version published < 7 days ago and
   confirm `bun install` blocks/warns per Bun's documented behavior; remove it.
4. If a genuinely urgent security patch is ever needed inside the window, use
   `minimumReleaseAgeExcludes` for that one package — document this escape hatch in a
   comment in `bunfig.toml`.
5. Be honest about the protection window in the `bunfig.toml` comment:
   `minimumReleaseAge` gates **new resolutions** (adding/updating deps). CI's
   `bun install --frozen-lockfile` installs exactly what the lockfile pins and is not
   re-screened — the cooldown protects the moment a version enters the lockfile, not
   every install after.

**Acceptance criteria.** Bun bump landed and soaked as its own PR (✅ landed, soak
pending); `bunfig.toml` committed (⬜); CI and `packageManager` on the same Bun version
(✅ both `1.3.14`); `bun install --frozen-lockfile` green in CI (✅ — it was red before
WS-0.2a from stale-lockfile drift, now fixed); behavior verified per step 3 (⬜).

---

## WS-0.3 — Dead-code detection (knip)

**Steps.**
1. Add `knip` as root devDependency. Create `knip.json` with workspaces for `apps/web`,
   `packages/*`; set Next.js plugin for the web app.
2. Run it; triage findings into (a) genuinely dead → delete, (b) false positives →
   per-workspace `ignore`/`ignoreDependencies` entries with a short reason.
3. Add `"lint:knip": "knip"` and append to the root `ci` script.

**Acceptance criteria.** `bun run ci` includes knip and is green; the initial dead-code
deletions land as a separate commit from the config, so they're reviewable.

---

## WS-0.4 — CI hardening: build + boot the artifact, DB-backed tests

**Problem.** `.github/workflows/ci.yml` runs lint/typecheck/`test:isolated`/`db:check`
but never runs `turbo build` — a broken production build ships to Vercel to find out.
QM's CI builds *and boots* every deployable image as a smoke test.

**Steps.**
1. Split the single job into parallel jobs sharing a setup pattern: `lint`, `typecheck`,
   `test`, `build`. Add `concurrency` with `cancel-in-progress: true` keyed on the PR.
2. `build` job: `bun install --frozen-lockfile && turbo build` with a **placeholder env**
   (dummy `DATABASE_URL` etc. — coordinate with WS-0.1 so the config schema documents which
   vars the build needs). Note `lib/db/migrate.ts` runs during build: point it at a
   `postgres:16` service container so migrations are actually exercised.
3. Boot smoke: after build, `bun run start` (Next.js) in the background, poll
   `GET /` (or a `/api/health` route — add one if absent, it's a one-liner) until 200
   or a 60s timeout, then kill. Fail the job on timeout.
4. DB-backed tests: add a `postgres:16` service container to the `test` job mirroring
   `docker-compose.yml` credentials, so tests that need a real DB can run in CI (currently
   only `db:check` runs).
5. Pin all action versions to full commit SHAs (QM practice) with the tag in a comment.
6. Dependabot hygiene (related but separate commit): main has 23 open alerts
   (12 high). Run `bun update` for the flagged transitive deps where a compatible fix
   exists; list any that need major-version work as follow-up issues rather than forcing
   them into this PR.

**Acceptance criteria.** A PR that breaks `next build` or crashes on boot now fails CI;
CI wall-clock stays under ~10 minutes (parallel jobs); actions SHA-pinned; high-severity
Dependabot alerts resolved or ticketed.

---

## WS-0.5 — SECURITY.md with a real threat model

**Problem.** Before org data and credentials flow through agents (Phase 1+), the trust
boundaries must be written down. QM's SECURITY.md (explicit assets, boundaries, candid
known-limitations) is the model.

**Steps.** Write `SECURITY.md` at repo root covering:
1. **Protected assets**: user GitHub App installation tokens, Linear OAuth tokens,
   Better Auth sessions, DB contents, sandbox contents, model API keys.
2. **Trust boundaries**: browser ↔ web app; web app ↔ agent loop; agent ↔ sandbox
   (untrusted code execution); sandbox ↔ network egress; webhooks (GitHub, Linear)
   ↔ web app; model provider ↔ agent (prompt-injection surface: repo content,
   fetched URLs, issue text are all attacker-controlled inputs to the model);
   production ↔ preview (Neon forks the prod DB into every preview, and previews share
   env secrets — anything in a table is preview-readable).
3. **Existing protections — document as facts, not gaps** (pre-verified): both webhook
   routes verify HMAC signatures with `timingSafeEqual`; better-auth OAuth tokens are
   encrypted at rest (`encryptOAuthTokens: true`); the Linear workspace token is
   AES-GCM encrypted (`apps/web/lib/linear/token.ts`).
4. **Operator assumptions**: Vercel/Neon/provider trust, who holds admin.
5. **Known limitations** — honest list, verified against code: open sign-up (any
   Vercel/GitHub account becomes a signed-in user — until Phase 1 WS-1.0's membership
   gate); no command policy yet (Phase 1); sandbox has open egress; share links are
   public-by-shareId with no auth; `user_sandbox_configs` stores provider API keys as
   plaintext jsonb (fixed in WS-1.0); migrations auto-run on every deploy with no
   rollback procedure documented (runbook lands in Phase 1 WS-1.5); no audit log yet
   (Phase 2). Keep this section maintained as phases land.
6. Reporting channel for vulnerabilities.

**Acceptance criteria.** SECURITY.md exists; every claim about current behavior verified
against code (not aspirational); webhook signature verification confirmed or fixed;
follow-up gaps filed as issues referencing the Phase 1/2 plans.

---

## Suggested PR breakdown & order

| PR | Workstream | Size |
| --- | --- | --- |
| 1 | WS-0.2a Bun version bump (own PR, soak before 1b) | S, risk-carrying |
| 2 | WS-0.2b bunfig cooldown | S |
| 3 | WS-0.3 knip + dead-code sweep | S–M |
| 4 | WS-0.4 CI hardening + Dependabot triage | M |
| 5 | WS-0.1 config boundary (can start immediately; largest) | L |
| 6 | WS-0.5 SECURITY.md (after 0.1/0.4 land, so it documents reality) | S |
