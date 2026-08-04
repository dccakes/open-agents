/**
 * Reading and changing a session's security posture.
 *
 * Authorization is two-layered, following the organization-settings pattern:
 * `requireSessionActor` establishes that the caller may touch this session at
 * all, and `requirePermission({ posture: ["setDangerous"] })` additionally
 * gates the one posture that turns every approval into an automatic allow.
 * This is the first consumer of the statement WS-1.0 declared with none.
 *
 * `availablePostures` exists so the UI can hide `dangerous` from a member who
 * cannot select it. Hiding it is a courtesy; the server refuses it either way,
 * which is why the check below runs regardless of what the client sent.
 */

import { z } from "zod";
import {
  hasPermission,
  type PermissionCheckOptions,
  type PermissionRequest,
  requirePermission,
} from "@/lib/auth/require-permission";
import { updateSession } from "@/lib/db/sessions";
import { ApprovalError } from "@/lib/policy/approval-errors";
import {
  DEFAULT_POSTURE,
  isPosture,
  type Posture,
  POSTURES,
  postureSchema,
} from "@/lib/policy/posture";
import { requireSessionActor } from "@/lib/policy/session-access";

/** The permission that gates `dangerous`, in one place. */
export const SET_DANGEROUS_PERMISSION: PermissionRequest = {
  posture: ["setDangerous"],
};

export const sessionPostureUpdateSchema = z.object({
  posture: postureSchema,
});

export type SessionPostureUpdate = z.infer<typeof sessionPostureUpdateSchema>;

export interface SessionPostureView {
  sessionId: string;
  posture: Posture;
  /** The postures to offer this viewer. UI affordance only. */
  availablePostures: Posture[];
}

function normalizePosture(stored: unknown): Posture {
  return isPosture(stored) ? stored : DEFAULT_POSTURE;
}

/**
 * Derived from `POSTURES` rather than listed again, so a fourth posture is
 * offered the moment it is declared instead of compiling fine and silently
 * never appearing.
 */
function buildView(
  sessionId: string,
  posture: Posture,
  canSetDangerous: boolean,
): SessionPostureView {
  return {
    sessionId,
    posture,
    availablePostures: POSTURES.filter(
      (option) => option !== "dangerous" || canSetDangerous,
    ),
  };
}

/**
 * The session's posture, plus whether this viewer may select `dangerous`.
 *
 * @throws AuthorizationError when the caller may not act on the session.
 */
export async function readSessionPosture(
  sessionId: string,
  options?: PermissionCheckOptions,
): Promise<SessionPostureView> {
  // Independent checks, so they run together. `updateSessionPosture` must not
  // do this — see the ordering note there.
  const [actor, canSetDangerous] = await Promise.all([
    requireSessionActor(sessionId, options),
    hasPermission(SET_DANGEROUS_PERMISSION, options),
  ]);

  return buildView(
    sessionId,
    normalizePosture(actor.session.posture),
    canSetDangerous,
  );
}

function parseUpdate(input: unknown): SessionPostureUpdate {
  const parsed = sessionPostureUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalError(
      "invalid",
      "A posture update must name one of strict, auto, or dangerous.",
    );
  }
  return parsed.data;
}

/**
 * Change the session's posture.
 *
 * Ordering matters: session access first, so a caller with no business here
 * cannot probe the schema; then the `dangerous` permission, so it is checked
 * before anything is written.
 *
 * @throws AuthorizationError or ApprovalError (`invalid`).
 */
export async function updateSessionPosture(
  sessionId: string,
  input: unknown,
  options?: PermissionCheckOptions,
): Promise<SessionPostureView> {
  await requireSessionActor(sessionId, options);

  const { posture } = parseUpdate(input);

  if (posture === "dangerous") {
    await requirePermission(SET_DANGEROUS_PERMISSION, options);
  }

  const updated = await updateSession(sessionId, { posture });
  if (!updated) {
    throw new ApprovalError(
      "not-found",
      "The session disappeared while its posture was being changed.",
    );
  }

  const canSetDangerous = await hasPermission(
    SET_DANGEROUS_PERMISSION,
    options,
  );
  return buildView(
    sessionId,
    normalizePosture(updated.posture),
    canSetDangerous,
  );
}
