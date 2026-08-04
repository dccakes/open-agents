import type { CommandPolicy, PolicyRule } from "./types";

/**
 * A policy pre-bucketed for matching.
 *
 * `evaluate()` matches a bash command against the rule set once for the whole
 * command and once per segment, and a segment pass has no use for the
 * command-scoped rules (or vice versa). Walking all three rule arrays each time
 * to re-derive that split is the bulk of the work for a command with many
 * segments, so the split is computed once per policy and reused.
 *
 * Every bucket is in deny → ask → allow order, which is what makes "first match
 * within a class wins, and an allow can never override a deny" fall out of a
 * single linear scan.
 */
export interface CompiledPolicy {
  /** Rules that match a single command segment. */
  segment: PolicyRule[];
  /** Rules that match the whole command string, separators included. */
  command: PolicyRule[];
  /** Every rule, for tools whose call has one text and no notion of segments. */
  any: PolicyRule[];
}

/**
 * Keyed by object identity, so a caller that builds a different policy object
 * gets its own compilation. This is a cache and nothing more: it never changes
 * a decision, and it holds no reference that would keep a policy alive.
 *
 * It does assume a policy's rule arrays are not mutated after the policy is
 * first evaluated — policies here are built once and treated as values.
 */
const COMPILED = new WeakMap<CommandPolicy, CompiledPolicy>();

function hasScope(rule: PolicyRule, scope: "segment" | "command"): boolean {
  return (rule.scope ?? "segment") === scope;
}

export function compilePolicy(policy: CommandPolicy): CompiledPolicy {
  const cached = COMPILED.get(policy);
  if (cached) {
    return cached;
  }

  const any = [...policy.deny, ...policy.ask, ...policy.allow];
  const compiled: CompiledPolicy = {
    segment: any.filter((rule) => hasScope(rule, "segment")),
    command: any.filter((rule) => hasScope(rule, "command")),
    any,
  };

  COMPILED.set(policy, compiled);
  return compiled;
}
