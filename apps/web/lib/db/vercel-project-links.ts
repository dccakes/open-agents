import { and, eq } from "drizzle-orm";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import { db } from "./client";
import { vercelProjectLinks } from "./schema";

function normalizeRepoCoordinate(value: string): string {
  return value.trim().toLowerCase();
}

const selection = {
  projectId: vercelProjectLinks.projectId,
  projectName: vercelProjectLinks.projectName,
  teamId: vercelProjectLinks.teamId,
  teamSlug: vercelProjectLinks.teamSlug,
};

/**
 * The repository's Vercel project.
 *
 * Takes no caller id: which project a repository deploys to is a fact about
 * the repository, and every member gets the same answer. The row is keyed
 * `(organization_id, repo_owner, repo_name)`, so there is no per-user variant
 * to fall back to and no way for two members to hold different answers.
 */
export async function getVercelProjectLinkByRepo(
  repoOwner: string,
  repoName: string,
): Promise<VercelProjectSelection | null> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return null;
  }

  const [row] = await db
    .select(selection)
    .from(vercelProjectLinks)
    .where(
      and(
        eq(vercelProjectLinks.organizationId, organizationId),
        eq(vercelProjectLinks.repoOwner, normalizeRepoCoordinate(repoOwner)),
        eq(vercelProjectLinks.repoName, normalizeRepoCoordinate(repoName)),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Record which Vercel project a repository deploys to.
 *
 * `userId` is provenance — who set it — never authority. A later member
 * linking the same repository updates the organization's one row rather than
 * creating a competing one, which is what stops two people from quietly
 * deploying the same repo to different projects.
 */
export async function upsertVercelProjectLink(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  project: VercelProjectSelection;
}): Promise<void> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    throw new Error(
      "Cannot link a Vercel project before the organization is seeded.",
    );
  }

  const now = new Date();

  await db
    .insert(vercelProjectLinks)
    .values({
      organizationId,
      userId: params.userId,
      repoOwner: normalizeRepoCoordinate(params.repoOwner),
      repoName: normalizeRepoCoordinate(params.repoName),
      projectId: params.project.projectId,
      projectName: params.project.projectName,
      teamId: params.project.teamId,
      teamSlug: params.project.teamSlug,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        vercelProjectLinks.organizationId,
        vercelProjectLinks.repoOwner,
        vercelProjectLinks.repoName,
      ],
      set: {
        userId: params.userId,
        projectId: params.project.projectId,
        projectName: params.project.projectName,
        teamId: params.project.teamId,
        teamSlug: params.project.teamSlug,
        updatedAt: now,
      },
    });
}
