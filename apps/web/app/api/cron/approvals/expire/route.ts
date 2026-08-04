/**
 * The approval expiry sweeper's HTTP entry point.
 *
 * The handler itself refuses to write outside production
 * (`lib/policy/approval-sweeper.ts`), so this route is safe to call anywhere —
 * in preview it reports that it was skipped and touches nothing.
 *
 * Access is gated on `orgSettings.update` rather than on a scheduler secret:
 * this repository has no cron infrastructure yet and no shared-secret variable,
 * and inventing one here would be a config surface this change did not declare.
 * Wiring a scheduler (a `vercel.json` crons entry plus a secret check) is a
 * follow-up; nothing about the timeout depends on it, because expiry is
 * computed on read in every environment whether or not this ever runs.
 */

import {
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import { sweepExpiredApprovals } from "@/lib/policy/approval-sweeper";
import { policyErrorResponse } from "@/lib/policy/policy-error-response";

export async function POST() {
  try {
    await requireApprovedMember();
    await requirePermission({ orgSettings: ["update"] });

    return Response.json(await sweepExpiredApprovals());
  } catch (error) {
    return policyErrorResponse(error);
  }
}
