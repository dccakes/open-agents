# Phase 1 — Dev-Agent Depth: Execution Plan

Detailed, self-contained work plan for programming agents. Parent context:
[QM Learnings → QuackOps Roadmap](./qm-learnings-roadmap.md), Phase 1.
Assumes Phase 0 has landed (config boundary, hardened CI); WS-1.2/1.3 can start before
Phase 0 completes, WS-1.1 should build on the config boundary.

Goal: make the existing coding agent production-useful for business dev tasks — safe to
run (policy), informed (telemetry context), reachable from where work is tracked (Linear),
and fast to start (durable sandboxes).

## Ground rules for executing agents

- Follow `AGENTS.md` / `docs/agents/*`: Bun only, kebab-case, no `any`, Zod everywhere,
  new concerns in new colocated files; `bun run ci` green before pushing.
- Schema changes: edit `apps/web/lib/db/schema.ts`, then
  `bun run --cwd apps/web db:generate`, commit the migration. Never `db:push`.
- **Each workstream below must open an OpenSpec change proposal**
  (`openspec/changes/<slug>/`) before implementation — these are architecturally
  significant. Split implementation into reviewable PRs per the task lists.
- Env vars introduced here go through the Phase 0 config modules, never raw `process.env`.
  **Any WS that introduces an env var updates the config schema, `.env.example`, and the
  schema-parse test in the same PR** — otherwise drift restarts the day WS-0.1 lands.
- **Integration tokens live in env config, never in DB rows.** Preview deployments get a
  Neon fork of the production DB, so a token stored in a table is readable (and, with the
  shared `BETTER_AUTH_SECRET`, decryptable) from every preview. Tables store *references*
  to env-configured credentials. Existing violation to fix, not repeat:
  `user_sandbox_configs.config` holds provider API keys as plaintext jsonb.
- **Every cron/purge/GC handler must no-op unless `VERCEL_ENV === "production"`.**
  Preview DBs are forks of prod, but rows point at *real* external resources (Vercel
  snapshots, tokens) — a purge job running in a preview would destroy production state.
- **Docs sync:** each workstream's final PR updates `docs/agents/architecture.md` and any
  CLAUDE.md section it invalidates (WS-1.0 changes the auth story, WS-1.1 adds the policy
  module, WS-1.4 changes sandbox lifecycle), not just `lessons-learned.md`.

---

## WS-1.0 — Org settings & roles (integration protection)

> **Status:** OpenSpec change `openspec/changes/org-roles-and-settings/` is the authority
> for this workstream. It revises the design below: rather than hand-rolling a `users.role`
> enum and a fixed-id `orgSettings` singleton, WS-1.0 adopts Better Auth's **organization**
> and **admin** plugins (single seeded org; teams and dynamic access control off) with one
> shared `createAccessControl` statement set that WS-1.1–1.5 consume instead of each
> inventing its own admin check. See that change's `design.md` for the decisions, the
> rejected alternatives, and three open questions that need answers before implementation.

**Problem.** Integrations are currently unprotected shared state: GitHub App
installations are per-user rows, and the Linear workspace connection can be created or
deleted by any signed-in user. Phase 1 adds more org-shared, high-blast-radius
configuration (observability tokens, Linear repo mappings, sandbox provider settings) —
none of it should be editable or deletable by non-admins, and nothing destructive should
be one click away. A `users.isAdmin` boolean and a `requireAdmin()` helper
(`apps/web/lib/admin/actions.ts`) already exist; this workstream extends that seed into a
minimal org layer. It is deliberately thin — full multi-scope RBAC is Phase 2; this only
covers "who may manage shared org configuration."

**Design.**
- **Membership gate — task zero.** Roles are meaningless while sign-up is open:
  `apps/web/lib/auth/config.ts` has open social sign-in (Vercel + GitHub) with no domain
  allowlist, invite, or approval step — today, **anyone on the internet with a GitHub
  account who signs in becomes a "member"**, and Phase 1 would hand members org PostHog
  data, the shared Linear integration, and org-billed sandbox runs. Gate membership
  before gating roles: an `ALLOWED_EMAIL_DOMAINS` config allowlist (`nextdegree.org`)
  auto-grants membership; anyone outside it gets **no membership row** and is therefore
  pending — they can sign in but see only an "ask an admin to approve you" screen; admins
  approve from the admin area. Every "member" capability in this phase means *approved*
  member. Note `accountLinking.allowDifferentEmails` is enabled today, so the allowlist
  decision is made once at user creation and linking a second account never grants access.
