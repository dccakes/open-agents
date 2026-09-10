/**
 * "Give me this session's sandbox, provisioning it if it is gone."
 *
 * Extracted from `app/workflows/chat-sandbox-runtime.ts` unchanged, because a
 * second caller now needs exactly this behaviour: the route that executes an
 * application-level side effect after its approval was granted. That approval
 * may be answered hours later, by which time the sandbox has hibernated or been
 * torn down — so the route has to reprovision, and it must do it through the
 * same path the chat workflow uses rather than a second, subtly different one.
 */

import { getSessionById } from "@/lib/db/sessions";
import {
  kickSandboxProvisioningWorkflow,
  waitForSandboxProvisioningRun,
} from "@/lib/sandbox/provisioning-kick";
import { isSandboxActive } from "@/lib/sandbox/utils";

type SessionRecord = NonNullable<Awaited<ReturnType<typeof getSessionById>>>;

export interface ReadySessionSandbox {
  session: SessionRecord;
  /** True when the sandbox had to be provisioned rather than reused. */
  didSetupWorkspace: boolean;
}

/**
 * The session and a live sandbox for it.
 *
 * A hibernated or missing sandbox is provisioned by kicking the provisioning
 * workflow and waiting for it, which is the only path that mints the tokens and
 * clones the repository. Nothing here assumes in-sandbox state survived.
 */
export async function getReadySessionSandbox(params: {
  sessionId: string;
  userId: string;
}): Promise<ReadySessionSandbox> {
  let session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.userId !== params.userId) {
    throw new Error("Unauthorized");
  }
  if (session.status === "archived") {
    throw new Error("Session is archived");
  }
  if (isSandboxActive(session.sandboxState)) {
    return { session, didSetupWorkspace: false };
  }

  const kick = await kickSandboxProvisioningWorkflow(params.sessionId);
  if (kick.runId) {
    await waitForSandboxProvisioningRun(kick.runId);
  }

  session = await getSessionById(params.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (!isSandboxActive(session.sandboxState)) {
    throw new Error(session.lifecycleError ?? "Workspace setup failed");
  }

  return { session, didSetupWorkspace: true };
}
