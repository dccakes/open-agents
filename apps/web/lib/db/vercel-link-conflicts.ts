import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type VercelProjectLinkConflict,
  vercelProjectLinkConflicts,
} from "./schema";

export async function listUnresolvedVercelLinkConflicts(
  organizationId: string,
): Promise<VercelProjectLinkConflict[]> {
  return db
    .select()
    .from(vercelProjectLinkConflicts)
    .where(
      and(
        eq(vercelProjectLinkConflicts.organizationId, organizationId),
        isNull(vercelProjectLinkConflicts.resolvedAt),
      ),
    )
    .orderBy(
      asc(vercelProjectLinkConflicts.repoOwner),
      asc(vercelProjectLinkConflicts.repoName),
    );
}

/** Record a repository whose members named different projects. Idempotent. */
export async function recordVercelLinkConflict(params: {
  organizationId: string;
  repoOwner: string;
  repoName: string;
}): Promise<void> {
  const now = new Date();

  await db
    .insert(vercelProjectLinkConflicts)
    .values({
      id: nanoid(),
      organizationId: params.organizationId,
      repoOwner: params.repoOwner,
      repoName: params.repoName,
      detectedAt: now,
    })
    .onConflictDoNothing({
      target: [
        vercelProjectLinkConflicts.organizationId,
        vercelProjectLinkConflicts.repoOwner,
        vercelProjectLinkConflicts.repoName,
      ],
    });
}

export async function resolveVercelLinkConflict(params: {
  organizationId: string;
  repoOwner: string;
  repoName: string;
  resolvedByUserId: string;
}): Promise<void> {
  await db
    .update(vercelProjectLinkConflicts)
    .set({
      resolvedAt: new Date(),
      resolvedByUserId: params.resolvedByUserId,
    })
    .where(
      and(
        eq(vercelProjectLinkConflicts.organizationId, params.organizationId),
        eq(vercelProjectLinkConflicts.repoOwner, params.repoOwner),
        eq(vercelProjectLinkConflicts.repoName, params.repoName),
      ),
    );
}

/**
 * Whether any repository is still awaiting an administrator's decision.
 *
 * The contract step — removing the personal-link fallback — is gated on this
 * being false. Dropping the fallback while a repository is unresolved would
 * leave it with no mapping at all rather than the per-user one it has now.
 */
export async function hasUnresolvedVercelLinkConflicts(
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: vercelProjectLinkConflicts.id })
    .from(vercelProjectLinkConflicts)
    .where(
      and(
        eq(vercelProjectLinkConflicts.organizationId, organizationId),
        isNull(vercelProjectLinkConflicts.resolvedAt),
      ),
    )
    .limit(1);

  return rows.length > 0;
}