- **Org settings entity.** *(Revised — keyed by `organizationId`, not a fixed id, so the
  Phase 2 multi-org migration is a no-op for this table. Typed columns, not the org
  plugin's `metadata` JSON: the kill switch is read before every run start and a malformed
  blob must not fail open.)* An `org_settings` table holding org-wide toggles introduced by later workstreams (default
  posture, default sandbox provider, observability config *references* — env keys, never
  token values, per the ground rules — and feature flags). Two rows this phase needs:
  a **global kill switch** (`agentRunsPaused` — no new workflow run starts anywhere while
  set; the "the agent is doing something bad at 3am" control) and an **org daily token
  budget** consumed by WS-1.1's run budgets. Phase 2's scope model will generalize this;
  keeping it one table makes that migration mechanical.
- **Roles.** *(Revised — see the OpenSpec change.)* Two distinct concepts rather than one
  enum: `users.role` (Better Auth admin plugin) is the **platform** role governing
  instance-level operations (bulk token revocation, ban, impersonate, session revocation);
  `org_members.role` (organization plugin) is the **org** role (`owner | admin | member`)
  governing shared configuration. `pending` is *not* a role value — it is the absence of a
  membership row, which fails closed. `users.isAdmin` migrates to `users.role` by
  expand-contract (migrations run on every deploy, so add-and-drop in one migration would
  break the rollout window); `isUserAdmin()` stays as a compatibility wrapper. Admin
  bootstrap remains an `ADMIN_EMAILS` config allowlist — the plugin's `adminUserIds` takes
  IDs, which are nanoid-generated at first sign-in and unknowable pre-deploy.
- **Gate integration lifecycle.** Behind `requireAdmin()`: Linear workspace
  connect/disconnect (`/api/linear/connect`, disconnect path), GitHub App
  installation removal for org-shared installs, sandbox provider settings, observability
  configuration, and (from WS-1.3) Linear repo mappings. Read/use paths stay open to all
  members — members use integrations, admins manage them.
- **Deletion protection.** Destructive actions on shared config (disconnect Linear
  workspace, remove GitHub installation, delete repo mapping) require typed
  confirmation in the UI, are **soft-deleted** (disabled with a `deletedAt`, purged
  after 14 days — purge job production-only per ground rules) so accidental removal is
  reversible, and emit an audit event (who/what/when) into a `config_audit` table — the
  seed of the Phase 2 audit log alongside WS-1.1's `policy_event`. Restore caveat: the
  Linear webhook secret currently has two sources of truth (`LINEAR_WEBHOOK_SECRET` env
  var read by the webhook route vs. `linearWorkspaces.webhookSecret` in the DB) —
  consolidate to one as part of this workstream, or a restored connection will silently
  fail signature verification after a secret rotation.
- **Scope note.** `userSandboxConfigs` / `userPreferences.defaultSandboxType` stay
  per-user (personal provider choice); WS-1.0 gates only the *org-level defaults* and
  which providers are enabled at all. The plaintext API keys in `userSandboxConfigs`
  are fixed under the ground rules (env-only or Linear-style AES-GCM), tracked here.

**Tasks / PRs.**
1. Membership gate: domain allowlist + `pending` role + approval UI; new sign-ups
   outside the allowlist land in `pending`.
2. Schema: `role` column + migration, `orgSettings` singleton (incl. kill switch +
   daily budget), `config_audit` table.
3. Admin bootstrap via `ADMIN_EMAILS` + role management UI in the existing admin area
   (promote/demote/approve, cannot demote the last admin).
4. Gate the integration lifecycle endpoints; audit events on every mutation; webhook
   secret source-of-truth consolidation.
5. Soft-delete + confirmation UX for destructive integration actions; prod-only purge.
6. Encrypt or relocate `userSandboxConfigs` provider keys.

