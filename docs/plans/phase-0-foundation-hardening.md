# Phase 0 — Foundation Hardening: Execution Plan

Detailed, self-contained work plan for programming agents. Parent context:
[QM Learnings → QuackOps Roadmap](./qm-learnings-roadmap.md), Phase 0.

Each workstream below is independently executable and should land as its own PR.
Workstreams are ordered by suggested execution. Nothing depends on anything else; all can
run in parallel.

## Status

| Workstream | State |
| --- | --- |
| WS-0.2a Bun version bump | ✅ Done — see [sub-plan](./ws-0.2a-bun-version-bump.md). Bun `1.2.14` → `1.3.14`, landed on main in #5. |
| WS-0.2b bunfig cooldown | ✅ Done — see [sub-plan](./ws-0.2b-bunfig-cooldown.md). 7-day `minimumReleaseAge`, one justified exclusion. |
| WS-0.3 knip | ⬜ Not started |
| WS-0.4 CI hardening | ⬜ Not started — **rescoped**, see [evaluation](#ws-04--ci-hardening-revised-enforce-the-vercel-signal-dont-duplicate-it). Vercel previews already build + migrate per PR; the duplicate CI build job is cut. |
| WS-0.1 config boundary | ⬜ Not started |
| WS-0.5 SECURITY.md | ⬜ Not started |

## Ground rules for executing agents

- Follow `AGENTS.md` / `docs/agents/*` conventions: Bun only, kebab-case files, no `any`,
  Zod for validation, new concerns in new colocated files.
- After any change: `bun run ci` must pass. After schema changes:
  `bun run --cwd apps/web db:generate` and commit the migration.
- Substantial changes should go through the repo's OpenSpec process (`openspec/changes/`)
  — WS-0.1 qualifies; the rest are small enough to skip (WS-0.4 did until it was
  rescoped down to CI config plus a health route).
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
2. ✅ Then create root `bunfig.toml` with `[install]` → `minimumReleaseAge = 604800`
   (seconds; 7 days — requires Bun ≥ 1.2.20). **Done** — detail in
   [WS-0.2b — bunfig cooldown](./ws-0.2b-bunfig-cooldown.md).
3. ✅ Verify enforcement: temporarily add a dependency version published < 7 days ago and
   confirm `bun install` blocks/warns per Bun's documented behavior; remove it.
   **Done, and the documented behavior is not what happens:** Bun silently resolves to
   the newest *eligible* version instead of warning. It errors only when no version in
   the range is old enough — and then the whole install fails, `--frozen-lockfile`
   included. Full test matrix in the sub-plan.
4. ✅ If a genuinely urgent security patch is ever needed inside the window, use
   `minimumReleaseAgeExcludes` for that one package — document this escape hatch in a
   comment in `bunfig.toml`. **Done, but documented in the sub-plan rather than inline:**
   `bunfig.toml` is kept to its three config lines. The hatch was needed on day one:
   `@daytonaio/sdk@^0.203.0` is a `0.x` caret range containing a single two-day-old
   release, so it has no eligible version and blocks every install. Excluded with a
   justification and a removal path.
5. ✅ Be honest about the protection window (in the sub-plan, per step 4):
   `minimumReleaseAge` gates **new resolutions** (adding/updating deps). CI's
   `bun install --frozen-lockfile` installs exactly what the lockfile pins and is not
   re-screened — the cooldown protects the moment a version enters the lockfile, not
   every install after. **One correction from testing:** a frozen install *is* re-screened
   when the install config itself changes (which is why step 4's exclusion was needed
   before CI could go green). Already-pinned versions are still never re-checked on a
   steady-state install.

**Acceptance criteria.** Bun bump landed as its own PR (✅ #5); `bunfig.toml` committed
(✅); CI and `packageManager` on the same Bun version (✅ both `1.3.14`);
`bun install --frozen-lockfile` green in CI (✅ — it was red before WS-0.2a from
stale-lockfile drift, now fixed, and clean under the cooldown with no lockfile diff);
behavior verified per step 3 (✅).

**Follow-up this workstream leaves open.** The `@daytonaio/sdk` exclusion should be
retired by widening or pinning that range in `packages/sandbox/package.json` so an aged
version is reachable — see the sub-plan.

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

## WS-0.4 — CI hardening (revised: enforce the Vercel signal, don't duplicate it)

**Original problem statement.** `.github/workflows/ci.yml` runs
lint/typecheck/`test:isolated`/`db:check` but never runs `turbo build` — a broken
production build ships to Vercel to find out. QM's CI builds *and boots* every
deployable image as a smoke test.

**That statement is wrong for this repo, and the original plan fixed the wrong thing.**
QM has no preview environment, so its CI has to build the artifact itself. We deploy on
Vercel with previews on every PR, which already builds — with real env and a real
database. The scope below is cut accordingly.

### What Vercel previews already cover

Verified against the `quack-ops-web` project (`prj_2Cqg…`, team `next-degree`):

- **Every PR push builds a preview.** Deployments for PRs #2–#7 all carry `githubPrId`.
  Broken builds do surface as `ERROR` deployments — several already have.
- **Migrations are already exercised on every PR.** `apps/web` `build` is
  `bun run db:migrate:apply && next build`, and Neon database branching forks a fresh
  database per preview. That is a *more* faithful migration test than the `postgres:16`
  service container step 2 proposed — real Neon, real forked production schema, real
  `lib/db/migrate.ts` legacy-reconciliation path.
- **The preview boots far enough to serve functions** (`lambdaRuntimeStats` populated on
  every `READY` deployment).

### The real gap: the signal exists, nothing enforces it

Main has gone red at least twice, and neither time would a CI `build` job have helped —
the build result was already known and was ignored:

```
53641c6  PR #3 preview deploy → ERROR   (t=1785703422)
2c52253  PR #3 merged to main  → ERROR   (t=1785703444)   ← 22 seconds later
```

Commit `d1dfb66` documents the earlier occurrence ("main's own deployment of b9d1eec is
in error state"). PR #5's check runs list only `lint-and-typecheck` and
`Vercel Preview Comments` — the deployment status is not a required check, so a red
preview does not block merge.

Adding `turbo build` to GitHub Actions would have produced a *second* red signal next to
the red signal already being ignored. The fix is branch protection, not a build job.

### Why the duplicate build job is a net negative

- `turbo.json` declares ~50 build-time env vars. A placeholder-env CI build means
  maintaining a second, hand-written copy of that surface. WS-0.1 has not landed, so
  there is no schema to derive it from — and a CI build that diverges from Vercel's is a
  flake generator in both directions (green in CI / red on Vercel, and worse, the
  reverse).
- It roughly doubles CI wall-clock and runner minutes for a signal already produced.
- The `postgres:16` migration step is strictly less faithful than the Neon branch.

### Steps (revised)

1. **Require the Vercel deployment check on `main`.** This is the whole fix for the
   build gate. Add the Vercel deployment status to branch protection's required checks
   alongside `lint-and-typecheck`. Not a code change — record it here and in
   `docs/agents/lessons-learned.md` so it survives repo re-setup.
2. **Boot smoke as a post-deploy probe** (the one thing previews genuinely miss —
   `READY` means built and deployed, not that any page returns 200; a bad
   `instrumentation.ts` or module-init env read still ships). Add `/api/health`
   (a one-liner returning 200 — no DB call, so it tests boot, not dependencies), plus a
   workflow triggered on `deployment_status` that polls the preview URL until 200 or a
   60s timeout. **Note:** the project has `ssoProtection` enabled for
   `all_except_custom_domains`, so the probe must send
   `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` or it gets 401.
   Do **not** implement this as `bun run start` in Actions — that boots a configuration
   that exists nowhere.
3. **Split the CI job** into parallel `lint` / `typecheck` / `test` jobs sharing a setup
   pattern. Add `concurrency` with `cancel-in-progress: true` keyed on the PR. Unrelated
   to Vercel; saves runner minutes on force-push-heavy agent branches.
4. **Pin all action versions to full commit SHAs** with the tag in a comment. Unrelated
   to Vercel; same supply-chain posture as WS-0.2.
5. **Dependabot hygiene** (separate commit): main has 23 open alerts (12 high). Run
   `bun update` for flagged transitive deps where a compatible fix exists; file
   follow-up issues for anything needing major-version work rather than forcing it into
   this PR.

### Cut from the original plan

- ~~`build` job running `turbo build` with placeholder env~~ — Vercel previews already
  build with real env on every PR.
- ~~`postgres:16` service container for `lib/db/migrate.ts`~~ — Neon preview branches
  already exercise migrations more faithfully.
- ~~`postgres:16` service container for the `test` job~~ — no test currently touches a
  real database. Speculative infrastructure; add it in the PR that adds the first
  DB-backed test, where it can actually be verified.

### Acceptance criteria (revised)

- A PR whose preview deployment fails cannot be merged (required check configured;
  verify by observing a red deployment block the merge button).
- `/api/health` exists and the post-deploy probe fails the workflow if the preview does
  not serve 200 within 60s.
- CI jobs run in parallel with `cancel-in-progress`; actions SHA-pinned.
- High-severity Dependabot alerts resolved or ticketed.
- **No `turbo build` in GitHub Actions** — if a future change makes CI-side building
  necessary (e.g. leaving Vercel), revisit this section rather than reinstating it
  silently.

**Scope note.** This drops WS-0.4 from M to S and removes its OpenSpec trigger — the
ground rules above flag WS-0.1 and WS-0.4 as OpenSpec-worthy, but what is left here is
CI configuration plus a one-line route, not a substantial change. WS-0.1 still qualifies.

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
| 4 | WS-0.4 CI hardening + Dependabot triage | S (was M — build job cut) |
| 5 | WS-0.1 config boundary (can start immediately; largest) | L |
| 6 | WS-0.5 SECURITY.md (after 0.1/0.4 land, so it documents reality) | S |
