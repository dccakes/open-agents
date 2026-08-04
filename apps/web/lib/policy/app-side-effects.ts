/**
 * The application's own side effects, and whether the posture lets them run.
 *
 * Auto-commit and auto-PR push to GitHub without ever passing through tool
 * dispatch — `performAutoCommit` and `performAutoCreatePr` each mint their own
 * scoped installation token — so the command policy never sees them. Together
 * with the bash policy these are the *only* two paths that reach a remote, and
 * this is the gate on them.
 *
 * Deliberately pure and dependency-free (a type import and nothing else). It is
 * imported at the top level of `app/workflows/chat.ts`, which runs inside the
 * workflow VM, where a stray runtime import breaks the whole run.
 */

import type { Posture } from "@/lib/policy/posture";

/** The application operations that reach GitHub outside tool dispatch. */
export const APP_SIDE_EFFECT_OPERATIONS = [
  "auto-commit",
  "auto-create-pr",
] as const;

export type AppSideEffectOperation =
  (typeof APP_SIDE_EFFECT_OPERATIONS)[number];

/**
 * The name stored on every `app-side-effect` approval.
 *
 * One name for both operations: a turn's git automation is approved or refused
 * as a unit, because approving the commit and refusing the pull request that
 * the commit exists to open is not a choice anybody wants to make mid-run.
 */
export const APP_SIDE_EFFECT_TOOL_NAME = "app.git-automation";

/** The rule the prompt names, so the user knows *why* it paused. */
export const APP_SIDE_EFFECT_RULE = "app.side-effect.git-push";

/** What the run reports when the approval was refused. */
export const APP_SIDE_EFFECT_SKIP_REASON =
  "Skipped by policy: the pending approval for this operation was not granted.";

const STRICT_REASON =
  "The strict posture requires approval for every side-effecting operation, including the application's own auto-commit and pull-request steps.";

const PERMISSIVE_REASON =
  "The policy allows the application's git automation under this posture, so it runs without pausing.";

export interface AppSideEffectGate {
  /** `ask` means: do not perform it, record an approval instead. */
  decision: "allow" | "ask";
  posture: Posture;
  rule: string;
  reason: string;
}

/**
 * Whether the run may perform its own git automation.
 *
 * `dangerous` collapses `ask` into `allow` exactly as it does for a tool call,
 * and `auto` is the behaviour that shipped before postures existed — under both
 * the workflow does precisely what it did before this gate was added.
 */
export function gateAppSideEffects(posture: Posture): AppSideEffectGate {
  const asks = posture === "strict";

  return {
    decision: asks ? "ask" : "allow",
    posture,
    rule: APP_SIDE_EFFECT_RULE,
    reason: asks ? STRICT_REASON : PERMISSIVE_REASON,
  };
}

export function isAppSideEffectOperation(
  value: unknown,
): value is AppSideEffectOperation {
  return (
    typeof value === "string" &&
    (APP_SIDE_EFFECT_OPERATIONS as readonly string[]).includes(value)
  );
}

/** The operations recorded on an approval, with anything unrecognized dropped. */
export function parseAppSideEffectOperations(
  value: unknown,
): AppSideEffectOperation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isAppSideEffectOperation);
}

export interface AppSideEffectDescription {
  operations: AppSideEffectOperation[];
  repoOwner: string;
  repoName: string;
}

/**
 * The exact operation, in the words the approval prompt shows.
 *
 * It names the repository because an approval may be answered hours later, from
 * a list, by somebody who has several sessions open.
 */
export function describeAppSideEffects(
  description: AppSideEffectDescription,
): string {
  const repo = `${description.repoOwner}/${description.repoName}`;
  const commits = description.operations.includes("auto-commit");
  const opensPr = description.operations.includes("auto-create-pr");

  if (commits && opensPr) {
    return `Commit and push this session's changes to ${repo}, then open or update its pull request.`;
  }
  if (commits) {
    return `Commit and push this session's changes to ${repo}.`;
  }
  if (opensPr) {
    return `Open or update the pull request for this session's branch on ${repo}.`;
  }

  return `Run this session's git automation on ${repo}.`;
}