**Acceptance criteria.**
- A sign-in from outside the domain allowlist lands in `pending` with no access to
  sessions, integrations, or org data until an admin approves.
- A `member` cannot disconnect the Linear workspace, remove a shared GitHub
  installation, or edit org settings — API returns 403, UI hides the controls.
- Flipping the kill switch prevents any new agent run (chat or webhook) from starting
  within one request cycle; flipping it back restores service. Admin-only, audited.
- Disconnecting an integration as admin requires typed confirmation, and the
  integration can be restored within 14 days — including working webhook signature
  verification after restore.
- Every shared-config mutation appears in `config_audit` with actor and timestamp.
- The last remaining admin cannot be demoted or deleted.

---

## WS-1.1 — Command policy & security postures

**Problem.** The agent's `bash` tool executes whatever the loop decides, in a sandbox with
open egress and (in dev-task use) real repo credentials. There is no notion of "this
command requires human approval." QM's model: named postures (Strict / Auto / Dangerous)
plus a predeclared command policy evaluated on every tool call.

**Design.**
- New module `packages/agent/policy/`:
  - `types.ts` — Zod schemas: `PolicyRule` (`match` on tool name + command pattern for
    bash; `action: "allow" | "deny" | "ask"`), `Posture` (`"strict" | "auto" | "dangerous"`),
    `PolicyDecision`.
  - `command-policy.ts` — `evaluate(toolCall, policy, posture): PolicyDecision`.
    Bash commands are shell-parsed (handle `&&`, `;`, `|`, subshells — evaluate every
    segment; unparseable → treat as unknown). First matching rule wins; rules are checked
    deny → ask → allow.
  - `default-policy.ts` — shipped baseline: deny `rm -rf /`-class destruction, credential
    exfiltration patterns (`env`, `printenv`, reads of token paths piped to network),
    `git push --force` to default branches; ask for `git push`, package publishes,
    outbound `curl|sh`; allow read-only and build/test commands.
- **Posture semantics.** `strict`: every side-effecting tool call (bash write-class, write,
  push) requires approval unless explicitly allowlisted. `auto` (default): policy decides;
  only `ask`-rules pause. `dangerous`: policy still evaluates `deny` rules (hard denials
  never bypassed) but `ask` becomes allow; only selectable per-session by an admin, badge
  shown in UI.
- **Enforcement point — in the tool factories, not the loop.** Wrapping dispatch in
  `packages/agent/open-agent.ts` does NOT cover subagents: `subagents/executor.ts` and
  `subagents/explorer.ts` are separate `ToolLoopAgent` instances that construct their
  **own** `bashTool()` / `writeFileTool()` instances, and explorer's "read-only" is
  prompt-text only — it holds a fully capable `bashTool()` today. Enforce policy inside
  the shared tool factories / sandbox exec path (`packages/agent/tools/`), with policy
  context threaded via `experimental_context`, so every constructor of a bash tool gets
  policy for free. Two explicit sub-tasks: wire both subagents, and give explorer a
  genuinely restricted toolset (no write tool, bash under a read-only policy profile).
- **App-level side effects are in scope.** The platform pushes commits *outside* tool
  dispatch: auto-commit/auto-PR call the GitHub API from the web app
  (`apps/web/lib/chat/auto-commit-direct.ts`). A `strict` session that gates `git push`
  in bash but auto-pushes via the API gates nothing. Posture must be consulted by these
  app-level paths too (strict → auto-commit requires the same approval; deny →
  disabled), or the workstream fails its own promise.
- **Run budgets.** Policy gates *what* runs; budgets gate *how much*. Today
  `usage_events` is display-only, has no sessionId (only userId — per-run attribution is
  structurally impossible), and chat runs allow `maxSteps: 500` with no token ceiling.
  This workstream adds: `sessionId` + `workflowRunId` columns on `usage_events` (do this
  migration first — trivial now, painful later); a per-run token/step budget checked in
  the workflow loop (`chat-post-finish.ts` already computes totals per turn); and the
  org daily budget from WS-1.0's `orgSettings`. Breach → run halts with a structured
  "budget exceeded" state, surfaced in UI (and, for WS-1.3 runs, a Linear activity).
