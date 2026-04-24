import { createHash } from "node:crypto";
import type { PullRequestCheckRun } from "@/lib/github/client";

export const MAX_REMEDIATION_ATTEMPTS = 3;
export const COOLDOWN_MS = 5 * 60 * 1000;

export const REMEDIATION_STATUS = {
  watching: "watching",
  exhausted: "exhausted",
  terminal: "terminal",
  cooldown: "cooldown",
  fingerprintDedup: "fingerprint_dedup",
  remediated: "remediated",
} as const;

export type RemediationStatus =
  (typeof REMEDIATION_STATUS)[keyof typeof REMEDIATION_STATUS];

export type SafetyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "budget_exhausted"
        | "cooldown"
        | "fingerprint_dedup"
        | "terminal_pr";
    };

export type SafetyPolicyState = {
  attemptCount: number;
  lastAttemptAt: Date | string | null;
  lastFingerprintHash: string | null;
};

function coerceDate(value: Date | string | null): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function checkSafetyPolicy(params: {
  state: SafetyPolicyState | null;
  fingerprintHash: string;
  prTerminal: boolean;
  now: Date;
}): SafetyDecision {
  const { state, fingerprintHash, prTerminal, now } = params;

  if (prTerminal) {
    return { allowed: false, reason: "terminal_pr" };
  }

  if (!state) {
    return { allowed: true };
  }

  if (state.attemptCount >= MAX_REMEDIATION_ATTEMPTS) {
    return { allowed: false, reason: "budget_exhausted" };
  }

  const lastAttemptAt = coerceDate(state.lastAttemptAt);
  if (lastAttemptAt && now.getTime() - lastAttemptAt.getTime() < COOLDOWN_MS) {
    return { allowed: false, reason: "cooldown" };
  }

  if (
    state.lastFingerprintHash !== null &&
    state.lastFingerprintHash === fingerprintHash
  ) {
    return { allowed: false, reason: "fingerprint_dedup" };
  }

  return { allowed: true };
}

export function computeFailureFingerprint(
  checkRuns: PullRequestCheckRun[],
): string {
  const failingKeys = checkRuns
    .filter((run) => run.state === "failed")
    .map((run) => `${run.name}:${run.conclusion ?? ""}`)
    .sort((a, b) => a.localeCompare(b));

  return createHash("sha256")
    .update(failingKeys.join("|"))
    .digest("hex")
    .slice(0, 16);
}
