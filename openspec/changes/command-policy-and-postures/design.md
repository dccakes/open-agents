## Context

The agent package has no policy layer. What it has is five hardcoded, tool-local checks, discovered by reading every file in `packages/agent/tools/`:

1. A bash denylist — `DANGEROUS_COMMAND_PATTERNS` and `SENSITIVE_FILE_PATTERNS` (`packages/agent/tools/bash.ts:32-47`) feeding `commandNeedsApproval()` (`:53-64`) and the tool's `needsApproval` (`:68-77`). Denylist only. No allowlist. It ignores the tool's `cwd` argument, which happily accepts absolute paths outside the workspace (`bash.ts:125-129`), and it ignores `experimental_context` entirely because its callback destructures only `args`.
2. Dotenv gating for `read`/`write`/`edit` (`path-security.ts:5,50`, call sites `read.ts:29-57`, `write.ts:43-71,147-175`) — which **fails open** on a sandbox-connection error (`catch { return false }`).
3. Workspace containment for `read`/`write`/`edit`, enforced in `execute` as an error return (`write.ts:104-122`). `bash`, `grep`, and `glob` do not use it (`grep.ts:67-69`, `glob.ts:63-70` resolve absolute paths freely).
4. SSRF/private-host blocking for `web_fetch` (`fetch.ts:104-212`), which fails closed and is the one tool with `needsApproval: true` unconditionally (`fetch.ts:248`).
5. A skill-invocation gate (`skill.ts:74-79`).

Everything else is prompt text. `packages/agent/docs/approval-system.md` documents a prefix allowlist and a cwd-escape rule that `bash.ts` does not implement — the doc is stale and describes a system that was never built.

Three facts about the runtime shape the whole design:

- **`experimental_context` already exists and reaches both hooks.** `open-agent.ts:127-141` returns `experimental_context: { sandbox, skills, model, subagentModel }` from `prepareCall`; `execute` receives it (`bash.ts:119`) and so does `needsApproval` (`write.ts:43`, and the local type alias `ToolNeedsApprovalFunction` at `utils.ts:180-201` declares it). A policy object placed there is readable by every tool with zero factory-signature churn. `packages/agent/types.ts:19-24` is the type to extend.
- **The loop does not park; it ends.** `openAgent` runs with `stopWhen: stepCountIs(1)` (`open-agent.ts:83`) and is driven step-by-step by the workflow's `for` loop (`apps/web/app/workflows/chat.ts:723-782`). When a tool part lands in `input-available` or `approval-requested`, `shouldPauseForToolInteraction` (`chat.ts:89-94`) breaks the loop and the workflow run *terminates* (`chat.ts:768-776`). The client renders the pending part, the user answers, `addToolApprovalResponse` settles it (`session-chat-content.tsx:3571-3582`), and `sendAutomaticallyWhen` fires a **brand-new HTTP request and workflow run** (`use-session-chat-runtime.ts:52-90,149`).
- **Approval state is client-supplied.** The decision travels back inside `messages[].parts` on that new POST and is persisted from there (`apps/web/app/api/chat/_lib/persist-tool-results.ts:19-40`). Nothing server-side records that an approval was ever requested, who was entitled to answer it, or when it expires.

On the budget side: `usage_events` (`apps/web/lib/db/schema.ts:537-555`) has `userId` and no run key and no index; it is written once from the workflow's `finally` (`chat.ts:976`) by a step that swallows its own errors (`chat-post-finish.ts:466-468`). `workflow_runs.finishedAt` and `totalDurationMs` are `notNull` (`schema.ts:409-410`), so no row exists while a run is in flight. WS-1.0 landed `orgSettings.dailyTokenBudget` and `getDailyTokenBudget()` with an explicit "enforcement is WS-1.1's" comment (`apps/web/lib/org/settings.ts:106-117`) and no consumers, and `permissions.ts:32` declares `posture: ["setDangerous"]` with no consumers either. Both are hook points this change fills.

## Goals / Non-Goals

**Goals:**
- One policy evaluated identically for every bash-capable agent in the system — main loop, `executor`, `explorer`, `design` — because they construct their own tools independently and a loop-level wrapper would miss three of the four.
- Close the "gates `git push` in bash, auto-pushes via the API" hole by making posture reach the app-level side-effect paths, not just tool dispatch.
- Make approval a server-side fact rather than a browser assertion, with an expiry and an audit trail.
- Bound the cost of a run before WS-1.3 makes runs unattended and attacker-influenceable.
- Fill the two hook points WS-1.0 deliberately left: `getDailyTokenBudget()` and `posture.setDangerous`.