- **Approval flow.** On `ask`: pause the run, persist an `approval` row, surface in chat UI
  as an interactive prompt (reuse the `ask-user-question` UI plumbing), resume with
  approve/deny. Timeout (configurable, default 24 h) → deny. Decisions and every `deny`
  are persisted — this is the seed of the Phase 2 audit log. Two collisions to design
  for, not around: (a) **sandbox lifecycle** — inactivity hibernation kicks in at 30
  minutes (`apps/web/lib/sandbox/config.ts`), so a multi-hour approval pause means the
  resume path must restore/reprovision the sandbox via the existing hibernate/restore
  machinery before re-executing; "approvals survive restarts" includes surviving sandbox
  death. (b) **Subagents** — `ask_user_question` plumbing exists only on the main agent;
  an `ask` decision inside the fire-and-forget executor cannot pause the world. Rule:
  subagents inherit posture, but `ask` auto-denies with a structured error that bubbles
  to the main loop, which may retry the operation itself under a real approval.

**Schema.** `sessions.posture` column (default `auto` — note the table is `sessions`,
not `agentSession`; posture is per-session and applies to all its chats);
`approval` table (id, sessionId, toolCall JSON, decision, decidedBy, createdAt, decidedAt);
`policy_event` table for denials/allows-of-interest (append-only);
`usage_events.sessionId` + `workflowRunId` (budget attribution).

**Tasks / PRs.**
1. `packages/agent/policy/` module + exhaustive unit tests (parser edge cases: chained
   commands, quoting, env-prefixed commands, heredocs) + a **golden corpus**: a fixture
   file of real commands → expected `allow`/`deny`/`ask`, run in CI, so any edit to
   `default-policy.ts` that suddenly allows `curl | sh` fails a test.
2. Tool-factory integration + posture threading; subagent wiring (executor + explorer);
   explorer restricted toolset; deny path returns a structured tool error the model can
   react to.
3. Schema (incl. `usage_events` attribution columns) + approval persistence + web API
   routes + run-budget enforcement in the workflow loop.
4. App-level side-effect gating (auto-commit / auto-PR consult posture).
5. Chat UI approval prompt + posture selector (admin-gated for `dangerous`) + session
   badge + approval-resume incl. sandbox restore.
6. Docs: posture/policy reference in `docs/`; SECURITY.md "known limitations" updated
   (policy is pattern-based and bypassable by construction — screening classifier is
   future work; be honest, as QM is).

**Acceptance criteria.**
- `strict` session: `git push` pauses for approval; approve → proceeds, deny → model
  receives denial and continues gracefully. **Auto-commit in a `strict` session pauses
  for the same approval** — no push reaches GitHub through any path without it.
- `auto` session: `rm -rf ~` variant is denied without user interaction; ls/build/test
  run untouched.
- A bash call issued by the **executor subagent** is policy-checked identically to the
  main agent; explorer cannot write files even when prompted to.
- A run exceeding its token/step budget halts with a visible "budget exceeded" state;
  `usage_events` rows attribute cost to the session and workflow run.
- Approvals survive process restarts *and* sandbox hibernation (approve after 2 h →
  sandbox restores → command executes).
- Policy evaluation adds < 5 ms p95 per tool call (it's regex/parse only).

---

## WS-1.2 — Observability context tools (PostHog, Grafana, Sentry)

**Problem.** Dev agents debug blind. Giving them read-only telemetry access turns "the
checkout is broken" into a diagnosable task. Start hardwired (like today's Linear/GitHub
integrations); migrate onto the Phase 2 connector framework later.

**Design.**
- New tool group `packages/agent/tools/observability/` with a factory pattern: tools take
  injected, pre-authenticated HTTP clients — the agent package never sees raw tokens.
  Clients constructed in `apps/web` from org-level config (Phase 0 config module
  `observability.ts`: `POSTHOG_API_KEY` + project id, `GRAFANA_URL` + service-account
  token, `SENTRY_AUTH_TOKEN` + org slug — all optional; tools are only mounted when
  configured).
