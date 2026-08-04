# Command Policy and Security Postures

What the agent is allowed to do, who decides, and where the decision is made.

Companion documents: [`packages/agent/docs/approval-system.md`](../packages/agent/docs/approval-system.md)
for the agent package's internals, [`SECURITY.md`](../SECURITY.md) for what this
system does **not** protect against.

---

## The three postures

A posture is stored on the **session** (`sessions.posture`, default `auto`), not
on the chat — a session owns many chats, and a per-chat posture could be escaped
by opening a second chat.

| Posture | What it does |
| --- | --- |
| `strict` | Every `ask` decision pauses for a human. Additionally gates the two application-level side effects — auto-commit and auto-PR — behind the same approval mechanism. |
| `auto` | The default, and exactly what the product did before postures existed. `ask` pauses; auto-commit and auto-PR proceed. |
| `dangerous` | Collapses `ask` → `allow`. Requires the `posture: ["setDangerous"]` permission (`apps/web/lib/auth/permissions.ts`), granted to `admin` and `owner`. |

Three invariants hold in every posture:

- **`dangerous` never relaxes a `deny`.** A posture that could disable deny rules
  would make the deny class meaningless. `policy/golden-corpus.test.ts` pins this
  over the whole corpus.
- **`strict` is never more permissive than `auto`.** Also pinned over the corpus.
- **A non-interactive run may never resolve to `dangerous`.** `dangerous` is only
  safe when there is a human who *could* have been asked. `resolvePosture()`
  (`apps/web/lib/policy/posture-resolution.ts`) downgrades `dangerous` to `auto`
  for the `webhook`, `schedule`, and `system` triggers and records a `downgraded`
  policy event. The refusal lives in the resolution helper rather than in any one
  trigger's handler, so a trigger added later inherits it.

What `strict` does **not** do: it does not gate every `write`/`edit` inside the
workspace. A single coding task issues dozens of writes, and gating each would
make the posture unusable. `strict`'s teeth are bash write-class commands,
network egress, pushes, and the two app-level side effects. Sensitive paths
(dotenv) are gated in every posture by the checks that predate policy.

Hiding the `dangerous` option in the UI is not authorization; the posture route
refuses it server-side regardless.

---

## Rule classes and precedence

A `CommandPolicy` (`packages/agent/policy/types.ts`) is three ordered rule lists
plus a default:

```ts
{ id, description, deny: [...], ask: [...], allow: [...], defaultAction, defaultReason }
```

A `PolicyRule` carries an `id` (reported in decisions and audit records), an
`action`, a `tool` (or `"*"`), an optional `pattern` (`RegExp`), a `scope`, a
`capability`, and a human-readable `reason`.

**`capability`** is one of `read`, `write`, `network`, `destructive`,
`credential`, `other`. It is not decorative: `createReadOnlyPolicy()` derives the
read-only profile by promoting every write-, network-, destructive-, and
credential-capability rule to a denial, so a rule added to the baseline with the
right capability is covered in the read-only profile without a second edit.

**`scope`** is `segment` (default — matched against each parsed command segment)
or `command` (matched against the whole raw string). `command` scope exists for
patterns that span a pipe: an exfiltration pipeline is not visible in any single
segment, and the classic fork bomb is written across several separators.

### Evaluation order

1. **Parse.** For `bash`, `parseCommand()` segments the command. If it cannot
   produce a confident parse, the outcome is `unknown` and matching is skipped.
2. **Match.** Within `deny`, then `ask`, then `allow`; first match within a class
   wins. Deny-first means an allow rule can never be written that accidentally
   overrides a hard denial — the failure mode that makes an allowlist-plus-denylist
   system quietly unsafe.
3. **Merge.** Every segment is matched independently, plus one `command`-scope
   pass over the whole string. **The most restrictive result wins**: `deny` >
   `ask` > `allow`. So `ls && rm -rf /` denies, and `ls; sh -c 'rm -rf /'` denies.
4. **Default.** If nothing matched anywhere, `defaultAction` applies.
5. **Posture, last.** `deny` stays `deny`. `allow` stays `allow`. `ask` and
   `unknown` become `allow` under `dangerous`, `ask` otherwise.

### The shipped baseline

`packages/agent/policy/default-policy.ts`. Rules are **code-defined this phase** —
there is no table and no runtime editing surface, which is what makes the golden
corpus a meaningful regression test. Per-org rule editing is a later phase.

