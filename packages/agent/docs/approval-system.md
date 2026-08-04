# Tool Approval and Policy Enforcement

How `packages/agent` decides whether a tool call may run, and where that decision
is made.

> This document previously described a prefix allowlist of "safe commands" and a
> rule that gated any command whose `cwd` escaped the working directory. Neither
> was ever implemented in `tools/bash.ts` — what existed was a five-entry regex
> denylist, and `cwd` was not checked at all. The system described below is the
> one that exists. For the product-level view (postures, approvals, budgets) see
> [`docs/policy-and-postures.md`](../../../docs/policy-and-postures.md).

## What decides

`packages/agent/policy/` holds a pure evaluator. `evaluate(toolCall, policy,
posture)` (`policy/command-policy.ts`) takes the policy-relevant projection of a
tool call — the tool name plus a `command` (bash) or a `target` (a path or URL) —
and returns a `PolicyDecision` with an `action` of `allow`, `ask`, or `deny`.

It performs no I/O. That is what lets the same function run from `needsApproval`
and from `execute`, and it is what the `< 5 ms p95` benchmark in
`policy/policy-latency.test.ts` measures.

For `bash`, the command is first segmented by `policy/command-parser.ts` — a
hand-written, quote-aware scanner that splits on `&&`, `||`, `;`, `|`, `&`, and
newlines, descends into `$(...)`, backticks, and `sh -c` / `bash -c` string
arguments, strips leading `VAR=value` assignments, and treats heredoc bodies as
data. Every segment is evaluated, and the most restrictive segment decision wins.
Input the scanner cannot parse confidently yields the `unknown` outcome, which
resolves to `ask` under `strict` and `auto`.

Precedence within a policy is **deny → ask → allow**, first match within a class.
Posture is applied last and can only relax `ask` (never `deny`) — see
[`docs/policy-and-postures.md`](../../../docs/policy-and-postures.md) for the
rule classes, the shipped baseline, and the golden corpus.

## Where it is enforced

In the **tool factories** (`tools/policy-enforcement.ts`), not in a wrapper
around any agent's dispatch. There are four `ToolLoopAgent` instances in this
package and three of them build their own tools (`open-agent.ts`,
`subagents/explorer.ts`, `subagents/executor.ts`, `subagents/design.ts`), so a
loop-level wrapper would cover exactly one of them. Enforcing in the factory
means every present and future constructor of a bash tool is policed by
construction.

Two hooks with two different jobs:

| Hook | Helper | What it can do |
| --- | --- | --- |
| `needsApproval` | `requestPolicyApproval()` | Pause. It cannot refuse — the AI SDK gives it two outcomes, pause or proceed. |
| `execute` | `enforcePolicyWithApproval()` | Refuse. It is the authoritative gate. |

`execute` **re-evaluates the policy** rather than trusting that a pause happened.
A rule that became a denial between the pause and the resume still refuses, and a
replayed approved call is checked again from scratch.

A refusal is a structured tool *result*, never a thrown error:

```ts
{
  success: false,
  refusedByPolicy: true,          // discriminator: policy, not tool failure
  error: "The bash tool refused this call: ...",
  policy: { tool, decision, rule, reason, posture },
}
```

The model reads it as ordinary tool output and can route around it.
`isPolicyRefusal()` narrows it.

### Per-tool wiring

| Tool | `needsApproval` | `execute` |
| --- | --- | --- |
| `bash` | Policy `ask`, else the pre-policy answer when nothing is wired | Policy + approval record, then the `cwd` containment rule |
| `write`, `edit` | Dotenv pause (predates policy), then policy `ask`; existing `realpath` workspace probe unchanged | Policy + approval record, then the existing workspace and dotenv checks |
| `web_fetch` | `true` unconditionally (predates policy) | Policy + approval record, then the existing SSRF/private-host checks |
| `read`, `grep`, `glob` | unchanged | unchanged — read-only tools are not policed |

Policy is added *alongside* the dotenv, workspace-containment, and SSRF checks,
not in place of them.

The bash `cwd` argument is handled by `tools/bash-working-directory.ts` and
refused through `refuseWithRule()` under the id `bash.deny.cwd-outside-workspace`,
so it produces the same refusal shape and the same audit record as a policy
denial. It is a containment rule, not a command pattern, which is why it does not
live in the rule lists.

## How the policy reaches a tool

On `experimental_context`, the same channel `sandbox` and `model` already travel
on. `AgentContext.policy` (`types.ts`) holds an `AgentPolicyContext`:

```ts
interface AgentPolicyContext {
  policy: CommandPolicy;
  posture: Posture;
  approvalGate?: ApprovalGate;      // host-injected; see below
  interactive?: boolean;            // false inside a subagent
  recorder?: PolicyEventRecorder;   // host-injected; no-op by default
}
```