- Tools (all strictly read-only endpoints):
  - `posthog-query` — run a HogQL query; `posthog-insights` — list/fetch saved insights.
  - `grafana-query` — query a datasource via the Grafana HTTP API (`/api/ds/query`);
    `grafana-dashboards` — search dashboards.
  - `sentry-issues` — search issues; `sentry-issue-detail` — fetch one issue + latest
    event stack trace.
- **Data allowlist, not all-of-PostHog.** Unrestricted HogQL is arbitrary read access to
  person properties (real-user PII) — exactly the "bolt ACLs on later" failure the
  roadmap warns against, one phase early. Admins define an allowlist of queryable
  tables/insights (e.g. events + aggregates yes, `persons.properties.email` no),
  enforced server-side in the client factory (query AST/table check, not prompt text).
  This is deliberately the primitive that grows into Phase 2 grants and Phase 3
  "pre-approved sections" — build it once here.
- **Guard rails.** Response size caps + truncation (mirror the bash tool's `truncated`
  pattern); secret-shaped string redaction **plus a PII redaction pass** (emails, names
  in person-properties responses) — distinct problems, distinct patterns; per-session
  rate limit reusing `apps/web/lib/rate-limit.ts` — note it silently no-ops when
  `REDIS_URL` is unset (`getRedis()` returns null): observability tools must **fail
  closed** (tools unmounted) in that degraded mode, not run unlimited. Tool responses
  are wrapped in untrusted-data framing before reaching the model: Sentry error
  messages and PostHog string properties are end-user-controlled text — a
  prompt-injection surface feeding an agent that holds push access (WS-1.3 flags this
  for Linear text; it is equally true here). Configuration of these integrations
  (tokens, enable/disable) is org-shared state and admin-only per WS-1.0; token values
  are env-only per the ground rules.
- **Share-link interaction.** Tool outputs persist verbatim in `chat_messages.parts`,
  and the existing `shares` table exposes chats **publicly by shareId with no auth**.
  Without handling, telemetry PII becomes publicly linkable. Rule: sessions containing
  observability tool calls cannot be shared (or shared views strip those parts) —
  decide in the OpenSpec proposal, but silence is not an option.
- Session-level toggle: which context tools are enabled per session (default on for
  **approved** org members once configured, per WS-1.0's membership gate), stored
  alongside existing sandbox-provider settings.

**Tasks / PRs.**
1. Config schema + client factories in `apps/web` (with contract tests using recorded
   fixtures, no live calls in CI) + allowlist enforcement in the PostHog client.
2. PostHog tools + tests.
3. Grafana + Sentry tools + tests + untrusted-data framing + PII redaction pass.
4. Session settings toggle + share-link rule + wiring into agent tool assembly +
   system-prompt note telling the model these tools exist and when to use them.

**Acceptance criteria.**
- With PostHog configured, the agent can answer "how many `$pageview`s yesterday?" in a
  live session using `posthog-query`.
- A HogQL query touching a non-allowlisted table is rejected server-side with a
  structured error, regardless of what the model asked for.
- Unconfigured services → tools absent from the toolset (not present-but-erroring);
  same when Redis (rate limiting) is unavailable.
- A session containing observability tool calls cannot produce a public share link
  exposing that data.
- A response containing a `phc_`/`sntrys_`-style token is redacted before reaching the model.
- Note: the org's Sentry MCP currently requires re-auth (observed in this workspace);
  these tools use direct API tokens and are independent of MCP — call this out in docs.

---

## WS-1.3 — Linear-driven runs (issue → agent → PR → status sync)

**Problem.** Linear OAuth, token storage, `activities.ts`, `issues.ts`, and a webhook
handling `AgentSessionEvent` already exist in `apps/web/lib/linear/` — and, importantly,
**a partial, unsafe loop is already live**, so this workstream audits and fixes running
behavior rather than building greenfield. Today the webhook route
(`apps/web/app/api/linear/webhook/route.ts`): matches the Linear actor's email to a
user and creates a session as them; **defaults the repo/branch to whatever that user's
most recent session used** — so delegating an issue can silently target the wrong repo
and land on a branch a live interactive session is using; does check-then-insert on
`sessions.linearAgentSessionId` with **no unique index** (concurrent Linear redeliveries
create duplicate sessions — the handler runs in `after()`); and never actually starts
the workflow (`start(runAgentWorkflow, ...)` exists only in the chat HTTP route), while
every failure after the initial "Starting on this..." activity dies in `console.error`.

**Design.**
- **Trigger.** Linear's agent-session flow (the existing `AgentSessionEvent` webhook
  registration) — when an issue is delegated/assigned to the QuackOps agent in Linear,
  the webhook fires; also support a label trigger (`agent:run`) for teams not using
  delegation. First: audit the current webhook route's handling and signature
  verification; extend rather than replace.
