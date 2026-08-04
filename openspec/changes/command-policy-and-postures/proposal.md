## Why

The agent's `bash` tool executes whatever the loop decides, in a sandbox that holds a real GitHub push token (`setGitHubAuthToken`, `packages/sandbox/git.ts`) and has open egress. The only thing standing between a model and a destructive or exfiltrating command is a five-entry regex denylist inside the bash tool itself (`packages/agent/tools/bash.ts:32-47`). It is a denylist with no allowlist, so `npm install`, `git reset --hard`, `git push --force`, `chmod`, `sudo`, and any unrecognised binary run unannounced — the package's own tests assert exactly that (`packages/agent/tools/tools.test.ts:404-409`). There is no notion of "this session is allowed to do less than that one," and no notion of "this command requires a human."

Three structural gaps make the existing gate weaker than it looks:

- **It does not cover subagents.** `explorer`, `executor`, and `design` are separate `ToolLoopAgent` instances that each construct their **own** `bashTool()` (`packages/agent/subagents/explorer.ts:84`, `executor.ts:70`, `design.ts:94-101`). Explorer's "READ-ONLY" is prompt text (`explorer.ts:26-31`) over a fully capable bash tool. Worse, a subagent's approval request has nowhere to go: the subagent runs inside `taskTool.execute` (`packages/agent/tools/task.ts:98-108`), whose stream handler only forwards `tool-call` and `finish-step` parts (`task.ts:118-143`) — there is no channel to the UI.
- **It does not cover app-level side effects.** Auto-commit and auto-PR push to GitHub from the *web app*, after the agent loop has ended, through their own scoped installation tokens (`apps/web/lib/chat/auto-commit-direct.ts:173-193`, `auto-pr-direct.ts:102`), orchestrated at `apps/web/app/workflows/chat.ts:820-899`. A session that gated `git push` in bash but auto-pushed via the API would gate nothing.
- **There is no budget.** `apps/web/app/api/chat/route.ts:165` starts every run with `maxSteps: 500` and no token ceiling. `usage_events` has `userId` and nothing else — no `sessionId`, no `workflowRunId`, no index at all (`apps/web/lib/db/schema.ts:537-555`) — so per-run attribution is structurally impossible, and the row is written once, terminally, best-effort, in the workflow's `finally` (`chat-post-finish.ts:396-408, 466-468`). WS-1.0 already landed `orgSettings.dailyTokenBudget` and a `getDailyTokenBudget()` accessor with a comment saying enforcement is WS-1.1's job (`apps/web/lib/org/settings.ts:106-117`); it currently has zero consumers.

WS-1.3 will make runs unattended and driven by attacker-influenceable Linear issue text. Doing that on top of an unbudgeted loop with a denylist that subagents bypass is the cost-runaway and blast-radius scenario the roadmap warns about. Policy and budgets are the prerequisite.

## What Changes

- Add `packages/agent/policy/` — Zod-typed `PolicyRule` / `Posture` / `PolicyDecision`, a shell-aware `evaluate()` that segments compound bash commands before matching, and a shipped `default-policy.ts` baseline. The existing `commandNeedsApproval()` denylist is folded into that baseline rather than left as a second, parallel mechanism.
- Enforce policy **inside the shared tool factories**, with the policy threaded on `experimental_context` — the same channel `sandbox` and `model` already travel on (`packages/agent/open-agent.ts:127-141`), readable from both `execute` and `needsApproval` on every tool with no factory-signature change.
- Thread policy into all three subagents (`callOptionsSchema` + `prepareCall`), and give `explorer` a genuinely restricted toolset: bash under a read-only policy profile, so its read-only contract is enforced rather than merely asserted in its prompt.
- Add three named postures — `strict`, `auto` (default), `dangerous` — stored on `sessions.posture`, applying to every chat in the session, with `dangerous` gated on the `posture.setDangerous` permission that WS-1.0 already declared and left unconsumed (`apps/web/lib/auth/permissions.ts:32`).
- Make **approval a server-side fact**. Approvals today live only as `approval-requested` / `approval-responded` states inside the client-supplied `chat_messages.parts` blob; the resume request carries the approval decision from the browser. Add an `approval` table so the decision is persisted, authorized, expiring, and re-verified server-side at execute time.
- Add a per-run token/step budget enforced in the workflow loop where `totalUsage` is already accumulated (`apps/web/app/workflows/chat.ts:762-766`), plus enforcement of WS-1.0's org daily token budget. Breach halts the run with a structured `budget-exceeded` state.
- Add `usage_events.sessionId` + `workflowRunId` (plus the indexes the table has never had), and give `workflow_runs` an in-progress lifecycle so spend is observable while a run is live rather than only after it ends.
- Consult posture at the three app-level side-effect chokepoints in the workflow, so `strict` gates auto-commit and auto-PR through the same approval mechanism and `deny` disables them.