**Non-Goals:**
- **Admin-editable policy rules.** The policy is code-defined this phase (`default-policy.ts`) so the golden corpus is a meaningful regression test. Per-org rule editing is Phase 2.
- **A screening classifier.** Policy is pattern-based and bypassable by construction (`echo cm0gLXJmIC8K | base64 -d | sh` is one obvious family, and the shell is Turing-complete). This change documents that honestly rather than implying containment.
- **Sandbox-level containment** (egress allowlists, seccomp, per-run credentials). The sandbox still holds a push token and open egress; policy reduces the probability of a bad command, not the blast radius of one that gets through.
- **Approval from outside the chat UI.** Approving from Linear is explicitly out of scope (WS-1.3 says so too); a Linear activity carries a deep link into the chat session.
- **Terminating in-flight runs on posture change.** A posture change applies to subsequent tool calls in subsequent steps; it does not retroactively undo work. WS-1.5 owns per-run stop.
- **Rate limiting or concurrency caps.** Budgets bound tokens and steps, not request rate.

## Decisions

### 1. Enforce in the shared tool factories, not in the agent loop

- **Decision:** Policy evaluation lives in the tool factories (`packages/agent/tools/`) and reads its policy from `experimental_context`. Nothing is wrapped at the `ToolLoopAgent` level.
- **Rationale:** There are four independent `ToolLoopAgent` instances, and three of them build their own tools: `openAgent` (`open-agent.ts:65-77`), `explorerSubagent` (`explorer.ts:79-84`), `executorSubagent` (`executor.ts:64-71`), `designSubagent` (`design.ts:94-101`). Wrapping dispatch in `open-agent.ts` would cover exactly one. Enforcing in the factory means every present and future constructor of a bash tool is covered by construction — including any subagent added after this change lands.
- **Alternative:** wrap `sandbox.exec` in `packages/sandbox`. **Why rejected:** `web_fetch` (`fetch.ts:284-325`), `grep`, `glob`, and `path-security.ts:32`'s `realpath` probe all funnel through `sandbox.exec` with tool-generated command strings. A shell-level chokepoint would have to allowlist the platform's own generated commands, which is a larger and more fragile surface than the tool boundary — and it would evaluate policy against `curl ... --proto =http,https` rather than against the model's actual intent.
- **Alternative:** a `prepareStep` hook in each agent. **Why rejected:** same three-out-of-four coverage problem, plus `prepareStep` cannot deny an individual tool call.

### 2. `ask` maps onto the SDK's `needsApproval`; `deny` maps onto a structured result from `execute`

- **Decision:** Two enforcement points, both required, with different jobs.
  - `needsApproval` returns `true` when the decision is `ask`. This produces the `approval-requested` part state, which the workflow already treats as a pause (`chat.ts:89-94`) and the UI already renders (`approval-buttons.tsx`, `tool-state.ts:47-76`).
  - `execute` re-evaluates policy and, on `deny`, returns a structured error result — never throws, never executes. The model receives it as tool output and can react.
- **Rationale:** AI SDK v6's `needsApproval` has exactly two outcomes: pause or proceed. There is no "reject" return value, so `deny` cannot be expressed there. Putting deny in `execute` also means the denial is a normal tool result the model can read and route around, which is what the acceptance criterion asks for ("model receives denial and continues gracefully").
- **Consequence — `execute` is the authoritative gate, `needsApproval` is advisory.** `execute` re-evaluates the policy on every call rather than trusting that a pause happened. This is what makes Decision 3 enforceable and closes the window where a deny rule added between pause and resume would otherwise be bypassed by a replayed approved call.

### 3. Approval is a server-side record, because today it is a browser assertion

