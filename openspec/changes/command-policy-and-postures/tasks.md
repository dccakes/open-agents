## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

Task groups map to reviewable PRs. Group 0 is a standalone migration that should land first —
it is trivial now and painful later. Group 1 (the policy module) has no dependencies and can run
in parallel with group 0. Group 2 depends on group 1. Groups 3 and 4 depend on group 2 for the
posture plumbing but not on each other. Group 5 depends on 2, 3, and 4. Group 6 is last.

Resolve open questions 2 and 3 in `design.md` before group 2 ships: what `strict` means for
`write`/`edit`, and whether a default token budget ships in this change. Both change what the
implementation asserts, not just what it documents.

WS-1.4 must not start until group 2 has landed — warm sandbox state is executable, and the plan
sequences it behind policy for that reason.

## 0. Usage attribution migration

- [ ] 0.1 Add `sessionId` and `workflowRunId` (nullable text) to `usageEvents` in `apps/web/lib/db/schema.ts`, plus indexes on `(userId, createdAt)` and `(workflowRunId)` — the table has no index today.
- [ ] 0.2 Generate and commit the migration: `bun run --cwd apps/web db:generate`.
- [ ] 0.3 Thread `sessionId` and `workflowRunId` through `recordUsage` (`apps/web/lib/db/usage.ts:11-50`) and its caller `recordWorkflowUsage` (`apps/web/app/workflows/chat-post-finish.ts:396-465`), for both the main-agent row and the per-model subagent rows.
- [ ] 0.4 Tests: a completed run's usage rows carry both ids; existing rows with null attribution still read; per-session cost query uses the index.

## 1. Policy module and golden corpus

- [ ] 1.1 `packages/agent/policy/types.ts` — Zod schemas for `PolicyRule`, `Posture`, `PolicyDecision` (and the `unknown` decision), types via `z.infer`. No `any`.
- [ ] 1.2 `packages/agent/policy/command-parser.ts` — hand-written bash segmenter: `&&`/`||`/`;`/`|`/`&`/newline separators, single- and double-quote awareness, `$(...)` and backtick descent, `sh -c`/`bash -c` string descent, leading `VAR=value` stripping, heredoc bodies treated as data. Returns segments or an explicit unparseable result. No new dependency.
- [ ] 1.3 `packages/agent/policy/command-policy.ts` — `evaluate(toolCall, policy, posture)`. Deny → ask → allow precedence, first match within a class, most-restrictive segment wins, posture applied last (`dangerous` collapses `ask` → `allow` but never `deny`; `unknown` → `ask` under `strict`/`auto`, `allow` under `dangerous`). Pure: no I/O.
- [ ] 1.4 `packages/agent/policy/default-policy.ts` — the shipped baseline per the `command-policy` spec, absorbing `DANGEROUS_COMMAND_PATTERNS` and `SENSITIVE_FILE_PATTERNS` from `packages/agent/tools/bash.ts:32-47` as `ask` rules with no loss of coverage.
- [ ] 1.5 A read-only policy profile derived from the baseline, in which write-class and network-class decisions are `deny`. This is the primitive group 2 gives the explorer subagent.
- [ ] 1.6 Parser unit tests: chained commands, quoted separators, nested `sh -c`, command substitution, backticks, env-prefixed commands, heredocs, trailing/empty segments, unparseable input.
- [ ] 1.7 Golden corpus fixture (command → expected decision per posture) plus the test that runs it in `bun run ci`. Fold in the existing assertions at `packages/agent/tools/tools.test.ts:403-467` so no currently-gated command becomes ungated.
- [ ] 1.8 Latency benchmark over the corpus asserting p95 `evaluate()` under 5 ms.
- [ ] 1.9 Keep `commandNeedsApproval` exported from `packages/agent/tools/index.ts` as a thin wrapper over the policy so nothing importing it breaks.

## 2. Tool-factory enforcement, context threading, and subagent wiring