## Capabilities

### New Capabilities

- `command-policy`: the policy vocabulary, shell-aware command segmentation, deny → ask → allow precedence, the shipped default baseline, and the golden corpus that guards it in CI.
- `security-postures`: `strict` / `auto` / `dangerous` semantics, per-session storage, admin gating for `dangerous`, propagation into subagents and app-level side effects.
- `tool-call-enforcement`: enforcement inside the shared tool factories, policy threading via `experimental_context`, subagent wiring, explorer's restricted toolset, structured deny errors the model can react to, the append-only `policy_event` log, and the evaluation latency budget.
- `agent-run-approvals`: server-authoritative approval records, resume across process restart and sandbox hibernation, expiry-as-denial, subagent auto-deny, and approval of app-level side effects.
- `run-budgets`: per-run token and step budgets, org daily token budget enforcement, `usage_events` run attribution, live run spend, and the structured budget-exceeded halt.

### Modified Capabilities

- `org-settings` (from `org-roles-and-settings`): this change becomes the consumer of `getDailyTokenBudget()`. The settings capability keeps ownership of the value's storage, permission gating, and audit; halting on breach is specified here.

## Impact

- **`packages/agent`**: new `policy/` module; `AgentContext` (`packages/agent/types.ts:19-24`) gains a `policy` field; `bash`, `write`, `edit`, `web_fetch`, and `task` factories gain policy enforcement; `explorer`/`executor`/`design` `callOptionsSchema` and `prepareCall` gain policy threading; `explorer` loses its unrestricted bash. `packages/agent/docs/approval-system.md` currently documents a prefix allowlist and a cwd-escape rule that `bash.ts` does not implement — it is rewritten to describe what actually exists.
- **Database**: `sessions.posture` (default `auto`); new `approval` table (id, sessionId, chatId, workflowRunId, kind, toolName, toolCallId, input JSON, decision, decidedBy, expiresAt, createdAt, decidedAt); new `policy_event` append-only table; `usage_events.sessionId` + `workflowRunId` + indexes; `workflow_runs` gains a nullable-finish in-progress lifecycle plus running token/step counters and a `haltReason`. One migration, generated with `bun run --cwd apps/web db:generate`.
- **Workflow**: `apps/web/app/workflows/chat.ts` gains a budget check in the step loop (:762-782) and posture consults at the auto-commit / auto-PR gates (:820-825, :843, :877-892). `apps/web/app/api/chat/route.ts:165`'s hard-coded `maxSteps: 500` becomes a configured budget.
- **API routes**: new approval decision route; posture read/update on the session; app-level side-effect approval execution route.
- **New libs**: `apps/web/lib/policy/` (session policy assembly, posture resolution, approval persistence, policy-event recording), `apps/web/lib/budget/` (run budget checks, org daily budget query).
- **UI**: approval prompt reuses the existing `ApprovalButtons` / `addToolApprovalResponse` rails (`apps/web/components/tool-call/approval-buttons.tsx`, `session-chat-content.tsx:3571-3582`); new posture selector and session posture badge; budget-exceeded state surfaced on the run.
- **Environment variables**: approval timeout and default run budgets, declared in a new `apps/web/lib/config/agent-policy.ts` group with axes and descriptions, read through accessors on that module, with `apps/web/.env.example` regenerated (`bun run --cwd apps/web env:example`) and schema-parse tests added in the same PR.
- **Permissions**: first consumer of the existing `posture: ["setDangerous"]` statement; `agentRun: ["stop"]` remains WS-1.5's.
- **Downstream**: WS-1.3 consumes postures (never `dangerous` from a webhook), run budgets, and the budget-exceeded state it reports as a Linear activity. WS-1.4 is explicitly sequenced after this change — warm state is executable and must not be shared before policy exists. WS-1.5's admin dashboard consumes the run attribution and live spend added here.
- **Docs**: `docs/agents/architecture.md` gains the policy module and enforcement point; the CLAUDE.md / AGENTS.md architecture summary gains the policy layer; `SECURITY.md` gains an honest "known limitations" entry stating that pattern-based policy is bypassable by construction; `docs/agents/lessons-learned.md` records the enforcement-point and client-asserted-approval traps.
