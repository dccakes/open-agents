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
| `strict` | Runs a **different rule set** — the strict profile, whose `defaultAction` is `ask`. Write-class commands, network egress, and anything the policy does not recognise pause for a human. Additionally gates the two application-level side effects — auto-commit and auto-PR — behind the same approval mechanism. |
| `auto` | The default, and exactly what the product did before postures existed. Runs the baseline, whose `defaultAction` is `allow`: `ask` pauses, everything unmatched runs. Auto-commit and auto-PR proceed. |
| `dangerous` | Runs the baseline and collapses `ask` → `allow`. Requires the `posture: ["setDangerous"]` permission (`apps/web/lib/auth/permissions.ts`), granted to `admin` and `owner`. |

**A posture selects a profile; it is not only a knob applied after matching.**
That distinction is the whole of `strict`. Posture alone can only relax `ask`
(that is what `dangerous` does) — it cannot tighten anything, so under a
baseline that allows by default, "every `ask` pauses" is a promise `auto`
already keeps. Concretely, under `auto` these run without a prompt and under
`strict` every one of them pauses:

```
git reset --hard HEAD~1      chmod -R 777 .        rm -r build
mv src/old.ts src/new.ts     truncate -s 0 log     echo hi > notes.txt
sed -i 's/a/b/' page.tsx     wget https://…        find . -exec grep … {} \;
custom-command --verbose     git checkout -- .     git add -A
```

And these still run unprompted under `strict`, because an unusable posture is
one nobody turns on:

```
ls -la    cat README.md    grep -rn foo lib    find . -name '*.ts'
sed 's/a/b/' README.md      cd apps/web && bun run typecheck
git status    git log    git diff    bun run ci    tsc --noEmit    bun --version
```

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
make the posture unusable, so the strict profile carries explicit `allow` rules
for the `write` and `edit` tools. It carries one for `web_fetch` too — that tool
pauses unconditionally in every posture through its own `needsApproval: true`,
which is not a policy `ask` and therefore has no approval record; letting it fall
to the strict default would have refused every fetch rather than pausing it.
`strict`'s teeth are bash write-class commands, network egress, pushes, anything
unrecognised, and the two app-level side effects. Sensitive paths (dotenv) are
gated in every posture by the checks that predate policy.

Inside a subagent an `ask` auto-denies (there is no one to ask), so under
`strict` an `executor` can read, build, test, and write files, but hands `git
add`, `mv`, and anything unrecognised back to the parent, which does have an
approver. That is the price of `strict` meaning something.

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
`credential`, `other`. It is not decorative, and it is what makes the derived
profiles maintainable: `createReadOnlyPolicy()` promotes every write-, network-,
destructive-, and credential-capability rule to a denial, and
`createStrictPolicy()` demotes every `allow` rule with one of those capabilities
to an `ask`. A rule added to the baseline with the right capability is covered in
both profiles without a second edit.

**`scope`** is `segment` (default — matched against each parsed command segment)
or `command` (matched against the whole raw string). `command` scope exists for
patterns that span a pipe: an exfiltration pipeline is not visible in any single
segment, and the classic fork bomb is written across several separators.

### Evaluation order

1. **Parse.** For `bash`, `parseCommand()` segments the command. If it cannot
   produce a confident parse, the outcome is `unknown` and matching is skipped.
   Each segment carries two texts: `text` as written (minus leading `VAR=value`
   assignments) and `commandText`, which is `text` with any leading **wrapper**
   invocation removed — `sudo`, `env`, `command`, `nohup`, `nice`, `time`,
   `timeout`, `xargs`, and friends, together with their own options and operands
   (`policy/command-wrappers.ts`).
2. **Match.** Rules are matched against `commandText`, so `sudo npm install`,
   `env FOO=1 npm publish`, and `timeout 60 git push` reach the same decision as
   the unwrapped command. Decisions *report* `text`, so the audit record still
   shows the `sudo`. Within `deny`, then `ask`, then `allow`; first match within
   a class wins. Deny-first means an allow rule can never be written that
   accidentally overrides a hard denial — the failure mode that makes an
   allowlist-plus-denylist system quietly unsafe.

   Rules stay `^`-anchored rather than being loosened to match anywhere: an
   anchor is what makes a rule mean "this command runs" instead of "these words
   appear", and without it `echo "run npm install"` and
   `cat notes-about-npm-install.md` would both prompt. The wrapper list is a
   closed set matched by basename, so `sudoedit` and `envsubst` are ordinary
   commands.
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
| `allow` | Read-only inspection (`ls`, `cat`, `cd`, `grep`, `find`, `sed`, `awk`, `jq`, …); a `--version`/`--help` probe of any binary; read-only git (`status`, `log`, `diff`, `show`, …); build/test/lint invocations |

**`defaultAction` is `allow`.** The baseline is a denylist plus an explicit
allowlist for the commands that must never be gated; an unmatched command is
allowed, which preserves the behaviour the agent had before the policy existed.
This is the single most important thing to understand about the baseline's
coverage — see [`SECURITY.md`](../SECURITY.md).

**Under the baseline the `allow` list cannot change an outcome** — the default is
already `allow`, and deny → ask → allow ordering means an allow rule only ever
confirms it. It exists for the derived profiles, which invert the default: it is
what keeps `strict` usable and the explorer subagent functional. Judge an
addition to it by that standard, not by what it does under `auto`, where it does
nothing.

