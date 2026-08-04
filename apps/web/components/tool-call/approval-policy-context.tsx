"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Posture } from "@/lib/policy/posture";

/**
 * Why a tool call is sitting in front of an approve/deny prompt.
 *
 * Carried as context rather than as a prop because the prompt lives at the
 * bottom of eleven renderers, all of which would otherwise have to forward a
 * value none of them care about. A view that does not provide it — a shared
 * transcript, a preview — gets `null` and the prompt renders exactly as it did
 * before, which is what keeps this additive.
 *
 * The value is the posture itself rather than an object wrapping it: one
 * session-wide string, so a wrapper would only add an identity to memoize.
 */

const ApprovalPolicyContext = createContext<Posture | null>(null);

export function useApprovalPolicy(): Posture | null {
  return useContext(ApprovalPolicyContext);
}

export function ApprovalPolicyProvider({
  posture,
  children,
}: {
  posture: Posture | null;
  children: ReactNode;
}) {
  return (
    <ApprovalPolicyContext.Provider value={posture}>
      {children}
    </ApprovalPolicyContext.Provider>
  );
}

/** The line shown above an approve/deny prompt. Null when nothing is known. */
export function describeApprovalPause(posture: Posture | null): string | null {
  if (!posture) {
    return null;
  }

  return `Paused by the ${posture} posture: the command policy asked for approval before this operation ran.`;
}