| Class | Covers |
| --- | --- |
| `deny` | Recursive-forced deletion of a root, system, or home target; credential source piped into a network sink; force-push to `main`/`master` |
| `ask` | Download piped into an interpreter; anything piped into a shell; `eval`; base64 decode into a pipeline; package publish; package install; `git push`; plus the absorbed legacy rules (curl, recursive-force delete, `find -delete`, `shred`/`mkfs`/`dd`, fork bomb, dotenv references including obfuscated ones, `$(...)`/backtick env reads, SSH and cloud credential paths) |
| `allow` | Read-only inspection (`ls`, `cat`, `grep`, `find`, `jq`, …); read-only git (`status`, `log`, `diff`, `show`, …); build/test/lint invocations |

**`defaultAction` is `allow`.** The baseline is a denylist plus an explicit
allowlist for the commands that must never be gated; an unmatched command is
allowed, which preserves the behaviour the agent had before the policy existed.
This is the single most important thing to understand about the baseline's
coverage — see [`SECURITY.md`](../SECURITY.md).

### The read-only profile

`createReadOnlyPolicy(source)` derives a profile in which `defaultAction` is
`deny`: only explicitly permitted read-only commands run, and anything
unrecognised is denied. It adds rules the baseline has no reason to carry
(redirection, `sed -i`, `mv`/`cp`/`rm`/`mkdir`/`touch`/`chmod`/`tee`/…,
`find -exec`, write-class git subcommands, network binaries) and promotes the
source policy's forbidden-capability rules to denials.

Because it denies by default and its rules are all `tool: "bash"`, a `write`,
`edit`, or `web_fetch` call under this profile also falls through to `deny`.

The `explorer` subagent runs under it. The profile — not the tool list — is what
makes "explorer cannot write files" true.

---

## Where enforcement lives, and why

**In the tool factories** (`packages/agent/tools/policy-enforcement.ts`), read
from `experimental_context`. Nothing is wrapped at the `ToolLoopAgent` level.

The reason is coverage: there are four `ToolLoopAgent` instances in the agent
package and three of them build their own tools (`open-agent.ts`,
`subagents/explorer.ts`, `subagents/executor.ts`, `subagents/design.ts`). A
wrapper around `openAgent`'s dispatch would police exactly one of them. Enforcing
in the factory covers every present and future constructor of a bash tool.

Wrapping `sandbox.exec` instead was considered and rejected: `web_fetch`, `grep`,
`glob`, and the `realpath` probe all funnel through it with platform-generated
command strings, so a shell-level chokepoint would have to allowlist the
platform's own commands and would evaluate policy against `curl … --proto
=http,https` rather than against the model's actual intent.

Two hooks, two jobs:

- `needsApproval` → `requestPolicyApproval()`. Pauses on `ask`. It **cannot
  refuse** — the AI SDK gives it two outcomes.
- `execute` → `enforcePolicyWithApproval()`. Refuses on `deny`. **Authoritative**:
  it re-evaluates policy rather than trusting that a pause happened.

A refusal is a structured tool result (`refusedByPolicy: true`), never a thrown
error, so the model reads it as output and continues.

**Fail-closed:** with no policy on the context, `bash`/`write`/`edit`/`web_fetch`
refuse (`missing-policy`); `read`/`grep`/`glob` proceed.

### How a session's policy gets there

```
sessions.posture
  └─ resolveSessionPolicy()            lib/policy/session-policy.ts  → { posture, profile-name }
       └─ resolveRunPolicy()           app/workflows/chat-run-policy.ts  ("use step")
            └─ buildRunPolicyOptions() same file, inside the agent step
                 └─ agent call options → prepareCall → experimental_context.policy
                      └─ getPolicy() in every tool
