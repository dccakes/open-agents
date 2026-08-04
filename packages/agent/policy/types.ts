import { z } from "zod";

/**
 * The policy vocabulary. Every type here is derived from its schema with
 * `z.infer` — there are no hand-written duplicates to drift apart.
 */

/** How permissive a session is. Applied after rule matching, never before. */
export const postureSchema = z.enum(["strict", "auto", "dangerous"]);
export type Posture = z.infer<typeof postureSchema>;

/** A resolved action. This is what a caller acts on. */
export const policyActionSchema = z.enum(["allow", "ask", "deny"]);
export type PolicyAction = z.infer<typeof policyActionSchema>;

/**
 * What matching produced, before posture is applied. `unknown` is a distinct
 * state: the command could not be parsed confidently, so it was never matched
 * against any pattern. It is resolved by posture, never silently allowed.
 */
export const policyOutcomeSchema = z.enum(["allow", "ask", "deny", "unknown"]);
export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;

/**
 * What a rule is about. Used to derive restricted profiles (for example the
 * read-only profile, in which write- and network-class decisions become
 * denials) without rewriting the baseline by hand.
 */
export const ruleCapabilitySchema = z.enum([
  "read",
  "write",
  "network",
  "destructive",
  "credential",
  "other",
]);
export type RuleCapability = z.infer<typeof ruleCapabilitySchema>;

/**
 * What a rule's pattern is tested against.
 * - `segment`: each parsed command segment, individually.
 * - `command`: the whole raw command, for patterns that span a pipe (an
 *   exfiltration pipeline is not visible in any single segment).
 */
export const ruleScopeSchema = z.enum(["segment", "command"]);
export type RuleScope = z.infer<typeof ruleScopeSchema>;

export const policyRuleSchema = z.object({
  /** Stable identifier, reported in decisions and policy events. */
  id: z.string().min(1),
  action: policyActionSchema,
  /** Tool name this rule applies to, or `"*"` for every tool. */
  tool: z.string().min(1),
  /**
   * Pattern matched against the command (for `bash`) or the target (for other
   * tools). A rule without a pattern matches every call to its tool.
   */
  pattern: z.instanceof(RegExp).optional(),
  scope: ruleScopeSchema.optional(),
  capability: ruleCapabilitySchema,
  /** Human-readable, shown in the UI and returned to the model. */
  reason: z.string().min(1),
});
export type PolicyRule = z.infer<typeof policyRuleSchema>;

/** Ordered rule lists plus the action taken when nothing matches. */
export const commandPolicySchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  deny: z.array(policyRuleSchema),
  ask: z.array(policyRuleSchema),
  allow: z.array(policyRuleSchema),
  defaultAction: policyActionSchema,
  defaultReason: z.string().min(1),
});
export type CommandPolicy = z.infer<typeof commandPolicySchema>;

/** The policy-relevant projection of a tool call. */
export const policyToolCallSchema = z.object({
  toolName: z.string().min(1),
  /** The bash command, for `bash`. */
  command: z.string().optional(),
  /** The path or URL a non-bash tool acts on. */
  target: z.string().optional(),
});
export type PolicyToolCall = z.infer<typeof policyToolCallSchema>;

export const policyDecisionSchema = z.object({
  /** The action after posture is applied. */
  action: policyActionSchema,
  /** What matching produced, before posture. May be `unknown`. */
  outcome: policyOutcomeSchema,
  /** The rule that produced the outcome, or `null` for the policy default. */
  rule: policyRuleSchema.nullable(),
  /** Suitable both for display and for return to the model. */
  reason: z.string().min(1),
  posture: postureSchema,
  /** The segment or target the rule matched, when there was one. */
  matchedText: z.string().nullable(),
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;
