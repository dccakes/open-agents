/**
 * Migrating repository→project links to the organization, and resolving the
 * repositories where members disagreed.
 *
 * The migration is deliberately partial. Where every member who recorded a
 * link for a repository named the same project, promotion is unambiguous and
 * runs. Where they named different projects, nothing is promoted: a Vercel
 * project link decides where a deployment lands, and any automatic tiebreak is
 * a guess about a production side effect. Those repositories keep their
 * per-user rows — the same behaviour they have today — and wait for a person.
 */

import {
  type PermissionCheckOptions,
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import {
  hasUnresolvedVercelLinkConflicts,
  listUnresolvedVercelLinkConflicts,
  recordVercelLinkConflict,
  resolveVercelLinkConflict,
} from "@/lib/db/vercel-link-conflicts";
import {
  claimVercelLinkForOrganization,
  deleteVercelLinksForUsers,
  getAllVercelProjectLinks,
  getPersonalVercelLinksForRepo,
} from "@/lib/db/vercel-project-links";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { OrgSettingsError } from "@/lib/org/settings-errors";
import {
  planVercelLinkMigration,
  type VercelLinkRecord,
} from "@/lib/org/vercel-link-plan";

async function requireSeededOrganizationId(): Promise<string> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    throw new OrgSettingsError(
      "unavailable",
      "The organization has not been seeded yet.",
    );
  }
  return organizationId;
}

export interface VercelLinkMigrationOutcome {
  promotedRepoCount: number;
  removedDuplicateCount: number;
  conflictedRepoCount: number;
}

/**
 * Migrate every repository whose members agree, and record the rest.
 *
 * Idempotent: an already-promoted repository plans no ownership write and no
 * deletions, and conflict records are insert-with-conflict.
 */
export async function migrateVercelLinksToOrganization(): Promise<VercelLinkMigrationOutcome> {
  const organizationId = await requireSeededOrganizationId();
  const plan = planVercelLinkMigration(await getAllVercelProjectLinks());

  let promotedRepoCount = 0;
  let removedDuplicateCount = 0;
  let conflictedRepoCount = 0;

  for (const entry of plan) {
    if (entry.kind === "conflict") {
      await recordVercelLinkConflict({
        organizationId,
        repoOwner: entry.repoOwner,
        repoName: entry.repoName,
      });
      conflictedRepoCount += 1;
      continue;
    }

    if (entry.needsOwnershipWrite) {
      await claimVercelLinkForOrganization({
        organizationId,
        userId: entry.keepUserId,
        repoOwner: entry.repoOwner,
        repoName: entry.repoName,
      });
      promotedRepoCount += 1;
    }

    removedDuplicateCount += await deleteVercelLinksForUsers({
      userIds: entry.deleteUserIds,
      repoOwner: entry.repoOwner,
      repoName: entry.repoName,
    });
  }

  return { promotedRepoCount, removedDuplicateCount, conflictedRepoCount };
}

export interface VercelLinkConflictView {
  repoOwner: string;
  repoName: string;
  detectedAt: Date;
  /** The distinct projects members named, with who named each. */
  candidates: {
    projectId: string;
    projectName: string;
    userIds: string[];
  }[];
}

function groupCandidates(
  records: VercelLinkRecord[],
): VercelLinkConflictView["candidates"] {
  const byProject = new Map<
    string,
    { projectId: string; projectName: string; userIds: string[] }
  >();

  for (const record of records) {
    const existing = byProject.get(record.projectId);
    if (existing) {
      existing.userIds.push(record.userId);
    } else {
      byProject.set(record.projectId, {
        projectId: record.projectId,
        projectName: record.projectName,
        userIds: [record.userId],
      });
    }
  }

  return [...byProject.values()];
}

/** Unresolved disagreements, with their competing projects. */
export async function readVercelLinkConflicts(
  options?: PermissionCheckOptions,
): Promise<VercelLinkConflictView[]> {
  await requireApprovedMember(options);
  const organizationId = await requireSeededOrganizationId();

  const conflicts = await listUnresolvedVercelLinkConflicts(organizationId);

  const views: VercelLinkConflictView[] = [];
  for (const conflict of conflicts) {
    const records = await getPersonalVercelLinksForRepo(
      conflict.repoOwner,
      conflict.repoName,
    );
    views.push({
      repoOwner: conflict.repoOwner,
      repoName: conflict.repoName,
      detectedAt: conflict.detectedAt,
      candidates: groupCandidates(records),
    });
  }

  return views;
}

/**
 * Settle a disagreement by naming the project the organization will use.
 *
 * @throws AuthorizationError when the caller lacks `integration.connect`.
 * @throws OrgSettingsError (`invalid`) when no member recorded that project
 * for that repository — the resolution has to pick one of the candidates, not
 * introduce a fourth answer nobody has seen.
 */
export async function resolveVercelLinkDisagreement(
  params: { repoOwner: string; repoName: string; projectId: string },
  options?: PermissionCheckOptions,
): Promise<void> {
  const actor = await requireApprovedMember(options);
  await requirePermission({ integration: ["connect"] }, options);

  const organizationId = await requireSeededOrganizationId();

  const records = await getPersonalVercelLinksForRepo(
    params.repoOwner,
    params.repoName,
  );
  const chosen = records.find(
    (record) => record.projectId === params.projectId,
  );

  if (!chosen) {
    throw new OrgSettingsError(
      "invalid",
      `No member linked ${params.repoOwner}/${params.repoName} to project ${params.projectId}.`,
    );
  }

  await claimVercelLinkForOrganization({
    organizationId,
    userId: chosen.userId,
    repoOwner: chosen.repoOwner,
    repoName: chosen.repoName,
  });

  await deleteVercelLinksForUsers({
    userIds: records
      .filter((record) => record.userId !== chosen.userId)
      .map((record) => record.userId),
    repoOwner: chosen.repoOwner,
    repoName: chosen.repoName,
  });

  await resolveVercelLinkConflict({
    organizationId,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
    resolvedByUserId: actor.userId,
  });
}

/**
 * Whether the contract step may proceed.
 *
 * Exposed so the step is gated on data rather than on someone remembering:
 * removing the personal-link fallback while a repository is unresolved would
 * leave it with no mapping at all.
 */
export async function vercelLinkContractReady(): Promise<boolean> {
  const organizationId = await requireSeededOrganizationId();
  return !(await hasUnresolvedVercelLinkConflicts(organizationId));
}
