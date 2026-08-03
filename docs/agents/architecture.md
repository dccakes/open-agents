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

## Key Packages

- **packages/agent/** - Core agent implementation with tools, subagents, and context management
- **packages/sandbox/** - Execution environment abstraction for cloud sandboxes
- **packages/shared/** - Shared utilities across packages

## Subagent Pattern

The `task` tool delegates to specialized subagents:
- **explorer**: Read-only, for codebase research (grep, glob, read, safe bash)
- **executor**: Full access, for implementation tasks (all tools)

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
