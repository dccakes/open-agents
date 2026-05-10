import { NextResponse } from "next/server";
import {
  deleteLinearWorkspace,
  getLinearWorkspace,
} from "@/lib/db/linear-workspaces";
import { decryptLinearToken } from "@/lib/linear/token";
import { deregisterLinearWebhook } from "@/lib/linear/webhook";
import { getServerSession } from "@/lib/session/get-server-session";

export async function POST() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const workspace = await getLinearWorkspace();

  if (!workspace) {
    return NextResponse.json({ ok: true });
  }

  if (workspace.webhookId) {
    try {
      const token = decryptLinearToken(workspace.accessToken);
      await deregisterLinearWebhook(token, workspace.webhookId);
    } catch {
      // swallow — deregisterLinearWebhook already swallows internally, this is extra safety
    }
  }

  await deleteLinearWorkspace(workspace.workspaceId);

  return NextResponse.json({ ok: true });
}
