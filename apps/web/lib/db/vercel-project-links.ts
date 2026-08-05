import { and, eq, inArray, isNull } from "drizzle-orm";
import type { VercelProjectSelection } from "@/lib/vercel/types";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { db } from "./client";
import { type VercelLinkRecord } from "@/lib/org/vercel-link-plan";
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

/** The shape the migration planner consumes. Hoisted so its two readers cannot drift. */
const linkRecordColumns = {
  userId: vercelProjectLinks.userId,
  organizationId: vercelProjectLinks.organizationId,
  repoOwner: vercelProjectLinks.repoOwner,
  repoName: vercelProjectLinks.repoName,
  projectId: vercelProjectLinks.projectId,
  projectName: vercelProjectLinks.projectName,
  createdAt: vercelProjectLinks.createdAt,
};

/**
 * The repository's Vercel project.
 *
 * Prefers the organization's mapping and falls back to the caller's own — the
 * dual read that keeps a repository working while its members' disagreement is
 * unresolved, or before the migration has run. The contract step removes the
 * fallback, gated on the conflict table being empty.
 */
export async function getVercelProjectLinkByRepo(
  userId: string,
  repoOwner: string,
  repoName: string,
): Promise<VercelProjectSelection | null> {
  const normalizedOwner = normalizeRepoCoordinate(repoOwner);
  const normalizedRepo = normalizeRepoCoordinate(repoName);

  const organizationId = await getSeededOrganizationId();

  if (organizationId) {
    const [orgRow] = await db
      .select(selection)
      .from(vercelProjectLinks)
      .where(
        and(
          eq(vercelProjectLinks.organizationId, organizationId),
          eq(vercelProjectLinks.repoOwner, normalizedOwner),
          eq(vercelProjectLinks.repoName, normalizedRepo),
        ),
      )
      .limit(1);

    if (orgRow) {
      return orgRow;
    }
  }

  const [row] = await db
    .select(selection)
    .from(vercelProjectLinks)
    .where(
      and(
        eq(vercelProjectLinks.userId, userId),
        eq(vercelProjectLinks.repoOwner, normalizedOwner),
        eq(vercelProjectLinks.repoName, normalizedRepo),
      ),
    )
    .limit(1);

  return row ?? null;
}

/** Every link row, for the migration planner. */
export async function getAllVercelProjectLinks(): Promise<VercelLinkRecord[]> {
  return db.select(linkRecordColumns).from(vercelProjectLinks);
}

/** The personal rows recorded for one repository, for the admin screen. */
export async function getPersonalVercelLinksForRepo(
  repoOwner: string,
  repoName: string,
): Promise<VercelLinkRecord[]> {
  return db
    .select(linkRecordColumns)
    .from(vercelProjectLinks)
    .where(
      and(
        isNull(vercelProjectLinks.organizationId),
        eq(vercelProjectLinks.repoOwner, normalizeRepoCoordinate(repoOwner)),
        eq(vercelProjectLinks.repoName, normalizeRepoCoordinate(repoName)),
      ),
    );
}

/** Promote one existing row in place. See the schema note on why in place. */
export async function claimVercelLinkForOrganization(params: {
  organizationId: string;
  userId: string;
  repoOwner: string;
  repoName: string;
}): Promise<void> {
  await db
    .update(vercelProjectLinks)
    .set({ organizationId: params.organizationId, updatedAt: new Date() })
    .where(
      and(
        eq(vercelProjectLinks.userId, params.userId),
        eq(vercelProjectLinks.repoOwner, params.repoOwner),
        eq(vercelProjectLinks.repoName, params.repoName),
      ),
    );
}

export async function deleteVercelLinksForUsers(params: {
  userIds: string[];
  repoOwner: string;
  repoName: string;
}): Promise<number> {
  if (params.userIds.length === 0) {
    return 0;
  }

  const deleted = await db
    .delete(vercelProjectLinks)
    .where(
      and(
        inArray(vercelProjectLinks.userId, params.userIds),
        eq(vercelProjectLinks.repoOwner, params.repoOwner),
        eq(vercelProjectLinks.repoName, params.repoName),
        isNull(vercelProjectLinks.organizationId),
      ),
    )
    .returning({ userId: vercelProjectLinks.userId });

  return deleted.length;
}

export async function upsertVercelProjectLink(params: {
  userId: string;
  repoOwner: string;
  repoName: string;
  project: VercelProjectSelection;
}): Promise<void> {
  const normalizedOwner = normalizeRepoCoordinate(params.repoOwner);
  const normalizedRepo = normalizeRepoCoordinate(params.repoName);
  const now = new Date();

  await db
    .insert(vercelProjectLinks)
    .values({
      userId: params.userId,
      repoOwner: normalizedOwner,
      repoName: normalizedRepo,
      projectId: params.project.projectId,
      projectName: params.project.projectName,
      teamId: params.project.teamId,
      teamSlug: params.project.teamSlug,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        vercelProjectLinks.userId,
        vercelProjectLinks.repoOwner,
        vercelProjectLinks.repoName,
      ],
      set: {
        projectId: params.project.projectId,
        projectName: params.project.projectName,
        teamId: params.project.teamId,
        teamSlug: params.project.teamSlug,
        updatedAt: now,
      },
    });
}
