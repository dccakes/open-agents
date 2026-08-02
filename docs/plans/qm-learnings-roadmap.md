# QM Learnings → QuackOps Roadmap

A high-level improvement plan for QuackOps ("Open Agents") based on a structured review of
[yc-software/qm](https://github.com/yc-software/qm), mapped against our two strategic goals.

## Our goals

1. **Agentic development infrastructure.** Agents that run development tasks for the business:
   spin up VMs, access org repos, link to Linear, PostHog, Grafana, and similar tools so the
   agent has real operational context. We drive this with our own programming harness.
2. **Org-wide memory & query surface.** A central place anyone in the org can open and ask
   questions about our data, customers, and structure — with agents reading only
   **pre-approved** sections of that data, backed by one or more connected tools.

## Where QuackOps stands today

- Turborepo + Bun monorepo: `apps/web` (Next.js, Better Auth, chat UI, durable Workflow SDK
  execution), `packages/agent` (`ToolLoopAgent`, tools, explorer/executor/design subagents,
  skills loader), `packages/sandbox` (Vercel, Docker, Daytona providers).
- GitHub + Linear integrations exist in `apps/web/lib` (webhooks, issues, PR/deployment
  polling, auto-commit, diffs).
- Agent runs *outside* the sandbox and drives it via tool calls — a deliberate design we keep.
- Spec-driven change process via `openspec/`; agent norms in `AGENTS.md` + `docs/agents/`.

Goal 1 is roughly 60% scaffolded. Goal 2 is greenfield — but several primitives it needs
(scopes, ACLs, connectors, memory) also strengthen Goal 1, so they anchor the ordering below.

## What QM taught us (condensed)

QM is a multiplayer agent platform (Slack + web) where every user/room gets an isolated,
durable "computer": memory, files, keychain, permissions, crons, sandbox. The transferable
ideas, mapped to our gaps:

| QM concept | What it is | Relevance to us |
| --- | --- | --- |
| **Scopes** | Per-user/per-room isolation unit owning memory, files, credentials, grants | The core primitive both our goals need; we currently only have per-chat sessions |
| **Grant-based ACL store** | Explicit grants decide what a scope can read/do | This *is* the "pre-approved sections" mechanism for org memory |
| **Security postures** | Named modes — Strict / Auto / Dangerous — plus a predeclared command policy governing approval vs. auto-run vs. screening | We have no formal approval model; dev agents touching prod-adjacent systems need one |
| **Connector framework + keychain** | OAuth/browser-session connectors with encrypted per-scope credentials | Generalizes our hardwired GitHub/Linear integrations; needed for PostHog/Grafana/CRM/Drive |
| **Harness adapters** | `src/harness/` strategy adapters (claude/codex/opencode/mock) over one core | Lets our platform drive Claude Code/Codex CLIs in-sandbox alongside our own ToolLoopAgent |
| **Durable sandboxes** | Persistent per-scope machines (Fly microVM `$HOME` volume); installed tools survive | Our sandboxes are ephemeral per-session; durable per-repo/per-team computers cut setup cost |
| **Memory subsystem** | `memory/` with pluggable strategies, notebook-style | Foundation of "central org memory" |
| **Skills as product** | `skills-seed/` library of end-user skills admins grant to scopes; skill signing | Our skills loader exists; the grant/distribution model is the missing half |
| **Config boundary** | All env access via `config.ts`; ESLint rule bans `process.env` elsewhere | Cheap discipline win, enforceable today |
| **Supply-chain cooldown** | `.npmrc min-release-age=7` | Bun equivalent: `minimumReleaseAge` in `bunfig.toml` |
| **CI boots the deploy artifact** | Every plugin's prod Docker image is built *and booted* as a CI smoke test; sharded tests; real Postgres service in CI | Catches build/runtime drift our typecheck+tests miss |
| **Store pattern** | `x-store.ts` + `postgres-x-store.ts` + memory variant colocated | Testable swappable backends without a repository-layer ceremony |
| **Threat-model SECURITY.md** | Explicit assets, trust boundaries, candid known-limitations list | Required reading once org data flows through agents |

Things we reviewed and should **not** copy: QM's no-workspaces package isolation (our
Turborepo workspace graph is better for us), npm/Node-native tooling (we're Bun end-to-end),
their flat 370-file `test/` directory (our colocated tests are easier to navigate), and the
zero-comments rule (our existing style guidance is sufficient).

## Recommended plan, in order

### Phase 0 — Foundation hardening (days, do immediately)

Cheap, independent, and everything later stands on it.

1. **Config boundary**: consolidate env access behind one Zod-validated config module per
   package; add the oxlint/ESLint restriction banning raw `process.env` elsewhere.
2. **Supply-chain cooldown**: set `install.minimumReleaseAge` (7 days) in `bunfig.toml`.
3. **Dead-code detection**: add knip to `bun run ci`.
4. **CI smoke-boots the artifact**: build the production web bundle (and Docker sandbox
   image) in CI and boot it, not just typecheck/test.
5. **SECURITY.md with a real threat model**: assets, trust boundaries, known limitations —
   written before org data is wired in, not after.

### Phase 1 — Dev-agent depth (Goal 1) (weeks)

Make the existing coding agent genuinely production-useful.

0. **Org settings & roles**: membership gate first (sign-up is open today — anyone with a
   GitHub account becomes a signed-in user; domain allowlist + admin approval closes
   that), then an org settings entity with a global agent kill switch and daily budget,
   an `admin`/`member` role (extending the existing `isAdmin` flag), admin-only
   management of integrations (Linear/GitHub connections, repo mappings, observability
   tokens, sandbox providers), and soft-delete + confirmation + audit events on
   destructive config actions so no developer can accidentally disconnect a shared
   integration. Deliberately thin; Phase 2 generalizes it into scopes and grants.
1. **Command policy + security postures + run budgets**: predeclared allow/deny/approve
   rules for sandbox commands and tool calls, with named postures (strict = human
   approves side effects, auto = screened, dangerous = dev-only), enforced in the shared
   tool factories so subagents inherit it, covering app-level pushes (auto-commit) too.
   Surfaced in the chat UI as approval prompts. Plus per-run token/step budgets and
   per-run cost attribution — unattended runs without spend caps is the cost-runaway
   scenario. Includes a policy golden-test corpus in CI.
2. **Observability context tools**: read-only agent tools for PostHog (queries/insights),
   Grafana, and Sentry so dev agents diagnose with real telemetry — behind an
   admin-defined data allowlist (the primitive that grows into Phase 2 grants), with
   PII redaction and untrusted-data framing. Start hardwired like Linear is today;
   migrate onto the Phase 2 connector framework later.
3. **Linear-driven runs**: extend the existing webhook handling so a labeled Linear issue can
   trigger an agent run end-to-end (issue → branch → PR → status sync back to Linear),
   running under a designated org agent identity (never the delegating user's
   credentials), with race-safe idempotency and every failure visible in Linear.
4. **Durable sandboxes**: add a persistent-workspace mode to `packages/sandbox` (per-repo
   machines that keep clones, deps, and installed tooling warm between runs) — per-user
   by default, since warm state is executable and shared caches are a credential-theft
   channel.
5. **Platform ops**: Sentry on the platform itself (it has zero self-instrumentation
   today), an admin dashboard of running sessions + spend, failure alerting, orphaned-
   sandbox cleanup, and an incident runbook — prerequisites for trusting unattended runs.

### Phase 1.5 — Goal-2 MVP: "Ask NextDegree" thin slice (days–week, between phases)

Goal 2 otherwise gets nothing until after Phase 2 — a full quarter of silence on half
our strategy, with Phase 2's architecture investment resting on an unvalidated
hypothesis. A thin MVP is safe *without* the scope/grant/keychain machinery precisely
because it has no execution surface:

1. **Read-only query agent**: explorer-style profile, no bash, no sandbox, no write
   tools, no egress — only the WS-1.2 observability clients + Linear reads.
2. **Hardcoded allowlist standing in for grants**: the WS-1.2 data allowlist config is
   the entire ACL; nothing dynamic to build.
3. **One shared page** ("Ask NextDegree") available to approved members.

What it buys: real usage data on whether people ask, what they ask, and which sources
matter — *before* weeks are invested in Phase 2. Exit criterion for Phase 2 planning:
re-justify each Phase 2 primitive against what the MVP actually needed.

### Phase 2 — Platform primitives shared by both goals (weeks, the pivotal phase)

This is the QM-shaped core that turns a coding agent into org infrastructure.

1. **Scope model**: a first-class `scope` (user, team, project) in the schema owning
   sessions, memory, files, credentials, and grants — generalizing Phase 1's org
   settings singleton and admin/member roles into per-scope membership and grants.
2. **Grant-based ACL store**: explicit, auditable grants (`scope × resource × capability`),
   with the memory/postgres store pattern for testability. Admin UI for granting.
3. **Connector framework + keychain**: one abstraction for OAuth-style connectors with
   encrypted per-scope credentials; port GitHub/Linear onto it, add PostHog/Grafana, then
   Goal-2 sources (Drive, Notion, CRM, warehouse).
4. **Memory subsystem**: per-scope persistent memory with pluggable strategies in
   `packages/agent` — used first by dev agents (repo/project knowledge), then as the organ
   of org memory.
5. **Audit log**: every tool call, grant use, and credential access recorded per scope.
6. **Retention & deletion**: account deletion (no path exists today — only unreferenced
   cascade FKs), transcript TTL policy in org settings, audit-log retention. Must land
   before Phase 3 stores cross-user org memory; and Phase 3 memory entries must carry
   source/user provenance from day one so deletion requests are executable.
7. **Agent eval harness**: recorded-fixture scenario runs with a tracked pass rate,
   triggered on prompt/policy/default-model changes — Phase 1's policy golden corpus
   covers commands, but nothing yet catches "this prompt tweak degraded task success."
   Existential by Phase 3, where answer correctness is the product.

### Phase 3 — Org memory & query surface (Goal 2) (weeks, after Phase 2)

1. **Query agent**: a read-only agent profile (explorer-style) whose only tools are
   grant-filtered connector reads + memory search. No bash, no write, no egress.
2. **Pre-approved data sections**: admins define readable slices per connector (e.g. "CRM:
   accounts + notes, not contacts' PII") as grants; the agent physically cannot exceed them.
3. **Org memory surface**: a shared org/team scope in the web UI ("Ask NextDegree");
   ingestion/refresh of curated sources into memory via scheduled runs.
4. **Answer provenance**: every answer cites which grant/source it came from — this is what
   makes pre-approval trustworthy and auditable.

### Phase 4 — Multiplayer & harness maturity (later)

1. **Harness adapter layer**: run Claude Code / Codex CLIs inside the durable sandbox as
   alternative harnesses behind one interface, alongside our ToolLoopAgent (QM's
   `harness/` pattern) — this is how we "build our own harness" without betting on one loop.
2. **Skills as an org library**: a curated skills directory admins grant to scopes,
   with signing/locking (we already have `skills-lock.json` as a seed of this idea).
3. **Crons & triggers**: scheduled scope-level runs (digests, monitors, report refreshes).
4. **Slack surface**: meet users where they are once the web surface proves the model.

## Sequencing rationale

- Phase 0 is risk-free and immediately raises the floor.
- Phase 1 before Phase 2 because Goal 1 delivers visible value with what we already have —
  policy + telemetry context are the two things blocking real business use of dev agents.
- Phase 1.5 exists so Goal 2 ships a validating slice before Phase 2's architecture bet —
  a query agent with no execution surface doesn't need the full ACL machinery to be safe.
- Phase 2 before Phase 3 because "pre-approved data access" is an *architecture*, not a
  feature: bolting ACLs onto an org-memory product afterwards is how leaks happen. QM's
  design (scopes + grants + keychain underneath everything) is the single biggest lesson.
- Phase 4 last: multiplayer surfaces and multi-harness only pay off once scopes, grants,
  and memory exist for them to plug into.
