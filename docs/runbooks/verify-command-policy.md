# Verifying the command policy and security postures

How to check that WS-1.1 actually works. Written because everything in that
change is covered by automated tests and none of it had been driven by a human
through a live session — and the one defect that mattered most (approving a
gated command did nothing, so the resume was refused) survived five task groups
of green CI before a review caught it. Unit tests could not see it because the
break was at the seam between two halves that were each tested in isolation.

Work down the tiers. Tier 0 needs nothing, tier 1 needs the app, tier 2 needs a
sandbox and a repo. Stop at the tier that answers your question.

---

## Tier 0 — the policy itself, no app required

Policy evaluation is a pure function: no database, no sandbox, no model. So the
entire decision surface is checkable in milliseconds.

```bash
bun run policy:check                                  # a representative sample
bun run policy:check "git push origin main" "rm -rf ~"   # your own commands
```

The output is a decision per posture, plus what the read-only explorer subagent
would do. What you should see, and what each column means:

| | meaning |
|---|---|
| `allow` | runs with no interruption |
| `ask` | pauses the run for approval |
| `deny` | refused outright — **no posture can override this** |

Things worth confirming yourself, because they are the load-bearing claims:

- `git reset --hard HEAD~1` and `chmod -R 777 .` are `ask` under `strict` and
  `allow` under `auto`. That difference is the entire point of `strict`; before
  it was fixed the two postures produced identical decisions everywhere.
- `rm -rf /` and `git push --force origin main` are `deny` in **all three**
  columns, including `dangerous`.
- `sudo npm install` matches the same rule as `npm install`. A wrapper must not
  launder a command past a rule.
- `ls -la` and `git status` are `allow` under `strict`. A `strict` posture that
  prompts on everything is one nobody turns on.
- The explorer column is `deny` for anything that writes, installs, or reaches
  the network. `bun test` denies there too — running the project's test suite
  executes arbitrary project code, which is not read-only.

Also worth running once, since it is the regression net for all of the above:

```bash
bun test packages/agent/policy/golden-corpus.test.ts
```

It asserts every rule in the baseline is the reported cause of at least one
corpus entry, so a rule that gets deleted or shadowed by another fails CI rather
than silently ceasing to apply.

---

## Tier 1 — postures and approvals in the running app

```bash
bash scripts/dev-setup.sh   # Docker Postgres + apps/web/.env.local defaults
bun install
bun run web
```

You need a model provider key in `apps/web/.env.local` for the agent to run at
all. The policy variables are all optional and default sensibly — set them only
to test the budget paths:

```env
AGENT_RUN_STEP_BUDGET=3          # a run that halts quickly, for tier 2
AGENT_APPROVAL_TIMEOUT_HOURS=24  # default; lower it to test expiry
# AGENT_RUN_TOKEN_BUDGET is unset by default, meaning unlimited
```

### 1. The posture selector

Open a session. The posture control is in the session header.

- Switching between `strict` and `auto` should need no special permission.
- `dangerous` should **not** be offered unless your user holds
  `posture.setDangerous` (org `admin` or `owner`).
- Changing it in the header should immediately change the posture named in any
  tool-approval prompt in the transcript. If the header says `strict` and a
  prompt still says "Paused by the auto posture", that is a regression — the two
  used to hold separate state.

Then confirm the server does not trust the client: with a `member` account, send
the posture change directly and expect **403**, not success.

```bash
curl -X PATCH localhost:3000/api/sessions/<sessionId>/posture \
  -H 'content-type: application/json' -d '{"posture":"dangerous"}'
```

### 2. The approval loop — the one that was broken

In an `auto` session, ask the agent to run something that asks. `npm install` or
`git push` will do; check with `bun run policy:check` first if unsure.

Expected: the run pauses with an approve/deny prompt naming the tool, the exact
command, the matching rule, and the posture.

- **Approve** → the command runs and the session continues. This is the case that
  was broken: it used to fail with a 403 and `approval_not_verified`.
- **Deny** → the command does not run, the model receives a structured refusal
  as the tool result, and it carries on rather than erroring out.

