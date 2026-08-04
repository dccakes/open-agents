import { parseCommand } from "./command-parser";
import { compilePolicy } from "./compiled-policy";
import type {
  CommandPolicy,
  PolicyAction,
  PolicyDecision,
  PolicyOutcome,
  PolicyRule,
  PolicyToolCall,
  Posture,
} from "./types";

const BASH_TOOL_NAME = "bash";
const WILDCARD_TOOL = "*";

const RESTRICTIVENESS: Record<PolicyAction, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

interface Match {
  rule: PolicyRule | null;
  action: PolicyAction;
  matchedText: string | null;
  reason: string;
}

function appliesToTool(rule: PolicyRule, toolName: string): boolean {
  return rule.tool === WILDCARD_TOOL || rule.tool === toolName;
}

function matchesText(rule: PolicyRule, text: string): boolean {
  if (!rule.pattern) {
    return true;
  }
  return rule.pattern.test(text);
}

/**
 * Find the first rule in `rules` that matches `text`.
 *
 * `rules` arrives pre-bucketed by scope and already in deny → ask → allow order
 * (see `compiled-policy.ts`), so an allow rule can never override a deny rule
 * for the same command and the scan is one pass over the rules that can apply.
 */
function firstMatch(
  rules: PolicyRule[],
  toolName: string,
  text: string,
): Match | null {
  for (const rule of rules) {
    if (!appliesToTool(rule, toolName)) {
      continue;
    }
    if (matchesText(rule, text)) {
      return {
        rule,
        action: rule.action,
        matchedText: text,
        reason: rule.reason,
      };
    }
  }

  return null;
}

function policyDefault(policy: CommandPolicy): Match {
  return {
    rule: null,
    action: policy.defaultAction,
    matchedText: null,
    reason: policy.defaultReason,
  };
}

/** `deny` > `ask` > `allow`; ties keep the first match found. */
function mostRestrictive(matches: Match[]): Match | null {
  let winner: Match | null = null;
  for (const match of matches) {
    if (
      !winner ||
      RESTRICTIVENESS[match.action] > RESTRICTIVENESS[winner.action]
    ) {
      winner = match;
    }
  }
  return winner;
}

/** Posture is applied last: it can relax `ask`, and can never relax `deny`. */
function applyPosture(outcome: PolicyOutcome, posture: Posture): PolicyAction {
  if (outcome === "deny") {
    return "deny";
  }
  if (outcome === "allow") {
    return "allow";
  }
  // `ask` and `unknown` behave alike: gated unless the session opted out.
  return posture === "dangerous" ? "allow" : "ask";
}

function decide(
  outcome: PolicyOutcome,
  match: Match | null,
  reason: string,
  posture: Posture,
): PolicyDecision {
  return {
    action: applyPosture(outcome, posture),
    outcome,
    rule: match?.rule ?? null,
    reason,
    posture,
    matchedText: match?.matchedText ?? null,
  };
}

function evaluateBash(
  command: string,
  policy: CommandPolicy,
  posture: Posture,
): PolicyDecision {
  const parsed = parseCommand(command);

  if (!parsed.ok) {
    return decide(
      "unknown",
      null,
      `The command could not be parsed, so it cannot be checked against the policy (${parsed.reason}).`,
      posture,
    );
  }

  const compiled = compilePolicy(policy);
  const matches: Match[] = [];

  const wholeCommand = command.trim();
  if (wholeCommand !== "") {
    const commandMatch = firstMatch(
      compiled.command,
      BASH_TOOL_NAME,
      wholeCommand,
    );
    if (commandMatch) {
      matches.push(commandMatch);
    }
  }

  for (const segment of parsed.segments) {
    const segmentMatch = firstMatch(
      compiled.segment,
      BASH_TOOL_NAME,
      segment.text,
    );
    if (segmentMatch) {
      matches.push(segmentMatch);
    }
  }

  const winner = mostRestrictive(matches) ?? policyDefault(policy);
  return decide(winner.action, winner, winner.reason, posture);
}

/**
 * Evaluate a tool call against a policy under a posture.
 *
 * Pure: no I/O, no network, no sandbox access. It returns a decision whether
 * or not a sandbox exists, which is what makes it usable from `needsApproval`
 * as well as from `execute`.
 */
export function evaluate(
  toolCall: PolicyToolCall,
  policy: CommandPolicy,
  posture: Posture,
): PolicyDecision {
  if (toolCall.toolName === BASH_TOOL_NAME) {
    return evaluateBash(toolCall.command ?? "", policy, posture);
  }

  // A non-bash call has one text and no segments, so scope does not narrow
  // anything: every rule for the tool is matched against the target.
  const target = toolCall.target ?? "";
  const match =
    firstMatch(compilePolicy(policy).any, toolCall.toolName, target) ??
    policyDefault(policy);

  return decide(match.action, match, match.reason, posture);
}