- [ ] 2.1 Extend `AgentContext` (`packages/agent/types.ts:19-24`) with the policy and posture; add a `getPolicy()` accessor beside `getSandbox`/`getModel` in `packages/agent/tools/utils.ts`. Note `isAgentContext` only checks for `sandbox` and `model` — do not tighten it in a way that breaks existing callers.
- [ ] 2.2 Extend `callOptionsSchema` and `prepareCall` in `packages/agent/open-agent.ts:41-47,127-141` to accept and forward policy + posture on `experimental_context`.
- [ ] 2.3 Enforce in `bashTool` (`tools/bash.ts`): `needsApproval` returns true on `ask`; `execute` re-evaluates and returns a structured refusal on `deny` before touching the sandbox. Evaluate the `cwd` argument too — it currently accepts absolute paths outside the workspace (`bash.ts:125-129`).
- [ ] 2.4 Enforce in `writeFileTool`, `editFileTool` (`tools/write.ts`), and `webFetchTool` (`tools/fetch.ts`), preserving their existing dotenv and SSRF checks — policy is added alongside, not in place of them.
- [ ] 2.5 Fail closed: side-effecting tools refuse with a structured error when no policy is in context; `read`/`grep`/`glob` proceed. Update every construction site in the same PR.
- [ ] 2.6 Thread policy into `explorer`, `executor`, and `design` — each needs its `callOptionsSchema` and the `experimental_context` its `prepareCall` builds (`explorer.ts:63-72,108-111`; `executor.ts:50-57,95-98`; `design.ts:80-87,125-128`) — and into `taskTool.execute` (`tools/task.ts:98-108`), which passes the options through.
- [ ] 2.7 Registry conformance test over `SUBAGENT_REGISTRY` (`subagents/registry.ts:5-21`) asserting every registered subagent threads policy, so a fourth subagent added later fails CI.
- [ ] 2.8 Mark the subagent policy context non-interactive: `ask` resolves to a structured denial naming an unavailable approval. Verify the parent is not paused and can retry the operation itself.
- [ ] 2.9 Give `explorer` the read-only profile from 1.5 and update its prompt (`explorer.ts:26-31,58-60`) to say the restriction is enforced.
- [ ] 2.10 `policy_event` table + migration; record every `deny` and every `ask` with a redacted input summary. Insert-only — no update or delete path.
- [ ] 2.11 Tests: executor bash denied identically to the main agent; explorer cannot write via redirect, `sed -i`, or package install; explorer's read-only commands still work; missing policy refuses for bash/write/fetch and not for read; denial is a tool result, not a thrown error; `execute` refuses a call whose rule changed after approval.

## 3. Posture, approvals, and schema

- [ ] 3.1 Add `sessions.posture` (non-null, default `auto`) and the `approval` table (session, chat, workflow run, kind, tool name, tool call id, redacted input, decision, decidedBy, expiresAt, createdAt, decidedAt); generate and commit the migration.
- [ ] 3.2 `apps/web/lib/policy/` — session policy assembly (posture + policy for a session), posture resolution refusing `dangerous` for non-interactive triggers, approval persistence, policy-event recording.
- [ ] 3.3 Posture read/update route + server action. `dangerous` gated on `requirePermission({ posture: ["setDangerous"] })` — the first consumer of the statement declared at `apps/web/lib/auth/permissions.ts:32`.
- [ ] 3.4 Approval decision route: authorize the decider against the session, record decision + decidedBy, refuse a decision on an expired or already-decided approval.
- [ ] 3.5 Verify approval server-side at execute time: a tool call whose decision was `ask` requires a matching `approved` record; approvals are single-use so a replayed message body cannot re-authorize.
- [ ] 3.6 Expiry: `expiresAt` from config (default 24 h); every reader treats a past-expiry approval as denied without a job running.
- [ ] 3.7 Expiry sweeper handler that materializes terminal state and records policy events, returning immediately unless `VERCEL_ENV === "production"` per the ground rules.
- [ ] 3.8 Declare `AGENT_APPROVAL_TIMEOUT_HOURS`, `AGENT_RUN_STEP_BUDGET`, `AGENT_RUN_TOKEN_BUDGET` in a new `apps/web/lib/config/agent-policy.ts` group with axes and descriptions; regenerate `apps/web/.env.example` with `bun run --cwd apps/web env:example` and commit it; add schema-parse tests.
- [ ] 3.9 Tests: forged approval in the request body refused; unauthorized decider 403; expired approval denies on read without the sweeper; sweeper no-ops outside production; approval single-use; approval survives a simulated process restart.

## 4. Run budgets