```

The split is not stylistic. A workflow step's arguments and return value cross a
serialization boundary and a `CommandPolicy` cannot: its rules carry `RegExp`
objects. So `resolveSessionPolicy()` returns a profile **name** — two strings that
serialize fine — and the policy object is materialized inside the agent step via a
dynamic `import()`. `app/workflows/workflow-import-boundary.test.ts` pins the
related constraint: no workflow module may statically import `@open-agents/agent`,
`@/lib/org/settings`, `@/lib/budget/daily-budget`, `@/lib/auth/require-permission`,
or `next/headers`.

---

## Approvals

An `ask` decision needs a human answer. The mechanism has two halves that are
easy to confuse.

**The UI half** is the AI SDK's approval part state: `needsApproval` returns
`true`, the part lands in `approval-requested`, the workflow's
`shouldPauseForToolInteraction` breaks the loop, and **the workflow run ends** —
it does not park. The user answers, `addToolApprovalResponse` settles the part,
and the client sends a brand-new `POST /api/chat` that starts a brand-new
workflow run.

**The authorization half** is the `approval` table. It exists because the
decision travels back inside the client-supplied `messages[].parts` of that new
request. Whoever can send the request can assert that any tool call was approved.
The row is what `execute` verifies, what `expiresAt` times out, what `decidedBy`
attributes, and what `consumedAt` makes single-use.

| Step | Where |
| --- | --- |
| Write the pending row, before the pause | `ApprovalGate.request` → `lib/policy/approval-gate.ts` → `createApproval()` |
| Authorize the decider, record the decision | `POST /api/sessions/[sessionId]/approvals/[approvalId]` |
| Refuse a forged claim in the request body | `lib/policy/approval-assertions.ts` via `app/api/chat/_lib/approval-admission.ts` |
| Spend it at execute time | `ApprovalGate.verify` → `consumeToolCallApproval()` |

Single use is enforced by the **UPDATE, not the read**: two concurrent requests
can both pass a read of an unconsumed row, so the compare-and-set — `SET
consumed_at = now WHERE id = ? AND decision = 'approved' AND consumed_at IS NULL
AND expires_at > now` — is what decides between them.

`approval-admission.ts` exempts two tools by name: `web_fetch` (pauses
unconditionally via `needsApproval: true`) and `ask_user_question` (a client-side
tool). Neither produces a policy `ask`, so neither has a row to find. The
exemption is explicit and tested rather than an implicit "admit anything without
a row".

**Expiry** (`AGENT_APPROVAL_TIMEOUT_HOURS`, default 24) is computed **on read**,
in every environment, by `lib/policy/approval-state.ts`. An expired approval is a
denial, not a re-prompt. `lib/policy/approval-sweeper.ts` and `POST
/api/cron/approvals/expire` additionally *materialize* the terminal row and emit
the policy event, and return immediately unless `VERCEL_ENV === "production"` per
the phase ground rules.

> **Shipped state:** the sweeper handler and its route exist; the schedule does
> not. The repository has no `vercel.json` and no cron wiring, and adding one
> would need a scheduler secret that is not declared configuration for this
> change. Nothing about the timeout depends on it — expiry is authoritative on
> read.

**Resume across hibernation** needed no new machinery. Because the run *ends*
rather than parks, a two-hour approval pause is indistinguishable from a two-hour
gap between user messages: the resume request re-enters
`resolveChatSandboxRuntime` → `getReadySessionSandbox`, which sees the session
past its 30-minute inactivity hibernation and kicks the existing provisioning
path. The honest consequence is that the resumed run gets a **restored or
reprovisioned** sandbox, so a command whose meaning depended on uncommitted
in-sandbox state may execute against different state than when it was proposed.

**Inside a subagent an `ask` auto-denies.** A subagent runs inside
`taskTool.execute`, which forwards only `tool-call` and `finish-step` parts —
there is no channel to a UI, so a pause would hang the parent tool call rather
than prompt anyone. The refusal names the missing approver so the parent, which
does have one, can attempt the operation itself.

---

## Budgets

Three ceilings, all enforced from the workflow's step loop where `totalUsage`
already accumulates (`apps/web/lib/budget/run-budget.ts`):

| Budget | Source | Semantics |
| --- | --- | --- |
| Run tokens | `AGENT_RUN_TOKEN_BUDGET` | Halts when tokens **exceed** the ceiling. **Ships unset (unlimited)** — a ceiling guessed without data turns a working product into a broken one. |
| Run steps | `AGENT_RUN_STEP_BUDGET`, default 500 | Halts when the step count **reaches** the ceiling. 500 is the value `POST /api/chat` hard-coded before it became configurable, so the default changes nothing. |
| Org daily tokens | `orgSettings.dailyTokenBudget` | Checked at run start beside the kill switch, and against a snapshot during the run. UTC midnight to now. |

`usage_events` cannot support in-flight enforcement: it has no run key until this
change added one, and it is written once, terminally, from the workflow's
`finally`. `totalUsage` is the only accurate live figure, and it is
orchestrator-local, so it is persisted to `workflow_runs` each step to be durable
and observable.

Breach halts the run in a distinct **`budget-exceeded`** state — not the generic
`exhaustedMaxSteps` failure and not `failed`. The run did what it was asked to do
and then hit a ceiling, which is not an error. Assistant output produced before
the halt is persisted.

Two shipped details that differ from a first reading of the design:

- **The org daily figure is snapshotted at run start, not re-queried per step.**
  `readDailyBudgetSnapshot()` reads once; the step loop adds the run's own tokens
  to that baseline. Re-reading mid-run would return the same number every time —
  `usage_events` is not written until the run ends — at the cost of a query per
  step. The consequence, stated in the source: concurrent runs each see the same
  baseline and can jointly overshoot the daily ceiling, though each still halts
  the moment its own share crosses it.
- **Run start fails closed; the in-flight snapshot does not.** An unreadable
  budget refuses a *new* run (matching the kill switch). A snapshot read that
  fails after the run was already admitted resolves to "unlimited" rather than
  halting work in progress — refusing to start and killing work in progress are
  different decisions with different costs.

A resumed run is a **new run id**, so its accumulated usage cannot come from the
run row. `seedRunUsage()` (`app/workflows/chat-run-budget.ts`) seeds it from the
assistant message being continued, whose `totalMessageUsage` and step-finish list
have been accumulating across every run that contributed to it. An approval pause
therefore costs the run nothing and buys it nothing.

---

## Audit: `policy_event`

Every `ask` and every `deny` is recorded, append-only. There is no update or
delete path anywhere in the app — that is the value of it.

The agent package emits `PolicyEvent`s to an injected `PolicyEventRecorder`
(no-op by default); `apps/web/lib/policy/policy-event-recorder.ts` is the real
one, scoped to the session and run by `chat-run-policy.ts`. Recording is
fire-and-forget and best-effort: enforcement has already happened, and a slow or
broken recorder must never change what a tool does.

Everything derived from model-supplied text goes through
`packages/agent/policy/redact.ts` first — eagerly, preferring to redact something
harmless over leaking something that is not. A denied command is exactly the kind
of command most likely to contain a credential.

The `decision` column also carries two values that no rule produces: `expired`
(the sweeper materializing a timeout) and `downgraded` (posture resolution
refusing `dangerous` for a non-interactive trigger).

---

## Extending the golden corpus

`packages/agent/policy/golden-corpus.ts` maps real command strings to the action
the baseline must produce under each posture. It is the regression test for
`default-policy.ts`, run by `bun run ci`. Rule lists drift; corpora catch the
drift.

An entry:

```ts
{
  command: "git push --force origin main",
  rule: "bash.deny.force-push-default-branch",   // optional, pins the rule
  note: "Force-push to the default branch",       // read this before changing an expectation
  tags: ["deny"],
  expected: deny,                                 // one of the deny/ask/allow shorthands
}
```

Adding a rule? **Add the commands it is meant to catch, and at least one
neighbouring command it must NOT catch.** The near-miss is the half that catches
over-broad patterns.

`golden-corpus.test.ts` enforces more than the per-entry expectations:

- every rule id in the baseline must be decided by at least one entry
  (`uncovered` must be empty) — so a new rule without corpus coverage fails CI;
- every tag in `CorpusTag` must appear somewhere, which forces coverage of the
  parser edge cases (`chained`, `nested-shell`, `substitution`, `quoting`,
  `heredoc`, `env-prefix`, `redirect`, `unknown`);
- the posture invariants above, over every entry;
- nothing the pre-policy `commandNeedsApproval()` gated is `allow` under `auto`.

Latency is asserted separately in `policy-latency.test.ts`: `evaluate()` p95 under
5 ms over the corpus. The bound is on evaluation — parse plus match, no I/O — not
on the whole approval chain, which includes a sandbox `realpath` round trip for
`write`/`edit` and can never meet it.

---

## Known limits recorded in the source

These are in the code and its tests, not aspirational. The broader statement is
in [`SECURITY.md`](../SECURITY.md).

- **`git push --force` to a non-default branch is `ask`, not `deny`.** Only
  `main`/`master` deny. Pinned by a corpus entry, because it is a deliberate
  line, not an oversight.
- **The read-only redirection rule is a regex over segment text, so it
  over-matches.** `echo "a > b"` denies, and so does `grep -n '>' file` — the
  quoting is preserved in the text the pattern sees. It fails closed, which is
  the right direction for a read-only profile, but it is not precise.
- **The baseline's `defaultAction` is `allow`.** `git reset --hard`, `chmod -R
  777 /`, and any unrecognised binary run without a prompt.
- **`^`-anchored rules are defeated by a prefix.** `npm install` asks;
  `sudo npm install` is allowed, because the install rule anchors on the start of
  the segment. `sudo rm -rf /` still denies — that rule does not anchor.
- **Any interpreter defeats the parse.** `node -e '…execSync("git push --force
  origin main")'` evaluates to `allow`. The parser reads shell structure, not
  program semantics.
- **`eval` and base64 pipelines are gated, not solved.** They resolve to `ask`
  under `strict`/`auto` — and therefore to `allow` under `dangerous`.
