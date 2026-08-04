# Open Agents — OpenSpec Context

## Project

**Name:** open-agents  
**Type:** Turborepo monorepo  
**Package manager:** Bun (exclusively — never npm/pnpm/yarn)  
**Purpose:** Reference implementation for building and running background AI coding agents on Vercel.

The system lets users start a chat session tied to a GitHub repo, which spawns a durable agent workflow that clones the repo into a sandbox VM, receives tool-driven instructions, and can commit, push, and open PRs autonomously.

---

## Architecture

```
Browser / Web UI
      │
      ▼
apps/web  (Next.js 16 App Router)
  ├─ Auth (Better-auth, GitHub OAuth, Vercel OIDC)
  ├─ Session + Chat UI
  ├─ Workflow SDK (durable execution)
  └─ API routes (/api/...)
      │
      ▼
packages/agent  (@open-agents/agent)
  ├─ ToolLoopAgent  ← main agent loop
  ├─ Tools (read, write, edit, bash, grep, glob, fetch, task, skill, ask)
  ├─ Subagents (explorer, executor, design)
  └─ Skills (discovery, loading, frontmatter parsing)
      │
      ▼
packages/sandbox  (@open-agents/sandbox)
  ├─ connectSandbox() factory
  └─ Providers: Vercel · Docker · Daytona
```

**Key design decision:** The agent runs *outside* the sandbox. It communicates with the sandbox through tool calls (file reads/edits, bash execution). This separates agent lifecycle from execution environment and enables multi-provider flexibility.

---

## Workspace Layout

```
apps/
  web/                — Next.js app (UI, auth, workflows, API)
packages/
  agent/              — ToolLoopAgent, tools, subagents, skills
  sandbox/            — Sandbox abstraction + provider implementations
  shared/             — Shared React hooks and utilities
  tsconfig/           — Shared TypeScript configurations
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.1, React 19 |
| Language | TypeScript (strict, ESNext, verbatimModuleSyntax) |
| AI | Vercel AI SDK v6, @ai-sdk/anthropic, @ai-sdk/openai |
| Database | PostgreSQL via Drizzle ORM |
| Auth | Better-auth |
| Sandbox - cloud | Vercel Sandbox (@vercel/sandbox 2.0.0-beta) |
| Sandbox - local | Docker (dockerode) |
| Sandbox - remote | Daytona (@daytonaio/sdk) |
| Validation | Zod v4 (derive types with z.infer) |
| Styling | TailwindCSS, Radix UI |
| Workflows | Workflow SDK (durable execution) |
| Git/GitHub | Octokit, GitHub App |
| Voice | ElevenLabs transcription |
| Build | Turborepo + Bun |
| Lint/Format | Ultracite (oxlint + oxfmt), 2-space indent, double quotes |

---

## Database Schema (Drizzle + PostgreSQL)

Key tables and their roles:

| Table | Purpose |
|-------|---------|
| `users` | Account records (id, email, username, avatarUrl, `role` platform role, ban fields; `isAdmin` retained for the expand-contract window) |
| `accounts` | OAuth provider accounts linked to users |
| `authSessions` | Better-auth sessions |
| `verification` | Auth verification tokens |
| `githubInstallations` | GitHub App installations. `organizationId` non-NULL ⇒ organization-owned (one row per installation); NULL ⇒ personal to `userId` |
| `vercelProjectLinks` | Repo ↔ Vercel project mappings. Same ownership discriminator as installations |
| `sessions` | Core entity — coding sessions with repo, branch, sandbox state, PR info, lifecycle, `posture` (`strict`/`auto`/`dangerous`, default `auto`) |
| `chats` | Chat conversations attached to sessions |
| `chatMessages` | Individual messages (role + parts JSONB) |
| `chatReads` | Per-user read tracking for chats |
| `shares` | Read-only share tokens for sessions |
| `workflowRuns` | Durable workflow execution records — inserted at run *start*, so `finishedAt`/`totalDurationMs` are nullable and a row no longer implies a finished run. Carries running `inputTokens`/`outputTokens`/`stepCount`, a `haltReason`, and a `budget-exceeded` status |
| `workflowRunSteps` | Individual steps within a workflow run |
| `approvals` (`approval`) | Server-side record behind a policy `ask` — decision, `decidedBy`, `expiresAt`, `consumedAt` (single-use). The authority a client-supplied approval claim is checked against |
| `policyEvents` (`policy_event`) | Append-only policy audit: every `ask`/`deny`, plus `expired` and `downgraded`, with redacted input |
| `userPreferences` | Per-user defaults: model, subagent model, sandbox type, diff mode, flags |
| `userSandboxConfigs` | Per-user per-provider sandbox credentials (config stored as JSONB) |
| `usageEvents` | Append-only token/cost telemetry, attributed by nullable `sessionId` + `workflowRunId` (indexed on `(userId, createdAt)` and `(workflowRunId)` — the table had no index before) |
| `organizations` | Better Auth organization plugin — single seeded org |
| `orgMembers` | Org membership + role (`owner`/`admin`/`member`); absence of a row means *pending* |
| `orgInvitations` | Better Auth invitation model (table required by the plugin; invite flow unused) |
| `orgSettings` | Org-scoped settings: agent-run kill switch, daily token budget, org Vercel team |
| `orgGitHubAccounts` | GitHub accounts the org claims, keyed by GitHub's immutable numeric account id |
| `linearActorLinks` | Linear user id → QuackOps user, for members whose Linear address differs from their sign-in address |
| `vercelProjectLinkConflicts` | Repos whose members named different Vercel projects; awaiting an admin decision |

**Sessions** is the central entity. It carries repo info, Vercel project linkage, sandbox state (JSONB), hibernation timestamps, git stats, PR status, snapshot URL, cached diffs, and the security posture every chat in the session runs under.

**Policy tables:** `approval` is the server-side authorization for a policy `ask` — the decision otherwise arrives inside the client-supplied message body, where it is an assertion. `policy_event` is insert-only: there is no update or delete path anywhere in the app. See [`docs/policy-and-postures.md`](../docs/policy-and-postures.md).

**Schema changes:** Edit `apps/web/lib/db/schema.ts`, then run `bun run --cwd apps/web db:generate` and commit the generated `.sql` file. Never use `db:push`.

---

## App Routes (apps/web/app/)

```
/                         — Home / landing
/get-started              — Onboarding
/deploy-your-own          — Self-hosting guide
/sessions/[sessionId]     — Session detail + chat
/codespace/[sessionId]    — Codespace integration
/[username]/[repo]        — Per-repo session view
/[username]/og            — Open Graph images
/u/[username]             — Public user profiles
/shared/[shareId]         — Read-only session shares
/settings/                — Settings layout
  /settings/sandboxes     — Sandbox provider config (in progress)
  /settings/models        — Model preferences
  /settings/connections   — GitHub/Vercel integrations
  /settings/...           — Accounts, preferences, profile
/workflows                — Workflow management
/api/...                  — Server routes (auth, chat, sandbox, github, sessions, models)
```

---

## Conventions for New Features

- **File organization:** New concerns get their own file; don't append to existing large files.
- **UI components:** Extract feature logic into colocated hooks; extract UI regions into colocated child components.
- **API routes:** Live under `apps/web/app/api/`.
- **DB schema:** Drizzle table in `schema.ts` + generated migration. Never skip migration generation.
- **Sandbox providers:** Registered via side-effects in `packages/sandbox/providers/`.
- **Sandbox config:** Per-user per-provider stored in `userSandboxConfigs` table (JSONB config field).
- **Tests:** Bun test runner, `.test.ts` suffix, colocated with the file under test.

---