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

---

## WS-1.0 — Org settings & roles (integration protection)

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
- **Org settings entity.** Single-org model for now: an `orgSettings` singleton table
  (id fixed, one row) holding org-wide toggles introduced by later workstreams (default
  posture, default sandbox provider, observability config references, feature flags).
  Phase 2's scope model will generalize this; keeping it one table makes that migration
  mechanical.
- **Roles.** Extend `users.isAdmin` into `users.role` (`"admin" | "member"`, default
  `member`; migrate `isAdmin=true` → `admin`). Keep `isUserAdmin()` as a compatibility
  wrapper so existing call sites don't churn. Admin bootstrap: an `ADMIN_EMAILS`
  allowlist in config (via the Phase 0 config module) grants `admin` on first sign-in,
  so a fresh deploy is never adminless.
- **Gate integration lifecycle.** Behind `requireAdmin()`: Linear workspace
  connect/disconnect (`/api/linear/connect`, disconnect path), GitHub App
  installation removal for org-shared installs, sandbox provider settings, observability
  configuration, and (from WS-1.3) Linear repo mappings. Read/use paths stay open to all
  members — members use integrations, admins manage them.
- **Deletion protection.** Destructive actions on shared config (disconnect Linear
  workspace, remove GitHub installation, delete repo mapping) require typed
  confirmation in the UI, are **soft-deleted** (disabled with a `deletedAt`, purged
  after 14 days) so accidental removal is reversible, and emit an audit event
  (who/what/when) into a `config_audit` table — the seed of the Phase 2 audit log
  alongside WS-1.1's `policy_event`.

**Tasks / PRs.**
1. Schema: `role` column + migration, `orgSettings` singleton, `config_audit` table.
2. Admin bootstrap via `ADMIN_EMAILS` + role management UI in the existing admin area
   (promote/demote, cannot demote the last admin).
3. Gate the integration lifecycle endpoints; audit events on every mutation.
4. Soft-delete + confirmation UX for destructive integration actions.

**Acceptance criteria.**
- A `member` cannot disconnect the Linear workspace, remove a shared GitHub
  installation, or edit org settings — API returns 403, UI hides the controls.
- Disconnecting an integration as admin requires typed confirmation, and the
  integration can be restored within 14 days.
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
- **Enforcement point.** Wrap tool execution in the `ToolLoopAgent` loop (single choke
  point in `packages/agent/open-agent.ts` / tool dispatch), not per-tool, so subagents
  (executor) inherit it. `explorer` subagent additionally gets a hard read-only toolset
  (verify it already cannot write; policy is defense-in-depth).
- **Approval flow.** On `ask`: pause the run, persist an `approval` row, surface in chat UI
  as an interactive prompt (reuse the `ask-user-question` UI plumbing), resume with
  approve/deny. Timeout (configurable, default 24 h) → deny. Decisions and every `deny`
  are persisted — this is the seed of the Phase 2 audit log.

**Schema.** `agentSession.posture` column (default `auto`);
`approval` table (id, sessionId, toolCall JSON, decision, decidedBy, createdAt, decidedAt);
`policy_event` table for denials/allows-of-interest (append-only).

**Tasks / PRs.**
1. `packages/agent/policy/` module + exhaustive unit tests (parser edge cases: chained
   commands, quoting, env-prefixed commands, heredocs).
2. Loop integration + posture threading from session; deny path returns a structured tool
   error the model can react to.
3. Schema + approval persistence + web API routes.
4. Chat UI approval prompt + posture selector (admin-gated for `dangerous`) + session badge.
5. Docs: posture/policy reference in `docs/`; SECURITY.md "known limitations" updated
   (policy is pattern-based and bypassable by construction — screening classifier is
   future work; be honest, as QM is).

**Acceptance criteria.**
- `strict` session: `git push` pauses for approval; approve → proceeds, deny → model
  receives denial and continues gracefully.
- `auto` session: `rm -rf ~` variant is denied without user interaction; ls/build/test
  run untouched.
- Approvals survive process restarts (persisted, resumable).
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
- **Guard rails.** Response size caps + truncation (mirror the bash tool's `truncated`
  pattern); secret-shaped string redaction on responses; per-session rate limit reusing
  `apps/web/lib/rate-limit.ts`; tool descriptions instruct read-only intent, but
  enforcement is that only GET/query endpoints are implemented — there is no write path
  to guard. Configuration of these integrations (tokens, enable/disable) is org-shared
  state and admin-only per WS-1.0.
- Session-level toggle: which context tools are enabled per session (default on for org
  members once configured), stored alongside existing sandbox-provider settings.

