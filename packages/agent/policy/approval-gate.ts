import { z } from "zod";

/**
 * The seam between a policy `ask` and the server-side approval record.
 *
 * The agent package decides *whether* approval is needed; it can never decide
 * whether one was granted, because the record lives in a database this package
 * has no access to. So the host injects a gate on the execution context, and
 * the tools use it at two points:
 *
 * - `request` runs from `needsApproval`, before the SDK pauses, so the pause
 *   the user sees has a row behind it that can expire, be attributed, and be
 *   spent exactly once.
 * - `verify` runs from `execute`, after policy has been re-evaluated, and is
 *   what actually authorizes the call. Its refusal becomes the tool's result.
 *
 * A gate is *not* optional for an interactive `ask`. Without one there is no
 * record to expire, to attribute, or to spend, and the approval decision is
 * back to being an assertion in a client-supplied request body — so an absent
 * gate refuses, exactly as an absent policy does, rather than silently
 * degrading. See design.md decision 18.
 *
 * The refusal is scoped to `ask`: a call the policy allows outright never
 * reaches the gate, so a host that runs only allowed commands is unaffected.
 */

/** Why the record did not authorize the call. */
export const approvalGateRefusalCodeSchema = z.enum([
  /** Nobody ever requested approval for this tool call. */
  "no_approval_record",
  /** The record exists but has not been answered. */
  "not_approved",
  /** A user denied it. */
  "denied",
  /** It timed out. An expiry is a denial, not a re-prompt. */
  "expired",
  /** It already authorized one execution. */
  "already_consumed",
  /** The gate itself could not answer — treated as a refusal, never a grant. */
  "unavailable",
  /**
   * No gate was wired at all: a caller assembled a policy context without one,
   * so nothing on the server could ever have authorized this call.
   */
  "no_gate",
]);
export type ApprovalGateRefusalCode = z.infer<
  typeof approvalGateRefusalCodeSchema
>;

export const approvalGateDecisionSchema = z.discriminatedUnion("authorized", [
  z.object({ authorized: z.literal(true) }),
  z.object({
    authorized: z.literal(false),
    code: approvalGateRefusalCodeSchema,
    message: z.string().min(1),
  }),
]);
export type ApprovalGateDecision = z.infer<typeof approvalGateDecisionSchema>;

/** One tool call, identified the way the record identifies it. */
export interface ApprovalGateRequest {
  toolName: string;
  /** The SDK's id for this call. The record keys on it. */
  toolCallId: string;
  /** Redacted, length-bounded summary of the call, for the record. */
  inputSummary?: string;
}

export interface ApprovalGate {
  /**
   * Record that approval is being asked for. Must be idempotent per tool call:
   * a retried step must not produce a second competing record.
   */
  request(request: ApprovalGateRequest): void | Promise<void>;
  /**
   * Authorize exactly one execution of this tool call, or refuse.
   *
   * Implementations spend the approval here, so a second call for the same
   * tool call id must refuse.
   */
  verify(request: ApprovalGateRequest): Promise<ApprovalGateDecision>;
}

const UNAVAILABLE_MESSAGE =
  "The approval record for this operation could not be read, so the call was refused rather than executed unverified.";

const NO_GATE_MESSAGE =
  "This operation requires approval, but the agent was assembled without an approval gate, so no approval on the server can authorize it. This is a wiring error in the caller, not something to work around.";

/**
 * Ask the host to record the approval request.
 *
 * Never throws. A failure here is not a reason to skip the pause — it is a
 * reason for `verify` to find no record and refuse, which is the fail-closed
 * direction. The same goes for an absent gate: the pause still happens, and
 * `verify` refuses afterwards with `no_gate`.
 */
export async function requestApprovalRecord(
  gate: ApprovalGate | undefined,
  request: ApprovalGateRequest,
): Promise<void> {
  if (!gate) {
    return;
  }

  try {
    await gate.request(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[policy] Could not record an approval request for ${request.toolName}:`,
      detail,
    );
  }
}

/**
 * Whether the record authorizes this call.
 *
 * Neither an absent gate nor a failing one authorizes. They are different
 * situations — the first is a caller that never wired one, the second is one
 * that did and cannot answer — and they carry different codes, but both are
 * refusals: an `ask` that nothing on the server can answer is not an `allow`.
 */
export async function verifyApprovalRecord(
  gate: ApprovalGate | undefined,
  request: ApprovalGateRequest,
): Promise<ApprovalGateDecision> {
  if (!gate) {
    console.error(
      `[policy] ${request.toolName} required approval but no approval gate is wired; refusing the call.`,
    );
    return {
      authorized: false,
      code: "no_gate",
      message: NO_GATE_MESSAGE,
    };
  }

  try {
    return await gate.verify(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[policy] Approval verification failed for ${request.toolName}:`,
      detail,
    );
    return {
      authorized: false,
      code: "unavailable",
      message: UNAVAILABLE_MESSAGE,
    };
  }
}