Then verify the decision is a server-side fact, not a browser claim:

```sql
select tool_name, decision, decided_by, consumed_at, expires_at
from approval order by created_at desc limit 5;
```

A granted approval should be `approved` with your user id in `decided_by` and a
`consumed_at` set once the command ran. **`consumed_at` is what makes approvals
single-use** — replaying the same request must not run the command a second
time.

### 3. Denials are refusals, not crashes

In an `auto` session, ask for an `rm -rf ~` variant. It should be refused with no
prompt at all, the model should receive the refusal and continue, and the run
should not be marked failed. Then check it was recorded:

```sql
select tool_name, decision, matched_rule, posture from policy_event
order by created_at desc limit 5;
```

Confirm the `input_summary` contains no credential-shaped strings — that table
is redacted on write.

### 4. Subagents inherit the posture

Ask the agent to delegate something to the explorer subagent that would require
a write ("use the explorer to fix the typo in README.md"). The explorer must
refuse — its read-only profile is enforced now, not merely asserted in its
prompt — and the refusal should surface to the parent agent, which may then do
the work itself. Crucially the parent must **not** hang: a subagent has no way
to prompt anyone, so an `ask` inside one resolves to a denial rather than a
pause.

---

## Tier 2 — sandbox and repo

These need a session bound to a real repository.

### 5. No push reaches GitHub without approval under `strict`

There are two independent paths that push, and both must be gated:

- **Through the agent**: ask it to `git push`. Expect a pause.
- **Through the app**: auto-commit and auto-PR run *after* the agent loop ends,
  from the web app's own scoped installation token — not through tool dispatch
  at all. In a `strict` session, finishing a turn with uncommitted changes should
  surface a pending approval on the run rather than pushing.

Approve it and the commit is made; deny it and the run reports it was skipped by
policy. In an `auto` session both should behave exactly as they did before this
change — that is the compatibility claim worth checking.

### 6. Budget halt

Set `AGENT_RUN_STEP_BUDGET=3`, restart, and give the agent a task needing more
steps. The run should stop in a visible `budget-exceeded` state naming which
budget was exceeded — not a generic failure — and the assistant output produced
before the halt should still be there.

```sql
select status, halt_reason, step_count, input_tokens, output_tokens
from workflow_runs order by started_at desc limit 3;
```

### 7. Approval survives sandbox hibernation

The slowest check, and the one most worth doing once. Trigger an approval, leave
it more than 30 minutes so the sandbox hibernates
(`SANDBOX_INACTIVITY_TIMEOUT_MS`), then approve. The sandbox should reprovision
and the command should execute.

This works because the workflow *ends* rather than parks on a pause, so a resume
is an ordinary new run that re-enters the existing provisioning path. Note what
is not promised: the sandbox is restored or reprovisioned, so a command whose
meaning depended on transient in-sandbox state (a background process, an unsaved
file) may execute against different state than when it was proposed.

---

## What is already covered, and needs no manual pass

Do not spend time re-checking these by hand; they fail CI if broken:

- Every rule class, parser edge case, and posture interaction — the golden
  corpus, which is mutation-checked (flipping `curl | sh` to `allow` produces
  failures).
- Policy evaluation latency against its 5 ms p95 budget.
- Every registered subagent threading policy — a fourth one added unwired fails
  the registry conformance test.
- Forged approval claims, replay after consumption, expired approvals,
  unauthorized deciders.
- That workflow modules do not statically import anything reaching
  `lib/db/client` or the AI SDK. Note this one is caught by
  `bun run --cwd apps/web build`, **not** by `bun run ci` — `ci` does not run
  `next build`, which is how one such breach reached a deploy.

## What this system does not protect against

Read [`SECURITY.md`](../../SECURITY.md) before describing the agent as
contained. In short: the policy is pattern-based and bypassable by construction
— `eval`, base64 pipelines, and any interpreter defeat a static parse — and the
sandbox still holds a GitHub push token and has open egress. Policy reduces the
probability of a bad command; it does not reduce the blast radius of one that
gets through.