**Tasks / PRs.**
1. Config schema + client factories in `apps/web` (with contract tests using recorded
   fixtures, no live calls in CI).
2. PostHog tools + tests.
3. Grafana + Sentry tools + tests.
4. Session settings toggle + wiring into agent tool assembly + system-prompt note telling
   the model these tools exist and when to use them.

**Acceptance criteria.**
- With PostHog configured, the agent can answer "how many `$pageview`s yesterday?" in a
  live session using `posthog-query`.
- Unconfigured services → tools absent from the toolset (not present-but-erroring).
- A response containing a `phc_`/`sntrys_`-style token is redacted before reaching the model.
- Note: the org's Sentry MCP currently requires re-auth (observed in this workspace);
  these tools use direct API tokens and are independent of MCP — call this out in docs.

---

## WS-1.3 — Linear-driven runs (issue → agent → PR → status sync)

**Problem.** Linear OAuth, token storage, `activities.ts`, `issues.ts`, and a webhook
handling `AgentSessionEvent` already exist in `apps/web/lib/linear/`, but there's no
end-to-end loop from a delegated Linear issue to a finished PR.

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
- **Run lifecycle.** Webhook → verify signature → idempotency check (store delivered
  event ids; Linear redelivers) → create a session (reusing the exact session-creation
  path the web UI uses — no parallel bespoke path) with the issue title/description/
  comments as the prompt, posture from mapping (default `auto`, never `dangerous` from
  a webhook) → agent clones, works, pushes branch, opens **draft** PR via existing GitHub
  plumbing → posts Linear activities at state transitions (started, PR opened w/ link,
  blocked-on-approval, failed w/ reason) → moves issue state per mapping config.
- **Approvals meet WS-1.1.** If the run pauses on an approval, post a Linear activity
  with a deep link into the chat session. (Approval from within Linear is out of scope
  for this phase.)
- **Safety.** Only issues from the OAuth-connected workspace; issue/comment text is
  untrusted model input (prompt injection) — run under command policy, draft PRs only,
  never auto-merge; per-team concurrency cap (default 2 simultaneous runs).

**Tasks / PRs.**
1. Webhook audit + idempotency store + event routing skeleton (log-only mode first).
2. Mapping table + settings UI.
3. Session-creation bridge + prompt assembly from issue content.
4. Status sync back to Linear (activities + state transitions) + failure paths.
5. E2E test against a sandbox Linear workspace; runbook in `docs/`.

**Acceptance criteria.**
- Delegating a mapped issue produces: a session visible in the web UI, a draft PR linked
  from a Linear activity, and an issue state change — with no human touching QuackOps.
- Webhook redelivery of the same event does not create a second run.
- Unmapped team / unverifiable signature → no run, actionable log line (and activity
  where possible).

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
- **Trust boundary.** Warm state is per-repo, shared across that repo's sessions/users.
  A session must never restore another repo's snapshot; document in SECURITY.md that
  users with access to the same repo share warm state (same as sharing the repo itself).
- Settings: per-repo toggle (default on); "discard warm state" button for when a cache
  is suspected poisoned/corrupt.

**Tasks / PRs.**
1. Interface + registry schema + capability flag (no behavior change; Daytona/cloud
   return `supportsWorkspaceCache: false`).
2. Vercel implementation + cacheKey computation + restore path + tests.
3. Docker implementation.
4. GC cron + settings UI + SECURITY.md note.

**Acceptance criteria.**
- Second session on the same repo starts with deps installed; measure and record
  time-to-first-tool-call cold vs. warm in the PR description (target ≥ 50% reduction
  on a repo with a nontrivial install).
- Lockfile change → cold start + new cache entry; old entry GC'd on schedule.
- Disabling the toggle → always cold, no registry writes.

---

## Execution order & dependencies

```
WS-1.0 org settings & roles ─┬─> WS-1.2 observability config (admin-gated)
                             ├─> WS-1.3 Linear runs (mappings admin-gated)
WS-1.1 policy ───────────────┴─> WS-1.3 (wants 1.1 postures)
WS-1.4 durable sandboxes ───────> (independent; benefits 1.3 start-up time)
```

- Start **WS-1.0** and **WS-1.1** first, in parallel — 1.0 protects the shared
  configuration everything else introduces; 1.1 unblocks trusting the agent with
  anything real.
- **WS-1.2** and **WS-1.4** parallelize behind them (1.2's tool implementation can start
  immediately; only its config surface waits on 1.0).
- **WS-1.3** lands last and is the phase's demo: a Linear issue becomes a draft PR,
  under policy, with telemetry context, on a warm sandbox — with its mappings and
  integrations manageable only by admins.
