# Security

QuackOps runs an AI coding agent against a real repository, in a sandbox that
holds a real GitHub push token and has open network egress. This document states
what the system enforces and — more importantly — what it does not.

If you are deciding whether to give this agent access to something, read the
"Known limitations" section first.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner rather than in
a public issue. Include what you did, what happened, and what you expected.

---

## What is enforced

So a reader can calibrate: these are real controls, verified by tests that run in
`bun run ci`.

**Command policy.** Every `bash`, `write`, `edit`, and `web_fetch` call is
evaluated against a `CommandPolicy` under the session's posture before it runs
(`packages/agent/policy/`, enforced in `packages/agent/tools/policy-enforcement.ts`).
Compound commands are segmented — quote-aware, descending into `$(...)`,
backticks, and `sh -c` strings — and every segment is evaluated, with the most
restrictive result winning. Precedence is deny → ask → allow, so an allow rule
can never override a denial. Posture is applied last and can never relax a
`deny`.

**Enforcement point.** In the tool factories, not in a wrapper around the agent
loop, because three of the four `ToolLoopAgent`s build their own tools. Every
constructor of a bash tool is covered by construction. `execute` re-evaluates the
policy rather than trusting that an approval pause happened, so a rule that
becomes a denial between pause and resume still refuses.

**Fail-closed wiring.** A side-effecting tool that finds no policy on its
execution context refuses. Read-only tools (`read`, `grep`, `glob`) proceed, so a
wiring bug degrades to a crippled-but-safe agent rather than a dead one.

**Subagents.** Policy is threaded into `explorer`, `executor`, and `design`, and a
registry conformance test fails CI if a fourth subagent is added without it.
`explorer` runs under a read-only profile that denies by default; its "read-only"
is enforced, not asserted in a prompt.

**Approvals.** A policy `ask` is backed by a server-side `approval` row that is
authorized against the session, attributed to a `decidedBy`, expires (24 h by
default, computed on read in every environment), and is spent exactly once by a
compare-and-set. The approval state inside a client-supplied message body is an
assertion and is not trusted as authorization.

**Audit.** Every `ask` and every `deny` is written to the append-only
`policy_event` table, with model-supplied text redacted first. There is no update
or delete path.

**Budgets.** Each run is bounded by a step ceiling (default 500) and an optional
token ceiling, and the organization's daily token budget is checked at run start
and during the run. A breach halts in a distinct `budget-exceeded` state.

**Application-level side effects.** Auto-commit and auto-PR push to GitHub from
the web app, after the agent loop ends, through their own scoped installation
tokens. Under `strict` they are gated through the same approval mechanism. These
are the only two paths besides `bash` that push.

Details: [`docs/policy-and-postures.md`](docs/policy-and-postures.md).

---

## Known limitations

Stated plainly. None of these is a bug to be fixed by tightening a regex.

### The policy is pattern-based and bypassable by construction

It matches patterns against a **static parse** of a command string. The shell is
Turing-complete, and any construct that builds or interprets a command at runtime
defeats a static parse. This is not a gap in the rule list; it is a property of
the approach.

Concretely, against the shipped baseline:

- **`eval` and base64 pipelines.** `eval "$(printf …)"` and
  `echo <base64> | base64 -d | sh` are matched as *families* and resolve to `ask`
  — not `deny`, and therefore `allow` under the `dangerous` posture. The policy
  can see that something opaque is about to run; it cannot see what.
- **Any interpreter.** `node -e '…'`, `python3 -c '…'`, `perl -e '…'` and their
  relatives take code as an argument. The parser reads shell structure, not
  program semantics. `node -e 'require("child_process").execSync("git push
  --force origin main")'` evaluates to **allow** today, while the same push typed
  directly denies.
- **Anchored rules are defeated by a prefix.** Several `ask` rules anchor on the
  start of a segment. `npm install` asks; `sudo npm install` is allowed.
- **The baseline allows what it does not recognise.** `defaultAction` is `allow`.
  `git reset --hard`, `chmod -R 777 /`, and any unrecognised binary run without a
  prompt. The read-only profile inverts this (`defaultAction: deny`), but the
  baseline the main agent runs under does not.
- **Deliberate lines that are narrower than they sound.** `git push --force`
  denies only for `main`/`master`; force-pushing any other branch is `ask`. The
  read-only profile's redirection rule is a regex over segment text, so it
  over-matches — `echo "a > b"` and `grep -n '>' file` both deny. That fails
  closed, which is the right direction, but it is not precise analysis.

**Segmentation raises the cost of evasion; it does not eliminate it.** Before
this system, `ls; sh -c 'rm -rf /'` matched nothing because the regexes were
applied to the raw string. Now it denies. That is a real improvement and it is
the honest size of the improvement: a determined or adversarially-prompted model
can still express an intent the parser does not resolve.

### Policy reduces the probability of a bad command, not the blast radius

The sandbox is not contained. It holds a **real GitHub push token**
(`setGitHubAuthToken`, `packages/sandbox/git.ts`) and has **open network
egress**. There is no egress allowlist, no seccomp profile, and no per-run
credential scoping. If a command gets past the policy, nothing downstream stops
it from pushing or from reaching an arbitrary host.

So: the policy makes a destructive or exfiltrating command less likely to be
issued. It does nothing to limit what one can do once issued. Treat the sandbox
as holding credentials at their full scope.

### A screening classifier is future work

Nothing model-based inspects a command's intent before it runs. The only analysis
is the static parse plus the rule lists described above. A screening classifier —
a model asked "is this command going to do something the user did not ask for?" —
is a plausible next layer and is not implemented.

### Other things that are true and worth knowing

- **The policy baseline is code, not configuration.** It cannot be tightened per
  organization at runtime this phase. Changing it requires a deploy.
- **`dangerous` is a real escape hatch.** It turns every `ask` into `allow` for
  the whole session. It requires the `posture: ["setDangerous"]` permission and
  is refused for non-interactive triggers, but a permitted user can set it and
  every subsequent chat in that session inherits it.
- **The approval expiry sweeper is not scheduled.** The handler and its route
  exist; the repository has no cron wiring. Expiry is computed on read, in every
  environment, so the timeout holds — but expired rows are not materialized until
  something invokes the handler.
- **`policy_event` and `approval` records contain redacted command text.**
  Redaction is eager and pattern-based. Assume it is imperfect and treat the
  tables as sensitive.
- **Approval identifies a session and a command, not a sandbox state.** Because a
  run ends rather than parks while waiting, the resumed run may execute against a
  restored or reprovisioned sandbox. A command whose meaning depended on
  uncommitted in-sandbox state may not mean the same thing when it finally runs.
- **Concurrent runs can jointly overshoot the org daily token budget.** The daily
  figure is snapshotted at run start, so each concurrent run measures itself
  against the same baseline.
- **Prompt injection is not addressed here.** Repository contents, issue text,
  and fetched web pages all reach the model. The policy constrains what the model
  can *do* about what it reads; it does not stop it from being influenced.