- **Repo mapping.** New table `linearRepoMapping` (linearTeamId → repoFullName +
  default sandbox provider + posture). Managed in the admin UI, admin-only per WS-1.0
  (mappings decide which repos webhook-triggered agents can touch). An
  event with no mapping → post a Linear activity explaining how to configure, stop.
  **The last-used-repo fallback is removed** — no mapping, no run, ever.
- **Whose credentials run the job.** The current design is silent on this and the
  default (impersonate the delegating user) is wrong: prompt-injected issue text would
  execute with whatever repos *that person* can reach. Each mapping designates an **org
  agent identity** — an admin-chosen GitHub App installation scoped to exactly the
  mapped repo — and every webhook-triggered run clones/pushes as that identity, never
  as the actor. The actor is recorded for attribution (session owner, usage
  attribution, Linear activity mentions), not for credentials.
- **Branch strategy.** Webhook runs always create a fresh branch with deterministic
  issue-key naming (`agent/ENG-123`); never reuse the actor's current branch. Re-run of
  the same issue (the common failure-recovery case): if `agent/ENG-123` exists, branch
  `agent/ENG-123-r2` and note the prior attempt in the session prompt — never
  force-push over a branch a human may have touched.
- **Run lifecycle.** Webhook → verify signature → idempotency (a **unique index** on
  `sessions.linearAgentSessionId` plus a unique event-id store, insert-conflict
  handling — a lookup-only check keeps today's TOCTOU race; this migration also fixes
  the live dedup bug) → create a session (reusing the exact session-creation
  path the web UI uses — no parallel bespoke path) with the issue title/description/
  comments as the prompt, posture from mapping (default `auto`, never `dangerous` from
  a webhook) → **headless workflow start** (a run-starter that invokes
  `runAgentWorkflow` with mapping-configured model + budget, since session creation
  alone starts nothing today) → agent clones, works, pushes branch, opens **draft** PR
  via existing GitHub plumbing → posts Linear activities at state transitions (started,
  PR opened w/ link, blocked-on-approval, budget-exceeded, failed w/ reason) → moves
  issue state per mapping config.
- **Approvals meet WS-1.1.** If the run pauses on an approval, post a Linear activity
  with a deep link into the chat session. (Approval from within Linear is out of scope
  for this phase.)
- **Safety.** Only issues from the OAuth-connected workspace; issue/comment text is
  untrusted model input (prompt injection) — run under command policy with WS-1.1 run
  budgets (unattended + attacker-influenceable input is the cost-runaway scenario),
  draft PRs only, never auto-merge; kill switch (WS-1.0) checked before starting any
  webhook run. Per-team concurrency cap (default 2): enforced by counting non-terminal
  webhook-triggered sessions per team **atomically with the idempotency insert** at
  webhook time — not a best-effort lookup.
- **Failure visibility.** Every failure at every stage — missing workspace token,
  decrypt error, no mapping, session-creation error, workflow crash, budget breach —
  produces a Linear activity or an operator alert (WS-1.5), **never only a log line**.
  Today everything after the initial activity is `console.error` inside `after()`.

**Tasks / PRs.**
1. Webhook audit: remove last-repo fallback, unique-index migration + conflict-safe
   idempotency, event routing skeleton (log-only mode first).
2. Mapping table (incl. agent-identity installation reference) + admin settings UI.
3. Headless run-starter + session-creation bridge + prompt assembly from issue content
   + branch-naming strategy.
4. Status sync back to Linear (activities + state transitions) + failure paths wired to
   activities/alerts.
5. E2E test against a sandbox Linear workspace; runbook in `docs/`.

