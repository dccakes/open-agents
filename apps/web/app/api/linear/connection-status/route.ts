import { NextResponse } from "next/server";
import { getLinearWorkspace } from "@/lib/db/linear-workspaces";
import { linearGraphQL } from "@/lib/linear/client";
import { decryptLinearToken } from "@/lib/linear/token";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const workspace = await getLinearWorkspace();

  if (!workspace) {
    return NextResponse.json({ connected: false });
  }

  try {
    const token = decryptLinearToken(workspace.accessToken);
    const execute = linearGraphQL(token);
    await execute<{ viewer: { id: string } }>("query { viewer { id } }");

    return NextResponse.json({
      connected: true,
      workspaceName: workspace.workspaceName,
      workspaceId: workspace.workspaceId,
    });
  } catch {
    return NextResponse.json({ connected: false, reason: "token_invalid" });
  }
}