- **Decision:** Add an `approval` table. Requesting an `ask` decision writes a row; the decision route writes the outcome after authorizing the decider; `execute` verifies the row before running.
- **Rationale, stated plainly:** the resume request is an ordinary `POST /api/chat` whose body is `messages`, and the approval decision lives in `parts[].state === "approval-responded"` inside that client-supplied body (`persist-tool-results.ts:19-40`). Whoever can send that request can assert that any tool call was approved. That is acceptable for the current denylist, whose worst case is "the user approved their own `curl`"; it is not acceptable as the mechanism protecting a `strict` session from `git push --force`. Without a server-side record there is also nothing to expire, nothing to audit, and no way to tell an approval that was granted from one that was never asked for.
- **What the row buys, concretely:** (a) `execute` can refuse a tool call whose `toolCallId` has no `approved` row; (b) the 24-hour timeout has something to time out; (c) `decidedBy` is recorded, so "who approved this" is answerable; (d) an approval is single-use, so a replayed message body cannot re-authorize a second execution.
- **Alternative:** trust the message parts and skip the table. **Why rejected:** it makes the entire posture system advisory, and the workstream's own acceptance criteria ("approve → proceeds, deny → model receives denial") would be satisfied by a cooperative client only.
- **Cost:** every `ask` decision costs one insert before the pause and one read on resume, on top of the existing part-state round trip. The part state stays as the UI mechanism — the table is the authority, not a replacement for the rails that already work.

### 4. Approvals already survive restarts and hibernation; the work is proving it, not building it

- **Decision:** No new suspend/resume machinery. Resume is what it is today — a fresh HTTP request starting a fresh workflow run — and sandbox restoration is already on that path.
- **Rationale:** because the workflow *ends* rather than parks (`chat.ts:768-776`), a two-hour approval pause is indistinguishable from a two-hour gap between user messages. The resume run re-enters `resolveChatSandboxRuntime` → `getReadySessionSandbox` (`chat-sandbox-runtime.ts:54-121`), which sees `!isSandboxActive(session.sandboxState)` after the 30-minute inactivity hibernation (`SANDBOX_INACTIVITY_TIMEOUT_MS`, `apps/web/lib/sandbox/config.ts:38`) and kicks `sandboxProvisioningWorkflow` → `provisionSessionSandbox` (`provisioning.ts:209-298`, `connectSandbox({persistent: true, resume: true, createIfMissing: true})`). The plan treats this as machinery to build; it is machinery to *test*.
- **Consequence:** the acceptance criterion "approve after 2 h → sandbox restores → command executes" becomes a test against the existing provisioning path plus the new approval-record check, and the honest risk to state is different from the one the plan anticipated: the resumed run gets a **restored or reprovisioned** sandbox, so a command whose meaning depended on uncommitted in-sandbox state (a background process started with `detached: true`, an unsaved file) may execute against different state than when it was proposed. The approval UI says which session and command is being approved; it does not promise the sandbox is byte-identical.

### 5. Expiry is computed on read; the sweeper is a production-only cron

- **Decision:** An approval past `expiresAt` is treated as denied by every reader, in every environment, without a job running. A scheduled handler additionally materializes the terminal row and emits the `policy_event`, and returns immediately unless `VERCEL_ENV === "production"`.
- **Rationale:** the ground rules require cron handlers to no-op outside production, because preview databases are Neon forks whose rows point at real external resources. But "the timeout only works in production" would be a security property that silently does not hold in preview. Splitting it — authoritative on read, materialized by cron — gives correct behaviour everywhere and keeps the write path production-only.
- **Default:** 24 hours, configurable. An expired approval is a *denial*, not a re-prompt.

### 6. Subagents inherit posture; an `ask` inside a subagent auto-denies

- **Decision:** Policy is threaded into `explorer`, `executor`, and `design` through each `callOptionsSchema` and `prepareCall`, alongside the `sandbox` and `model` they already receive. A subagent's policy context carries a flag marking it non-interactive: `ask` resolves to `deny` with a structured error, which surfaces in the subagent's transcript and reaches the parent through its final summary. The parent may then attempt the operation itself, under a real approval.
- **Rationale:** the subagent runs *inside* `taskTool.execute` (`task.ts:98-108`). Its own `ToolLoopAgent` has no client and no UI channel — `task.ts:118-143` forwards only `tool-call` and `finish-step` parts. A pause there would hang the parent tool call, not prompt anyone.
- **Sharp edge:** each subagent's `prepareCall` builds a **fresh** `experimental_context` containing only `{ sandbox, model }` (`executor.ts:95-98`, `explorer.ts:108-111`, `design.ts:125-128`). Policy does not propagate implicitly; every subagent must be edited, and a subagent added later without the edit runs unpoliced. The mitigation is a test that enumerates `SUBAGENT_REGISTRY` (`subagents/registry.ts:5-21`) and asserts every entry threads policy — so a fourth subagent fails CI rather than failing silently.

