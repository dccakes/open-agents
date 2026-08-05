/**
 * Deciding which repository→project links may become the organization's.
 *
 * The rule is deliberately conservative: promote only where every member who
 * recorded a link for a repository named the *same* Vercel project. Where they
 * disagree, promote nothing and record the disagreement.
 *
 * A Vercel project link decides where a deployment lands. "Most recently
 * updated wins" is a defensible rule for a preference and an indefensible one
 * for a deploy target — the failure mode is a member's work deployed to the
 * wrong project with no signal that a choice was ever made. Leaving a
 * conflicted repository unmapped degrades it to today's per-user behaviour
 * while an admin decides, which is the worst case we are willing to ship.
 */

import {
  groupBy,
  type OwnableRecord,
  pickSurvivor,
} from "@/lib/org/pick-survivor";

/** The subset of a link row the migration decision needs. */
export interface VercelLinkRecord extends OwnableRecord {
  userId: string;
  repoOwner: string;
  repoName: string;
  projectId: string;
  projectName: string;
}

export interface RepoCoordinate {
  repoOwner: string;
  repoName: string;
}

/** One repository's links agree: promote this row, delete the rest. */
export interface VercelLinkPromotion extends RepoCoordinate {
  kind: "promote";
  /** The row that gains the organization id. */
  keepUserId: string;
  /** Rows superseded by the kept one, identified by their owning user. */
  deleteUserIds: string[];
  projectId: string;
  /** False when the kept row is already organization-owned. */
  needsOwnershipWrite: boolean;
}

/** One repository's links disagree: promote nothing, record the conflict. */
export interface VercelLinkConflict extends RepoCoordinate {
  kind: "conflict";
  /** The distinct projects members named, for the admin screen. */
  candidates: { projectId: string; projectName: string; userId: string }[];
}

export type VercelLinkPlanEntry = VercelLinkPromotion | VercelLinkConflict;

function repoKey(coordinate: RepoCoordinate): string {
  return `${coordinate.repoOwner}/${coordinate.repoName}`;
}

/**
 * Plan the migration for every repository represented in `records`.
 *
 * Entries come back ordered by `owner/name` so an applying caller — and a
 * reviewer reading a log — sees a stable sequence.
 */
export function planVercelLinkMigration(
  records: VercelLinkRecord[],
): VercelLinkPlanEntry[] {
  const byRepo = groupBy(records, repoKey);
  const entries: VercelLinkPlanEntry[] = [];

  for (const group of byRepo.values()) {
    const first = group[0];
    const distinctProjects = new Set(group.map((link) => link.projectId));

    if (distinctProjects.size > 1) {
      entries.push({
        kind: "conflict",
        repoOwner: first.repoOwner,
        repoName: first.repoName,
        candidates: group.map((link) => ({
          projectId: link.projectId,
          projectName: link.projectName,
          userId: link.userId,
        })),
      });
      continue;
    }

    const survivor = pickSurvivor(group, (link) => link.userId);

    entries.push({
      kind: "promote",
      repoOwner: survivor.repoOwner,
      repoName: survivor.repoName,
      keepUserId: survivor.userId,
      deleteUserIds: group
        .filter((link) => link.userId !== survivor.userId)
        .map((link) => link.userId),
      projectId: survivor.projectId,
      needsOwnershipWrite: survivor.organizationId === null,
    });
  }

  return entries.sort((a, b) => repoKey(a).localeCompare(repoKey(b)));
}
