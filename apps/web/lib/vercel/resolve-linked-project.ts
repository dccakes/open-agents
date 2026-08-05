import "server-only";
import { getVercelProjectLinkByRepo } from "@/lib/db/vercel-project-links";
import { listMatchingVercelProjects } from "@/lib/vercel/projects";
import { getUserVercelToken } from "@/lib/vercel/token";
import type { VercelProjectSelection } from "@/lib/vercel/types";

/**
 * The organization's Vercel project for a repository, if this member can
 * actually use it.
 *
 * The organization owns the *mapping* — which project a repo deploys to is a
 * fact about the repo. It does not own the *credential*: Vercel sign-in is a
 * personal identity, and every Vercel call is made with the acting member's
 * own token. So an org-owned link is only usable by a member whose own Vercel
 * account can see that project.
 *
 * This is the same shape as `verifyRepoAccess` for GitHub: the org-owned
 * resource is intersected with what the caller can independently reach at the
 * provider. Without it, a session records a project the member cannot query,
 * and they get no deployment URL with nothing explaining why.
 *
 * Returns `null` rather than raising when the member has no Vercel connection
 * or cannot see the project — this runs on an implicit path where the member
 * never asked for a Vercel project, so "no project" is the correct outcome,
 * not an error.
 */
export async function resolveUsableVercelProjectLink(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<VercelProjectSelection | null> {
  const link = await getVercelProjectLinkByRepo(
    params.repoOwner,
    params.repoName,
  );
  if (!link) {
    return null;
  }

  const token = await getUserVercelToken(params.userId);
  if (!token) {
    return null;
  }

  try {
    const projects = await listMatchingVercelProjects({
      token,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
    });

    return projects.some((project) => project.projectId === link.projectId)
      ? link
      : null;
  } catch {
    // An expired or revoked Vercel token must not fail session creation — the
    // member did not ask for a Vercel project on this path.
    return null;
  }
}