### 7. Explorer gets a read-only policy profile, not a smaller tool list

- **Decision:** `explorer` keeps `read`/`grep`/`glob`/`bash` but its bash runs under a read-only profile in which every write-class and network-class decision is `deny`. It already has no `write`/`edit` tool (`explorer.ts:79-84`), so the plan's "explorer cannot write files" is not achieved by removing a tool — it is achieved by preventing `bash` from writing.
- **Rationale:** the acceptance criterion is "explorer cannot write files even when prompted to." Its current bash can `sed -i`, `echo > file`, `git checkout`, or `npm install`, and none of those match the existing denylist. A read-only *profile* is also the reusable primitive: WS-1.2's observability tools and WS-1.3's webhook runs want the same "this agent may look but not touch" shape.
- **Consequence:** explorer's prompt claims (`explorer.ts:26-31,58-60`) become true statements about enforced behaviour, and the prompt is updated to say the restriction is enforced, so the model does not waste steps attempting denied writes.

### 8. Compound commands are segmented before matching, and unparseable input is `unknown`

- **Decision:** `evaluate()` splits a bash command on `&&`, `||`, `;`, `|`, `&`, and newlines, descends into `$(...)`, backticks, and `sh -c` / `bash -c` string arguments, strips leading `VAR=value` assignments, and evaluates **every** segment. The decision for the whole call is the most restrictive segment decision. Quoting is respected — a `;` inside `'...'` or `"..."` is not a separator. Heredoc bodies are treated as data, not commands, but the command introducing the heredoc is evaluated. If the tokenizer cannot produce a confident parse, the call yields `unknown`.
- **Rationale:** the existing regexes are applied to the raw string, so `ls && rm -rf /` is matched only because `rm -rf` appears literally, while `ls; sh -c 'rm -rf /'` is not matched at all. Segment-wise evaluation is the difference between a pattern search and a policy.
- **`unknown` semantics:** `unknown` is `ask` under `strict` and `auto`, and `allow` under `dangerous` (consistent with `dangerous` turning every `ask` into `allow`, while `deny` rules still apply). It is never silently allowed under the default posture.
- **No new dependency.** A hand-written tokenizer, because the parse only needs to find command boundaries and the first word of each segment, and adding a shell-parser dependency to `packages/agent` for that is not worth the supply-chain surface. This is the single most test-dense part of the change; see the golden corpus.
- **Honest limit:** segmentation raises the cost of evasion; it does not eliminate it. `eval "$(printf ...)"` and base64 pipelines defeat any static parse. Documented in the security note, not papered over.

### 9. Rule precedence is deny → ask → allow, and the baseline is code

- **Decision:** rules are checked deny-first, then ask, then allow; within a class, first match wins. `default-policy.ts` ships the baseline: deny `rm -rf /`-class destruction, credential exfiltration (`env`/`printenv` and reads of token paths piped to a network command), and `git push --force` to a default branch; ask for `git push`, package publishes, `curl | sh`, package installs, and anything `unknown`; allow read-only inspection and build/test commands.
- **Rationale:** deny-first means an allow rule can never be written that accidentally overrides a hard denial, which is the failure mode that makes an allowlist-plus-denylist system quietly unsafe.
- **Guarded by a golden corpus:** a fixture file of real command strings mapped to expected decisions, run as a normal test. Any edit to `default-policy.ts` that starts allowing `curl | sh` fails CI. The corpus is the deliverable here, not the rule list — rule lists drift, corpora catch the drift.
- **Migration of the existing denylist:** `commandNeedsApproval()` and its two pattern arrays move into the baseline as `ask` rules with their current semantics preserved, so no command that requires approval today stops requiring it. The existing assertions in `packages/agent/tools/tools.test.ts:403-467` are kept and become part of the corpus. `commandNeedsApproval` stays exported from `tools/index.ts` as a thin wrapper during the transition.

### 10. Posture lives on `sessions`, and `dangerous` consumes the permission WS-1.0 already declared