Agents accept the host's half of this in their call options
(`policy/call-options.ts`: `policy`, `posture`, `policyEventRecorder`,
`approvalGate`) and `resolvePolicyContext()` assembles the context in
`prepareCall`. An agent always puts *a* policy on the context — the fallback is
the shipped baseline under `auto`, which is exactly the behaviour that existed
before postures did.

Retrieval is `getPolicy(experimental_context)` in `tools/utils.ts`.

### Fail-closed

If no policy is on the context, `bash`, `write`, `edit`, and `web_fetch` refuse
with a `missing-policy` refusal. `read`, `grep`, and `glob` proceed. An absent
policy means a caller was not wired, which is exactly the failure this module
exists to prevent; read-only tools are exempted so a wiring bug degrades to a
crippled-but-safe agent rather than a dead one.

## Subagents

Each subagent's `prepareCall` builds a **fresh** `experimental_context`, so
policy does not propagate implicitly — every subagent has to be wired
(`subagents/prepare-call.ts` does this centrally, and `subagents/registry.test.ts`
asserts it over `SUBAGENT_REGISTRY`, so a fourth subagent added without the
wiring fails CI).

`toSubagentPolicyContext()` (`subagents/policy-context.ts`) narrows the session's
context and can only ever narrow it:

- **Non-interactive.** A subagent runs inside `taskTool.execute`, whose stream
  handler forwards only `tool-call` and `finish-step` parts. There is no channel
  to a UI, so a pause would hang the parent tool call rather than prompt anyone.
  An `ask` therefore resolves to an `approval-unavailable` refusal that names the
  missing approver, and the parent — which does have one — may attempt the
  operation itself.
- **Profile.** `explorer` runs under `createReadOnlyPolicy()` derived from the
  session's own policy. Its read-only contract is enforced by the profile, not by
  its tool list: it has no `write`/`edit` tool, but its `bash` could otherwise
  redirect, `sed -i`, or `npm install`. Its prompt says the restriction is
  enforced so the model does not waste steps attempting denied writes.

`executor` and `design` inherit the session's policy unchanged, minus
interactivity.

## Approvals

The agent package can decide *whether* approval is needed. It can never decide
whether one was *granted* — the record lives in a database this package cannot
reach. `policy/approval-gate.ts` declares the seam:

- `request(...)` runs from `needsApproval`, **before** the SDK pauses, so the
  pause the user sees has a row behind it that can expire, be attributed, and be
  spent once.
- `verify(...)` runs from `execute`, **after** policy has been re-evaluated, and
  is what authorizes the call. Its refusal becomes the tool's result.

A gate is optional. Without one, the SDK's own pause is the only gate — the
pre-record behaviour, so a host that has not wired one keeps working. A gate that
*fails* refuses (`unavailable`); an absent gate authorizes. Those are different
situations and are treated differently on purpose.

Order in `enforcePolicyWithApproval()` matters: policy is re-evaluated first, so
a rule that became a denial after the approval was granted still refuses; only
then is the approval spent, and only when the decision is actually `ask`.

## Audit

`ask` and `deny` decisions are handed to the context's `PolicyEventRecorder`.
Recording is fire-and-forget and best-effort: a recorder that is slow or broken
must never change what a tool does. Everything derived from model-supplied text
passes through `policy/redact.ts` first, which is eager by design — a denied
command is exactly the kind of command most likely to contain a credential.

The package ships `noopPolicyEventRecorder`; the host injects a real one.

## Compatibility

`commandNeedsApproval()` is still exported from `tools/index.ts` and
`tools/bash.ts`, but it is now a thin wrapper over `evaluate()` against
`legacyApprovalPolicy` (`policy/legacy-approval.ts`) — the absorbed pre-policy
regexes, kept as their own rule list so the wrapper reproduces exactly the old
answer. It cannot express `deny`, has no posture, and knows nothing about the
baseline's rules for pushes, publishes, and installs. New code should call
`evaluate()`.

## Key files

| File | Purpose |
| --- | --- |
| `policy/types.ts` | Zod schemas for rules, postures, decisions; types via `z.infer` |
| `policy/command-parser.ts` | Quote-aware bash segmenter |
| `policy/command-policy.ts` | `evaluate()` — precedence, segment merge, posture |
| `policy/default-policy.ts` | The shipped baseline, including the absorbed legacy rules |
| `policy/read-only-policy.ts` | `createReadOnlyPolicy()` and the derived profile |
| `policy/execution-context.ts` | `AgentPolicyContext`, policy events, recorder seam |
| `policy/approval-gate.ts` | `ApprovalGate` seam and its fail-closed wrappers |
| `policy/call-options.ts` | The policy fields every agent accepts, and their assembly |
| `policy/golden-corpus.ts` | Command → expected decision per posture |
| `policy/legacy-approval.ts` | `commandNeedsApproval()` compatibility wrapper |
| `tools/policy-enforcement.ts` | The enforcement point both hooks call |
| `tools/bash-working-directory.ts` | The bash `cwd` containment rule |
| `subagents/policy-context.ts` | Narrowing the context for a subagent |
