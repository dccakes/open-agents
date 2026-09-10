# Architecture

This is a Turborepo monorepo for "Open Agents" - an AI coding agent built with AI SDK.

## Core Flow

```
Web -> Agent (packages/agent) -> Sandbox (packages/sandbox)
```

1. **Web** handles authentication, session management, and the primary user interface
2. **Agent** (`deepAgent`) is a `ToolLoopAgent` with tools for file ops, bash, and task delegation
3. **Sandbox** abstracts file system and shell operations for cloud execution backends

## Authorization Layer

Sitting between the browser and everything else. Better Auth's organization and admin
plugins provide the primitives; QuackOps adds the gate and the org-scoped settings.

```
request
  └─ proxy (page routes)          ── pending? → /pending
  └─ getServerSession()           ── pending? → undefined (routes' no-session branch denies)
       └─ requireApprovedMember() ── positive membership check
       └─ requirePermission()     ── auth.api.hasPermission against the shared statement set
```

- **Two role scopes.** `users.role` is the platform role (instance-level: bulk token
  revocation, ban, impersonate). `org_members.role` is the org role (`owner`/`admin`/
  `member`) governing shared configuration. Phase 2's multi-scope RBAC generalizes the
  second; every org-scoped table carries `organizationId` from day one so that migration
  is mechanical.
- **Pending = no membership row.** Fails closed by construction. Enforcement is
  structural — at the session helper and proxy — so a newly added route is gated by
  default. Paths that resolve a user without a cookie (the Linear webhook matches on
  actor email) carry their own explicit check.
- **One statement set** (`apps/web/lib/auth/permissions.ts`), built by spreading both
  plugins' `defaultStatements` and adding QuackOps resources. WS-1.1 through WS-1.5
  consume it rather than each inventing an admin check.
- **Seeding is runtime, not migration** (`apps/web/lib/org/seed.ts`, called from
  `instrumentation.ts`): migrations are static SQL and cannot read configuration.
- **Org settings** (`org_settings`, keyed by `organizationId`) hold the agent-run kill
  switch and the daily token budget. The kill switch is checked at every run-start path
  in the deployment and fails closed; it stops *new* runs only, and does not reach
  preview deployments running against forked databases.

## Policy Layer

Between the model's intent and the sandbox. `packages/agent/policy/` is a pure
evaluator; `apps/web/lib/policy/` owns the session state, the approval records,
and the audit log. Full reference: [`docs/policy-and-postures.md`](../policy-and-postures.md).

```
sessions.posture
  └─ resolveSessionPolicy()      lib/policy — posture + profile *name*
       └─ chat-run-policy.ts     workflow step → agent call options
            └─ experimental_context.policy
                 └─ tools/policy-enforcement.ts   ← the enforcement point
                      ├─ needsApproval → pause on `ask` (cannot refuse)
                      └─ execute       → re-evaluate, refuse on `deny` (authoritative)
```

- **Enforcement is in the tool factories, not the agent loop.** There are four
  `ToolLoopAgent` instances and three of them (`explorer`, `executor`, `design`)
  build their own tools, so a loop-level wrapper would police one. Enforcing in
  `tools/` covers every present and future constructor of a bash tool.
- **`evaluate()` is pure.** It segments a compound bash command
  (`policy/command-parser.ts`), matches deny → ask → allow with the most
  restrictive segment winning, and applies posture last. Same function from both
  hooks; benchmarked at p95 < 5 ms.
- **Three postures** — `strict` / `auto` (default) / `dangerous` — stored on
  `sessions`. `dangerous` collapses `ask` → `allow`, never `deny`, requires
  `posture: ["setDangerous"]`, and is refused for any non-interactive trigger.
- **Fail-closed.** A side-effecting tool with no policy on its context refuses;
  read-only tools proceed. The policy cannot cross a workflow step boundary (its
  rules carry `RegExp`s), so steps exchange a profile *name* and materialize the
  object inside the agent step — pinned by `workflow-import-boundary.test.ts`.
- **Approval is a server-side record**, not the client-supplied part state:
  `approval` rows are authorized, expiring (on read, 24 h default), attributed,
  and single-use via compare-and-set. Every `ask`/`deny` lands in the
  append-only `policy_event`.
- **Budgets** bound each run's tokens and steps and consume WS-1.0's org daily
  token budget; a breach halts in a distinct `budget-exceeded` state.

New tables: `approval`, `policy_event`. Changed: `sessions.posture`,
`usage_events.sessionId`/`workflowRunId` (+ its first indexes), and
`workflow_runs`, which now has an in-progress lifecycle — the row is inserted at
run start, `finishedAt`/`totalDurationMs` are nullable, and it carries running
`inputTokens`/`outputTokens`/`stepCount` and a `haltReason`. **A
`workflow_runs` row no longer implies a finished run**; readers that mean
"finished" must filter on a set finish time (`finishedWorkflowRuns()`).

## Key Packages

- **packages/agent/** - Core agent implementation with tools, subagents, policy, and context management
- **packages/sandbox/** - Execution environment abstraction for cloud sandboxes
- **packages/shared/** - Shared utilities across packages

## Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, bash under a
  read-only policy profile — the restriction is enforced by the profile, not by
  the tool list)
- **executor**: Full access, for implementation tasks (all tools)

A subagent's `prepareCall` builds a *fresh* `experimental_context`, so policy does
not propagate implicitly — each one is wired explicitly and
`subagents/registry.test.ts` asserts it over `SUBAGENT_REGISTRY`. Subagent
contexts are marked non-interactive: an `ask` there resolves to a structured
denial, because `taskTool.execute` has no channel to a UI and a pause would hang
the parent tool call.

## Workspace Structure

```
apps/
  web/           # Web interface
packages/
  agent/         # Core agent logic (@open-agents/agent)
  sandbox/       # Sandbox abstraction (@open-agents/sandbox)
  shared/        # Shared utilities (@open-agents/shared)
  tsconfig/      # Shared TypeScript configs
```
