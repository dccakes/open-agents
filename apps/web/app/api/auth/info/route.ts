import type { NextRequest } from "next/server";
import { hasGitHubAccount as checkGitHubLinked } from "@/lib/github/users";
import { getVisibleInstallations } from "@/lib/github/visible-installations";
import { isUserAdmin, userExists } from "@/lib/db/users";
import { isManagedTemplateTrialUser } from "@/lib/managed-template-trial";
import { getSessionWithMembershipFromReq } from "@/lib/session/server";
import type { SessionUserInfo } from "@/lib/session/types";

const UNAUTHENTICATED: SessionUserInfo = { user: undefined };

export async function GET(req: NextRequest) {
  // The membership-aware read, because this endpoint is how the client learns
  // it should render the approval-request screen. It only *reports* pending
  // state — every protected surface refuses a pending user server-side,
  // whatever the client does with this.
  const { session, approved } = await getSessionWithMembershipFromReq(req);

  if (!session?.user?.id) {
    return Response.json(UNAUTHENTICATED);
  }

  if (!approved) {
    const pending: SessionUserInfo = {
      user: session.user,
      authProvider: session.authProvider,
      isPendingApproval: true,
      isAdmin: false,
    };
    return Response.json(pending);
  }

  // run the user-existence check in parallel with the github queries
  // so there is zero added latency on the happy path.
  const [exists, hasGitHubAccount, installations, isAdmin] = await Promise.all([
    userExists(session.user.id),
    checkGitHubLinked(session.user.id),
    getVisibleInstallations(session.user.id),
    isUserAdmin(session.user.id),
  ]);

  if (!exists) {
    return Response.json(UNAUTHENTICATED);
  }
  const hasGitHubInstallations = installations.length > 0;
  const hasGitHub = hasGitHubAccount || hasGitHubInstallations;

  const data: SessionUserInfo = {
    user: session.user,
    authProvider: session.authProvider,
    isPendingApproval: false,
    isAdmin,
    isManagedTemplateTrialUser: isManagedTemplateTrialUser(session, req.url),
    hasGitHub,
    hasGitHubAccount,
    hasGitHubInstallations,
  };

  return Response.json(data);
}
