/**
 * Read and change a session's security posture.
 *
 * Both authorization layers live in `lib/policy/session-posture.ts`, not here:
 * the route is an adapter, and putting the `posture.setDangerous` check in the
 * module means a server action calling the same function is gated identically.
 */

import { policyErrorResponse } from "@/lib/policy/policy-error-response";
import {
  readSessionPosture,
  updateSessionPosture,
} from "@/lib/policy/session-posture";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  try {
    return Response.json({ posture: await readSessionPosture(sessionId) });
  } catch (error) {
    return policyErrorResponse(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    return Response.json({
      posture: await updateSessionPosture(sessionId, body),
    });
  } catch (error) {
    return policyErrorResponse(error);
  }
}
