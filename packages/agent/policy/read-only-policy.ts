import { defaultCommandPolicy } from "./default-policy";
import type { CommandPolicy, PolicyRule, RuleCapability } from "./types";
import { WRITE_CLASS_COMMANDS } from "./write-class-commands";

/**
 * A read-only policy profile.
 *
 * The primitive behind "this agent may look but not touch": every write-class
 * and network-class decision becomes a denial, only genuinely read-only
 * commands are allowed, and anything unrecognised is denied rather than
 * allowed. The explorer subagent runs under this; observability and webhook
 * runs want the same shape.
 *
 * Note the profile is derived from a baseline rather than written out, so a
 * rule added to the baseline is covered here without a second edit.
 */

/** Capabilities that a read-only agent must not exercise. */
const FORBIDDEN_CAPABILITIES: ReadonlySet<RuleCapability> = new Set([
  "write",
  "network",
  "destructive",
  "credential",
]);

/**
 * Write- and network-class commands the baseline has no reason to mention —
 * it allows them by default, because for the main agent they are ordinary
 * work. A read-only profile has to name them, and so does the strict profile,
 * so the families themselves live in `write-class-commands.ts`.
 */
const READ_ONLY_DENY_RULES: PolicyRule[] = WRITE_CLASS_COMMANDS.map(
  (command) => ({
    id: `read-only.deny.${command.key}`,
    action: "deny",
    tool: "bash",
    pattern: command.pattern,
    capability: command.capability,
    reason: `This agent runs read-only: ${command.description}`,
  }),
);

function toDenial(rule: PolicyRule): PolicyRule {
  return {
    ...rule,
    action: "deny",
    reason: `${rule.reason} This agent runs read-only, so it is denied rather than gated.`,
  };
}

function isForbidden(rule: PolicyRule): boolean {
  return FORBIDDEN_CAPABILITIES.has(rule.capability);
}

function deriveReadOnlyPolicy(source: CommandPolicy): CommandPolicy {
  const promoted = [...source.ask, ...source.allow]
    .filter(isForbidden)
    .map(toDenial);

  return {
    id: `${source.id}.read-only`,
    description: `Read-only profile derived from the "${source.id}" policy: write-class and network-class decisions are denials, and anything unrecognised is denied.`,
    deny: [...READ_ONLY_DENY_RULES, ...source.deny, ...promoted],
    ask: source.ask.filter((rule) => !isForbidden(rule)),
    // `read` is not a forbidden capability, so this is the whole filter.
    allow: source.allow.filter((rule) => rule.capability === "read"),
    defaultAction: "deny",
    defaultReason:
      "This agent runs under a read-only policy: only explicitly permitted read-only commands may run.",
  };
}

/**
 * Derivations are memoized by source identity. Every explorer subagent spawn
 * derives a profile from the same session policy object, and the derivation is
 * deterministic, so recomputing it is pure waste — and returning the same
 * object keeps the evaluator's own per-policy compilation cache warm.
 */
const DERIVED = new WeakMap<CommandPolicy, CommandPolicy>();

/**
 * Derive a read-only profile from a policy.
 *
 * - every `deny` in the source stays a `deny`
 * - every `ask`/`allow` rule with a write, network, destructive, or credential
 *   capability becomes a `deny`
 * - only `read`-capability allow rules survive as allow; build/test commands
 *   are not read-only and fall through to the default
 * - the default becomes `deny`
 *
 * The source is never mutated, and the derived profile is treated as a value:
 * callers that need to change one build a new policy from it.
 */
export function createReadOnlyPolicy(source: CommandPolicy): CommandPolicy {
  const cached = DERIVED.get(source);
  if (cached) {
    return cached;
  }

  const derived = deriveReadOnlyPolicy(source);
  DERIVED.set(source, derived);
  return derived;
}

/** The read-only profile derived from the shipped baseline. */
export const readOnlyPolicy: CommandPolicy =
  createReadOnlyPolicy(defaultCommandPolicy);
