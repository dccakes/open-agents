import { defaultCommandPolicy } from "./default-policy";
import type { CommandPolicy, PolicyRule, RuleCapability } from "./types";
import { WRITE_CLASS_COMMANDS } from "./write-class-commands";

/**
 * The strict policy profile.
 *
 * `strict` used to be indistinguishable from `auto` at the rule layer:
 * `applyPosture` treats them identically, and under a baseline whose
 * `defaultAction` is `allow`, "every `ask` pauses" is a promise `auto` already
 * kept. `git reset --hard`, `chmod -R 777 .`, `rm -r subdir`, `mv`, and
 * `truncate` all ran unprompted in a `strict` session.
 *
 * This is the profile that gives the posture teeth, and it is derived rather
 * than written out — the same way `createReadOnlyPolicy` derives its profile —
 * so a rule added to the baseline is covered here without a second edit:
 *
 * - `defaultAction` becomes `ask`: anything the policy does not recognise as
 *   safe is put to a human.
 * - the write-class and network-class families (`write-class-commands.ts`) are
 *   named as `ask` rules, so a pause says *why* rather than "no rule matched".
 * - every source `deny` stays a `deny`, and every source `ask` keeps its own
 *   rule id, so the audit trail is continuous with `auto`.
 * - a source `allow` rule with a gated capability is demoted to `ask`, which is
 *   the capability-driven half: an allow rule added to the baseline for a
 *   write- or network-class command does not silently widen `strict`.
 *
 * The allow list finally does work here. Under a default-allow baseline an
 * allow rule can never change an outcome; under this profile it is what keeps
 * read-only inspection and build/test/lint/typecheck unprompted. An unusable
 * `strict` is a `strict` nobody turns on.
 *
 * What `strict` deliberately does *not* gate: individual `write`/`edit` calls
 * inside the workspace (a single coding task issues dozens) and `web_fetch`,
 * which already pauses unconditionally through its own gate. See design.md
 * decision 17.
 */

/** Capabilities `strict` will not allow a rule to grant outright. */
const GATED_CAPABILITIES: ReadonlySet<RuleCapability> = new Set([
  "write",
  "network",
  "destructive",
  "credential",
]);

const STRICT_ASK_RULES: PolicyRule[] = WRITE_CLASS_COMMANDS.map((command) => ({
  id: `strict.ask.${command.key}`,
  action: "ask",
  tool: "bash",
  pattern: command.pattern,
  capability: command.capability,
  reason: `The strict posture gates write-class commands and network egress: ${command.description}`,
}));

/**
 * The tools `strict` leaves exactly as `auto` has them.
 *
 * Without these the profile's `ask` default would reach every file write — and
 * `web_fetch`, whose unconditional `needsApproval: true` is not a policy `ask`
 * and so has no approval record for `execute` to verify, would be refused
 * outright rather than paused.
 */
const STRICT_ALLOW_RULES: PolicyRule[] = [
  {
    id: "strict.allow.workspace-write",
    action: "allow",
    tool: "write",
    capability: "write",
    reason:
      "Strict gates commands, network egress, and pushes — not individual file writes inside the workspace. The workspace-containment and dotenv checks apply in every posture.",
  },
  {
    id: "strict.allow.workspace-edit",
    action: "allow",
    tool: "edit",
    capability: "write",
    reason:
      "Strict gates commands, network egress, and pushes — not individual file edits inside the workspace. The workspace-containment and dotenv checks apply in every posture.",
  },
  {
    id: "strict.allow.web-fetch",
    action: "allow",
    tool: "web_fetch",
    capability: "network",
    reason:
      "web_fetch pauses for approval in every posture through its own unconditional gate, so strict does not add a second one.",
  },
];

function isGated(rule: PolicyRule): boolean {
  return GATED_CAPABILITIES.has(rule.capability);
}

function toAsk(rule: PolicyRule): PolicyRule {
  return {
    ...rule,
    action: "ask",
    reason: `${rule.reason} Under the strict posture it is gated rather than allowed.`,
  };
}

function deriveStrictPolicy(source: CommandPolicy): CommandPolicy {
  const demoted = source.allow.filter(isGated).map(toAsk);

  return {
    id: `${source.id}.strict`,
    description: `Strict profile derived from the "${source.id}" policy: write-class commands, network egress, and anything unrecognised are gated, while read-only inspection and build/test work still run unprompted.`,
    deny: source.deny,
    // Source asks first, so a command both classes describe keeps the rule id
    // it has under `auto` and the audit trail stays continuous.
    ask: [...source.ask, ...STRICT_ASK_RULES, ...demoted],
    allow: [
      ...source.allow.filter((rule) => !isGated(rule)),
      ...STRICT_ALLOW_RULES,
    ],
    defaultAction: "ask",
    defaultReason:
      "The strict posture gates every command the policy does not recognise as read-only inspection or ordinary build, test, and lint work.",
  };
}

/** Derivations are memoized by source identity; see `read-only-policy.ts`. */
const DERIVED = new WeakMap<CommandPolicy, CommandPolicy>();

/**
 * Derive a strict profile from a policy.
 *
 * The source is never mutated, and the derived profile is treated as a value:
 * callers that need to change one build a new policy from it.
 */
export function createStrictPolicy(source: CommandPolicy): CommandPolicy {
  const cached = DERIVED.get(source);
  if (cached) {
    return cached;
  }

  const derived = deriveStrictPolicy(source);
  DERIVED.set(source, derived);
  return derived;
}

/** The strict profile derived from the shipped baseline. */
export const strictPolicy: CommandPolicy =
  createStrictPolicy(defaultCommandPolicy);