- **Decision:** `sessions.posture` (`text`, enum `strict | auto | dangerous`, default `auto`, not null). Selecting `dangerous` requires `posture: ["setDangerous"]` — the statement declared at `apps/web/lib/auth/permissions.ts:32` and granted to `admin`/`owner` at `:67-98`, with zero consumers today. The UI shows a persistent badge on a `dangerous` session.
- **Rationale:** the table is `sessions`, not `agent_session`; a session owns many chats and the posture must be uniform across them, or a user could escape a `strict` posture by opening a second chat. Reusing the declared statement is the point of WS-1.0's shared statement set — five workstreams, one mechanism, one test surface.
- **`dangerous` still evaluates `deny`.** Hard denials are never bypassed by posture; `dangerous` only collapses `ask` → `allow`. A posture that could disable deny rules would make the deny class meaningless.
- **WS-1.3 constraint recorded here:** a webhook-triggered run may never select `dangerous`, regardless of the mapping's configuration. Enforced at the posture-resolution helper, so it holds for any future non-interactive trigger too.

### 11. App-level side effects are gated at the workflow, not inside the commit helper

- **Decision:** posture is consulted at the three orchestration points in `apps/web/app/workflows/chat.ts` — `canAutoCommit` (:820-825), before `runAutoCommitStep` (:843), and before `runAutoCreatePrStep` (:877-892). Under `strict`, auto-commit and auto-PR require an approval of kind `app-side-effect` rather than proceeding; a `deny` decision disables them for the run.
- **Rationale:** `performAutoCommit` and `performAutoCreatePr` each mint their **own** scoped installation token (`auto-commit-direct.ts:173-193`; `auto-pr-direct.ts:102`), so a check inside `performAutoCommit` would miss the PR path entirely.
- **The approval cannot be a tool part**, because there is no tool call — the agent loop has already finished (`finishedNaturally`, `chat.ts:801-804`). So this approval is surfaced as its own pending state on the run, backed by the same `approval` table with `kind: "app-side-effect"`, and executed by a dedicated route when granted. Under `auto` and `dangerous`, behaviour is unchanged from today.
- **Consequence:** the acceptance criterion "no push reaches GitHub through any path without approval in a `strict` session" is satisfied by bash policy plus this gate, and by nothing else — these are the only two paths that push.

### 12. Per-run budgets are enforced from orchestrator state and persisted per step

- **Decision:** the budget check runs in the workflow's step loop immediately after `totalUsage` accumulates (`chat.ts:762-766`), against a per-run token limit and a step limit. On breach the loop halts with a `budget-exceeded` state instead of the generic `exhaustedMaxSteps` failure (`chat.ts:946-950`). The running totals are written to the run row each step, so the budget survives a resumed run and is observable while the run is live.
- **Rationale:** `usage_events` cannot support this. It has no run key, no index, and is written once terminally by a step that swallows errors (`chat-post-finish.ts:396-408,466-468`) — a mid-run read of it sees nothing from the current run. `totalUsage` is the only accurate live figure, and it is orchestrator-local, so it must be persisted to be durable or observable.
- **`workflow_runs` gains an in-progress lifecycle.** `finishedAt` and `totalDurationMs` become nullable and the row is inserted at run start rather than only in the `finally` (`recordWorkflowRun`, `apps/web/lib/db/workflow-runs.ts:16-66`, becomes an upsert). It gains running `inputTokens`/`outputTokens`/`stepCount` and a `haltReason`.
- **Alternative:** a separate `agent_run_budget` table. **Why rejected:** a second row per run describing the same run, with the same lifecycle and the same failure modes, and WS-1.5's dashboard ("every running session and its spend on one page") would have to join both. One row that exists for the whole life of the run is the simpler thing.
- **Stated cost:** making `finishedAt` nullable weakens a current invariant — a `workflow_runs` row no longer implies a finished run. Readers must filter on `finishedAt IS NOT NULL`, and the migration must backfill nothing (existing rows are all finished). A crashed run leaves a row with a null `finishedAt` forever; WS-1.5's orphan reaper owns cleaning those up, and until then they are visible as "stuck" runs, which is better than invisible.

### 13. `usage_events` gets run attribution and its first indexes

