import { NextRequest, NextResponse } from "next/server";
import { getVisibleInstallationById } from "@/lib/github/visible-installations";
import { listUserInstallationRepositories } from "@/lib/github/repos";
import { getUserGitHubToken } from "@/lib/github/token";
import { getServerSession } from "@/lib/session/get-server-session";

function parseInstallationId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const installationId = parseInstallationId(
    searchParams.get("installation_id"),
  );
  const query = searchParams.get("query")?.trim() || undefined;
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit =
    typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
      ? parsedLimit
      : undefined;

  if (!installationId) {
    return NextResponse.json(
      { error: "installation_id is required" },
      { status: 400 },
    );
  }

  // Visibility, not ownership: an approved member may list the repositories
  // of an organization-owned installation. What they actually get back is
  // still filtered by their own token — `listUserInstallationRepositories`
  // asks GitHub as the user, so this cannot surface a repository they could
  // not already see.
  const installation = await getVisibleInstallationById(
    session.user.id,
    installationId,
  );
  if (!installation) {
    return NextResponse.json(
      { error: "Installation not found" },
      { status: 403 },
    );
  }

  const userToken = await getUserGitHubToken(session.user.id);
  if (!userToken) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  try {
    const repos = await listUserInstallationRepositories({
      installationId,
      userToken,
      owner: installation.accountLogin,
      query,
      limit,
    });

    return NextResponse.json(repos);
  } catch (error) {
    console.error("Failed to fetch installation repositories:", error);
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}