**Acceptance criteria.**
- Delegating a mapped issue produces: a session visible in the web UI, a draft PR on a
  fresh `agent/<issue-key>` branch opened by the org agent identity (not the actor's
  credentials), a Linear activity linking it, and an issue state change — with no human
  touching QuackOps.
- Webhook redelivery of the same event does not create a second run — verified under
  concurrent delivery, not just sequential.
- Unmapped team / unverifiable signature → no run; the failure is visible in Linear or
  an alert, not only a log line.
- A run that hits its token budget halts and posts a budget-exceeded Linear activity
  with the session link; run cost is visible on the session.

---

## WS-1.4 — Durable sandboxes (warm per-repo workspaces)

**Problem.** Every run pays clone + install from scratch. QM keeps durable per-scope
computers. The Vercel provider already supports native snapshots
(`SnapshotResult.snapshotId` in `packages/sandbox/interface.ts`) and a base-snapshot
refresh script exists (`scripts/vercel-refresh-base-snapshot.ts`) — extend this from
"base image" to "per-repo warm state."

**Design.**
- New concept in `packages/sandbox`: `WorkspaceCache` keyed by
  `(repoFullName, provider, cacheKeyHash)` where `cacheKeyHash` = hash of lockfile(s) +
  base snapshot id. Table in `apps/web` schema: `sandboxWorkspaceSnapshot`
  (repo, provider, snapshotId/volumeId, cacheKey, createdAt, lastUsedAt, sizeBytes?).
- **Vercel provider**: on successful session end (hook into existing `beforeStop`
  lifecycle), snapshot and upsert the registry row. On session start, if a row matches
  repo + cacheKey → restore from snapshot and `git fetch && git checkout` the target
  ref, else cold-start and seed the cache. Stale-lockfile rows are invalid by
  construction (cacheKey mismatch).
- **Docker provider**: same contract via named volumes per repo
  (`quackops-ws-<hash>`), mounted as the workspace.
- **Daytona**: out of scope; interface must make it a clean no-op (provider capability
  flag `supportsWorkspaceCache`).
- **GC.** Scheduled job (Vercel cron route): delete rows + snapshots with
  `lastUsedAt > 14 days` or superseded cacheKeys beyond the 2 most recent per repo.
  Production-only per the ground rules — preview DBs contain forked registry rows
  pointing at **real** Vercel snapshots; a preview GC run would delete prod resources.
- **Trust boundary — warm state is executable, so default to per-user.** A snapshot is
  not just files: `.git/hooks`, `node_modules` postinstall scripts, and shell rc files
  all execute on the next session, and sandboxes hold a GitHub token
  (`setGitHubAuthToken`, `packages/sandbox/git.ts`). Cross-user sharing means a
  prompt-injected run (WS-1.3's explicit threat) can poison the snapshot and execute
  code in the *next user's* session with *their* token — "same as sharing the repo" is
  wrong; sharing a repo doesn't run a collaborator's code on your machine pre-review.
  Rules: cache key includes userId by default (per-user-per-repo warm state);
  org-shared cache is opt-in per repo by an admin and only with sanitize-on-restore
  (reset `.git/hooks`, reinstall deps from lockfile — cost this honestly: it gives back
  much of the win, which is why per-user is the default); **webhook-triggered sessions
  never write to a shared cache**; and this workstream sequences after WS-1.1, not
  independently.
- Settings: per-repo toggle (default on); "discard warm state" button for when a cache
  is suspected poisoned/corrupt.

**Tasks / PRs.**
1. Interface + registry schema + capability flag (no behavior change; Daytona/cloud
   return `supportsWorkspaceCache: false`).
2. Vercel implementation + cacheKey computation + restore path + tests.
3. Docker implementation.
4. GC cron + settings UI + SECURITY.md note.

**Acceptance criteria.**
- Second session by the same user on the same repo starts with deps installed; measure
  and record time-to-first-tool-call cold vs. warm in the PR description (target ≥ 50%
  reduction on a repo with a nontrivial install).
- Lockfile change → cold start + new cache entry; old entry GC'd on schedule (GC
  verified to no-op outside production).
- A webhook-triggered session neither reads from nor writes to another user's cache.
- Disabling the toggle → always cold, no registry writes.

---

## WS-1.5 — Platform ops: self-instrumentation, alerting, incident response