- **Decision:** add `sessionId` and `workflowRunId` (both nullable, since historical rows have neither), plus indexes on `(userId, createdAt)` and `(workflowRunId)`. Do this migration first, as its own PR, per the plan.
- **Rationale:** the plan calls it "trivial now, painful later" and it is: the table is append-only and its writer is a single function (`apps/web/lib/db/usage.ts:11-50`). The org daily budget query — sum tokens for the org's users since UTC midnight — is a full table scan today, because the table has no index at all.
- **Note on scope:** attribution and enforcement are separate. The per-run budget does *not* read `usage_events`; the columns exist so that spend can be reported per session and per run after the fact, which is what WS-1.5's dashboard and WS-1.3's "run cost is visible on the session" criterion need.

### 14. The org daily budget is checked at run start and per step, and fails closed

- **Decision:** `getDailyTokenBudget()` (`apps/web/lib/org/settings.ts:112-117`) is consumed at run start alongside the existing kill-switch gate, and re-checked per step so a long run cannot blow through a limit it was under when it started. A read failure refuses the run, matching `checkAgentRunStartAllowed`'s fail-closed behaviour (`apps/web/lib/org/agent-runs-gate.ts:50-60`).
- **Rationale:** the kill switch already establishes both the shape and the placement — checked after the reconnect-to-existing-stream branch so resuming a live run keeps working while new runs are blocked (`apps/web/app/api/chat/route.ts:142-148`). The budget gate belongs immediately alongside it, with the same structured-refusal response shape (`agentRunBlockedResponse`, `agent-runs-gate.ts:64-73`).
- **Boundary:** "daily" is UTC-midnight-to-now, matching how `getUsageHistory` already groups (`apps/web/lib/db/usage.ts:90-119`). Stated in the UI, because a team that reads it as local-midnight will be surprised once a day.

### 15. Latency budget applies to evaluation, not to the whole approval chain

- **Decision:** the `< 5 ms p95` acceptance criterion is asserted against `evaluate()` — parse plus match, no I/O — with a benchmark test over the golden corpus.
- **Rationale:** the existing `needsApproval` chain for `write`/`edit` already performs a sandbox `realpath` round trip (`path-security.ts:23-48`), which is a network call to the sandbox and can never meet a 5 ms bound. Claiming the criterion for the whole chain would be false. Policy evaluation is pure and can meet it; the change does not add I/O to any tool's hot path.

### 16. Fail-closed, with one deliberate exception

- **Decision:** if policy is absent from `experimental_context`, tools that can mutate state or reach the network (`bash`, `write`, `edit`, `web_fetch`) refuse with a structured error. Read-only tools (`read`, `grep`, `glob`) proceed.
- **Rationale:** an absent policy means a caller was not wired — exactly the failure this change exists to prevent, and the same shape as the existing `catch { return false }` in `read.ts`/`write.ts` that currently fails *open* on a sandbox error. Refusing loudly turns a missed wiring into a visible test failure rather than an unpoliced agent. Read-only tools are exempted so that a wiring bug degrades to a crippled-but-safe agent rather than a dead one, and because they cannot cause the harm the policy exists to prevent.
- **Consequence:** every existing construction site must be updated in the same PR as the enforcement, or the agent stops working — which is the intended forcing function.

## Open Questions

1. **Default posture for existing sessions at cutover.** The column defaults to `auto`, which preserves today's behaviour exactly. Confirm nobody wants existing sessions to land in `strict` — they would all immediately pause on their next `git push`.
2. **Does `strict` gate `write`/`edit` inside the workspace?** The plan says "every side-effecting tool call (bash write-class, write, push)". Gating every file write would make `strict` unusable for a coding agent — a single task issues dozens. Proposed reading: under `strict`, `write`/`edit` are `allow` inside the workspace and `ask` for anything matching the sensitive-path rules (which is already today's behaviour), and `strict`'s teeth are bash write-class commands, network egress, and pushes. Needs an explicit decision before group 2, because it defines what `strict` means.
3. **Default per-run token budget.** The step budget has an obvious starting point (today's hard-coded 500). A token budget has none, and setting it too low turns a working product into a broken one. Proposal: ship it unset (unlimited) with the step budget enforced, gather one week of `usage_events` data now that runs are attributable, then set the default in a follow-up. Alternative is to guess a number and cause incidents.
4. **Whether a denied tool call should count against the step budget.** It costs a model step and tokens, so yes by default — but a policy that denies in a loop could burn a run's whole budget on denials. Consider a distinct "repeated denial" halt after N consecutive denials of the same tool.
