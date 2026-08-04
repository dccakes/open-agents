"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Why a tool call is sitting in front of an approve/deny prompt.
 *
 * Carried as context rather than as a prop because the prompt lives at the
 * bottom of eleven renderers, all of which would otherwise have to forward a
 * value none of them care about. A view that does not provide it — a shared
 * transcript, a preview — gets `null` and the prompt renders exactly as it did
 * before, which is what keeps this additive.
 */

export interface ApprovalPolicyContextValue {
  /** The session posture in force, or null when it is not known here. */
  posture: string | null;
}

const ApprovalPolicyContext = createContext<ApprovalPolicyContextValue>({
  posture: null,
});

export function useApprovalPolicy(): ApprovalPolicyContextValue {
  return useContext(ApprovalPolicyContext);
}

export function ApprovalPolicyProvider({
  posture,
  children,
}: {
  posture: string | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ posture }), [posture]);

  return (
    <ApprovalPolicyContext.Provider value={value}>
      {children}
    </ApprovalPolicyContext.Provider>
  );
}

/** The line shown above an approve/deny prompt. Null when nothing is known. */
export function describeApprovalPause(posture: string | null): string | null {
  if (!posture) {
    return null;
  }

  return `Paused by the ${posture} posture: the command policy asked for approval before this operation ran.`;
}