### The strict profile

`createStrictPolicy(source)` (`packages/agent/policy/strict-policy.ts`) derives
the profile a `strict` session runs under. `defaultAction` is `ask`:

- the write-class and network-class families are named as `ask` rules, so a
  pause says *why* rather than "no rule matched". They are the same families the
  read-only profile denies, defined once in `write-class-commands.ts`;
- every source `deny` stays a `deny`, and every source `ask` keeps its own rule
  id, so the audit trail is continuous with `auto`;
- a source `allow` rule with a `write`, `network`, `destructive`, or `credential`
  capability is demoted to `ask`;
- `write`, `edit`, and `web_fetch` get explicit `allow` rules — see "What
  `strict` does not do" above.

### The read-only profile

`createReadOnlyPolicy(source)` derives a profile in which `defaultAction` is
`deny`: only explicitly permitted read-only commands run, and anything
unrecognised is denied. It denies the same write-class families the strict
profile gates (redirection, `sed -i`, `mv`/`cp`/`rm`/`mkdir`/`touch`/`chmod`/
`tee`/…, `find -exec`, write-class git subcommands, network binaries — one
table, `write-class-commands.ts`) and promotes the source policy's
forbidden-capability rules to denials.

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
refuse (`missing-policy`); `read`/`grep`/`glob` proceed. With a policy but **no
approval gate**, an `ask` refuses too (`approval-not-verified`, gate code
`no_gate`) — see [Approvals](#approvals). A call the policy allows outright never
reaches the gate, so a caller that forgot to wire one loses its gated commands,
not its agent.

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

**A missing gate is a refusal, not a pass.** `verifyApprovalRecord()` used to
authorize when no gate was wired, on the grounds that the SDK's own pause was
then the only gate — which is what the product did before approval records
existed. But that made "an `ask` is backed by a server-side record" a property of
the one call site that wires a gate rather than of the enforcement point: a new
entry point could supply `policy`, forget `approvalGate`, and silently drop back
to the client-asserted flow with nothing failing, while the *missing-policy* case
next to it refused loudly. It now refuses with the code `no_gate`, and the
refusal is written to `policy_event` like any other. `buildRunPolicyOptions()` is
the only production assembler of a policy context and always wires a gate, so
nothing shipped changes behaviour.

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
the shipped policy must produce under each posture. It is the regression test for
`default-policy.ts` and `strict-policy.ts`, run by `bun run ci`. Rule lists
drift; corpora catch the drift.

**Each posture is evaluated against the profile it really runs** — the `strict`
column against the strict profile, the other two against the baseline, exactly as
`resolveSessionPolicy()` wires them. This matters more than it sounds: while
`strict` and `auto` produced identical decisions, all 87 entries agreed with
themselves in both columns and the corpus could not have noticed that `strict`
had no teeth. A test now requires that a good number of entries diverge.

An entry:

```ts
{
  command: "git push --force origin main",
  rule: "bash.deny.force-push-default-branch",   // optional, pins the rule under auto
  strictRule: "strict.ask.git-write",             // optional, pins it under strict
  note: "Force-push to the default branch",       // read this before changing an expectation
  tags: ["deny"],
  expected: deny,                                 // deny/ask/allow/strictGates shorthand
}
```

Adding a rule? **Add the commands it is meant to catch, and at least one
neighbouring command it must NOT catch.** The near-miss is the half that catches
over-broad patterns.

`golden-corpus.test.ts` enforces more than the per-entry expectations:

- every bash rule id in **each posture's profile** must be decided by at least
  one entry under that posture (`uncovered` must be empty) — so a new rule
  without corpus coverage fails CI, in the baseline and in the strict profile
  alike;
- at least ten entries must decide differently under `strict` than under `auto`;
- every tag in `CorpusTag` must appear somewhere, which forces coverage of the
  parser edge cases (`chained`, `nested-shell`, `substitution`, `quoting`,
  `heredoc`, `env-prefix`, `redirect`, `unknown`, `wrapper`) and of `strict`;
- the posture invariants above, over every entry;
- no `legacy`-tagged entry is `allow` under `auto`.

`absorbed-denylist.test.ts` pins the same invariant at the command level:
nothing the pre-policy bash denylist gated is `allow` under `auto`, and its near
misses still are.

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
- **The baseline's `defaultAction` is `allow`.** Under `auto` and `dangerous`,
  `git reset --hard`, `chmod -R 777 /`, and any unrecognised binary run without a
  prompt. Under `strict` they ask — that is the whole difference between the
  postures, and it is a property of the *profile*, not of the posture flag.
- **A command invoked through a path is not recognised as that command.**
  `/usr/bin/npm install` falls to the default; `npm install` and
  `/usr/bin/env npm install` both ask. Stripping the directory would also let a
  local script named `cat` or `ls` inherit an allow rule, which is the worse
  trade. Wrappers *are* matched by basename, which is why the `env` form works.
- **Any interpreter defeats the parse.** `node -e '…execSync("git push --force
  origin main")'` evaluates to `allow`. The parser reads shell structure, not
  program semantics.
- **`eval` and base64 pipelines are gated, not solved.** They resolve to `ask`
  under `strict`/`auto` — and therefore to `allow` under `dangerous`.