**Problem.** Phase 1 makes agent runs unattended (WS-1.3) while the platform itself has
**zero self-instrumentation**: no Sentry/PostHog SDK anywhere in `apps/web`, webhook
failures die in `console.error`, session failures are visible only if someone opens the
web UI, and the sandbox lifecycle evaluator skips all non-Vercel providers
(`apps/web/lib/sandbox/lifecycle.ts` returns `"unsupported-sandbox-type"`) — Docker and
Daytona sandboxes have no hibernation or GC path at all. WS-1.2 gives the *agent*
observability tools; nobody is watching the *agents*. The audit log is Phase 2, but
operational visibility cannot wait for it.

**Design.**
- **Error tracking for the platform.** Sentry SDK in `apps/web` (server + client),
  wired through the Phase 0 config module. Every path that currently swallows errors in
  `after()`/background helpers reports instead. Small and early — it is a prerequisite
  for trusting unattended runs, and can land during Phase 0 if convenient.
- **Admin runs dashboard.** One admin page: all active sessions org-wide (owner,
  trigger source, repo, posture, runtime, token spend so far — powered by WS-1.1's
  `usage_events` attribution), with per-run stop and the WS-1.0 kill switch surfaced.
- **Alerting.** Failed or budget-breached webhook runs, and runs stuck > N hours, send
  an operator alert (email or Slack webhook — simplest thing that pages a human).
- **Orphan cleanup.** Extend lifecycle coverage so Docker/Daytona sandboxes get a
  teardown path (provider capability parity or explicit TTL kill), and failed runs
  clean up half-state (branch pushed but no PR → note in session; sandbox alive but
  run dead → reap).
- **Incident runbook.** `docs/runbooks/agent-incident.md`: what to do when an agent did
  something destructive — kill switch, revoke which tokens (GitHub installation, Linear
  workspace), close PRs, discard warm state (WS-1.4), in what order; and the bad-prod-
  migration procedure (migrations auto-run on every deploy: Neon PITR restore,
  expand-contract discipline going forward).

**Tasks / PRs.**
1. Sentry SDK + error reporting sweep of background/`after()` paths.
2. Admin runs dashboard + per-run stop.
3. Alerting on failure/stuck/budget-breach.
4. Non-Vercel sandbox teardown + orphan reaper.
5. Incident + migration runbooks.

**Acceptance criteria.**
- A webhook run that throws anywhere reports to Sentry with the session id as context.
- An admin can see every running session and its spend on one page and stop any of them.
- A run failing at 3am produces an alert a human sees, not only a DB row.
- A Docker sandbox left by a crashed run is reaped within its TTL.

---

## Execution order & dependencies

```
WS-1.0 org settings & roles ─┬─> WS-1.2 observability config (admin-gated)
  (membership gate first)    ├─> WS-1.3 Linear runs (mappings, agent identity, kill switch)
WS-1.1 policy + budgets ─────┼─> WS-1.3 (postures + run budgets are prerequisites)
                             └─> WS-1.4 durable sandboxes (after 1.1 — warm state is
                                  executable; policy must exist before caches are shared)
WS-1.5 platform ops ────────────> alerting/dashboard before WS-1.3 goes unattended
```

- Start **WS-1.0** and **WS-1.1** first, in parallel — 1.0 closes the open-membership
  hole and protects shared configuration; 1.1 (policy + budgets + usage attribution)
  unblocks trusting the agent with anything real.
- **WS-1.2** and **WS-1.5** parallelize behind them (1.2's tool implementation can start
  immediately; only its config surface waits on 1.0; 1.5's Sentry step can land any
  time, the dashboard needs 1.1's attribution columns).
- **WS-1.4** follows 1.1 — do not share executable warm state before policy exists.
- **WS-1.3** lands last and is the phase's demo: a Linear issue becomes a draft PR,
  under policy and budget, with telemetry context, on a warm sandbox, visible on the
  ops dashboard — with mappings, integrations, and the agent identity manageable only
  by admins. Its hard prerequisites: 1.0 (mappings, kill switch, membership), 1.1
  (postures, budgets), 1.5 (failure alerting). 1.2/1.4 improve it but don't block it.