- [ ] 4.1 Make `workflow_runs.finishedAt` and `totalDurationMs` nullable; insert the row at run start and upsert on completion (`recordWorkflowRun`, `apps/web/lib/db/workflow-runs.ts:16-66`). Add running `inputTokens`/`outputTokens`/`stepCount` and `haltReason`. Migration; update every reader to filter on a set finish time.
- [ ] 4.2 `apps/web/lib/budget/` — per-run budget check and the organization daily budget query (UTC midnight to now, over the org's members' `usage_events`), consuming `getDailyTokenBudget()` (`apps/web/lib/org/settings.ts:112-117`).
- [ ] 4.3 Enforce the per-run budget in the workflow step loop where `totalUsage` accumulates (`apps/web/app/workflows/chat.ts:762-782`); persist running totals per step so a resumed run does not restart its budget at zero.
- [ ] 4.4 Halt in a distinct `budget-exceeded` state, separate from `exhaustedMaxSteps` (`chat.ts:946-950`), naming which budget was exceeded and the totals; persist assistant output produced before the halt.
- [ ] 4.5 Replace the hard-coded `maxSteps: 500` (`apps/web/app/api/chat/route.ts:165`) with the configured step budget.
- [ ] 4.6 Check the organization daily budget at run start alongside the kill switch (`route.ts:142-148`), using the same structured-refusal shape as `agentRunBlockedResponse` (`apps/web/lib/org/agent-runs-gate.ts:64-73`), placed so that reconnecting to a live run still works. Fail closed on read error.
- [ ] 4.7 Surface `budget-exceeded` in the session UI, stating the UTC day boundary where the daily budget is shown.
- [ ] 4.8 Tests: token breach halts; step breach halts; unset token budget bounded by steps alone; resumed run keeps its accumulated usage; daily budget blocks a new run but not a reconnect; read failure fails closed; halt state distinct from failure; output before the halt is persisted.

## 5. Application-level side-effect gating and chat UI

- [ ] 5.1 Consult posture at the three workflow chokepoints — `canAutoCommit` (`apps/web/app/workflows/chat.ts:820-825`), before `runAutoCommitStep` (`:843`), and before `runAutoCreatePrStep` (`:877-892`). Do not put the check inside `performAutoCommit`; `performAutoCreatePr` mints its own token independently (`auto-commit-direct.ts:173-193`, `auto-pr-direct.ts:102`).
- [ ] 5.2 Under `strict`, create an `app-side-effect` approval instead of performing the operation; surface it as a pending state on the run; execute the operation from a dedicated route when granted; skip it and report "skipped by policy" when denied.
- [ ] 5.3 Approval prompt in chat reusing the existing rails (`apps/web/components/tool-call/approval-buttons.tsx`, `addToolApprovalResponse` at `session-chat-content.tsx:3571-3582`, render state from `packages/shared/lib/tool-state.ts:47-76`), showing tool, operation, matching rule, and posture.
- [ ] 5.4 Posture selector and session posture badge, with the `dangerous` option hidden without the permission — and refused server-side regardless, since hiding a control is not authorization.
- [ ] 5.5 Verify approval-resume across sandbox hibernation end to end: the resumed run reprovisions via the existing path (`chat-sandbox-runtime.ts:54-121` → `provisioning.ts:209-298`) and then executes. This is a test of existing machinery, not new machinery.
- [ ] 5.6 Per the file-organization rules, put new chat behaviour in colocated hooks and child components rather than growing `session-chat-content.tsx`.
- [ ] 5.7 Tests: strict blocks auto-commit until approved; approving commits; denying skips and reports it; auto posture unchanged from today; no push reaches GitHub through either path without approval under `strict`; posture change mid-run does not terminate the run.

## 6. Docs and verification

- [ ] 6.1 Rewrite `packages/agent/docs/approval-system.md` — it currently documents a prefix allowlist and a cwd-escape rule that `bash.ts` never implemented. Replace with the posture/policy reference.
- [ ] 6.2 Add a policy and posture reference under `docs/` covering the three postures, the rule classes, the enforcement point, and how to extend the corpus.
- [ ] 6.3 Update `docs/agents/architecture.md` with the policy module, the enforcement point, and the new tables.
- [ ] 6.4 Update the CLAUDE.md / AGENTS.md architecture summary with the policy layer, per the phase ground rules.
- [ ] 6.5 Update `openspec/context.md`'s schema table with `approval`, `policy_event`, `sessions.posture`, the `usage_events` attribution columns, and the `workflow_runs` lifecycle change.
- [ ] 6.6 Create `SECURITY.md` (the repo has none) with a "known limitations" section stating plainly that policy is pattern-based and bypassable by construction — `eval`, base64 pipelines, and any interpreter defeat a static parse — that the sandbox still holds a push token and open egress, and that a screening classifier is future work.
- [ ] 6.7 Record in `docs/agents/lessons-learned.md`: enforcement belongs in the tool factories because subagents build their own tools; approval state arriving in the client-supplied message body is an assertion, not authorization; `needsApproval` can pause but cannot deny, so deny must live in `execute`; the workflow ends rather than parks on a pause, so resume already reprovisions the sandbox.
- [ ] 6.8 `bun run ci` green.
- [ ] 6.9 Manual: `strict` session pauses on `git push` and on auto-commit; approve → both proceed; deny → model continues; `auto` session denies an `rm -rf ~` variant without interaction; explorer refuses a write; a run over its step budget halts visibly.
