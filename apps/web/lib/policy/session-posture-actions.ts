"use server";

/**
 * Server actions behind the session posture selector.
 *
 * Mirrors `lib/org/settings-actions.ts`: the action is a thin wrapper, and the
 * authorization lives in `session-posture.ts`. `availablePostures` on the
 * result exists only so the UI can hide an option it cannot use — hiding a
 * control is not authorization, and the server refuses `dangerous` from a
 * caller without the permission whether or not the option was ever rendered.
 */

import { isAuthorizationError } from "@/lib/auth/authorization-error";
import { isApprovalError } from "@/lib/policy/approval-errors";
import type { Posture } from "@/lib/policy/posture";
import {
  readSessionPosture,
  type SessionPostureView,
  updateSessionPosture,
} from "@/lib/policy/session-posture";

export type SessionPostureActionResult =
  | { success: true; posture: SessionPostureView }
  | { success: false; error: string; status: number };

function toActionError(error: unknown): SessionPostureActionResult {
  // `status` travels with the result so a denial reads as 403 at the caller
  // rather than as an indistinguishable failure string.
  if (isAuthorizationError(error) || isApprovalError(error)) {
    return { success: false, error: error.message, status: error.status };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("[posture] Action failed:", message);
  return {
    success: false,
    error: "The session posture is unavailable right now.",
    status: 500,
  };
}

/** The session's posture, plus which options this viewer may choose. */
export async function loadSessionPosture(
  sessionId: string,
): Promise<SessionPostureActionResult> {
  try {
    return { success: true, posture: await readSessionPosture(sessionId) };
  } catch (error) {
    return toActionError(error);
  }
}

/** Change the posture. A denied caller gets an error, not a silent no-op. */
export async function saveSessionPosture(
  sessionId: string,
  posture: Posture,
): Promise<SessionPostureActionResult> {
  try {
    return {
      success: true,
      posture: await updateSessionPosture(sessionId, { posture }),
    };
  } catch (error) {
    return toActionError(error);
  }
}
