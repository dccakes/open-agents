/**
 * Deciding what promotion and demotion do, without touching the database.
 *
 * The rules that matter are all here, so they can be tested exhaustively
 * rather than through a query: which accounts may be claimed at all, and how N
 * per-user records of one installation collapse into the single record the
 * organization owns.
 *
 * Both planners are *convergent* — they describe the end state rather than a
 * sequence of edits — so re-running a promotion is a no-op rather than a
 * second insert. That property is load-bearing: preview deployments are forks
 * that replay this, and an admin who removes and re-adds an account runs it
 * again.
 */

import {
  groupBy,
  type OwnableRecord,
  pickSurvivor,
} from "@/lib/org/pick-survivor";

/** An account as GitHub describes it, before we decide anything about it. */
export interface GitHubAccountCandidate {
  /** GitHub's immutable numeric account id — the promotion key. */
  accountId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
}

export type AccountPromotionRefusal =
  /** Personal accounts are never promotable. See `checkAccountPromotable`. */
  | "personal-account"
  /** GitHub did not give us the numeric id, so we cannot key on it. */
  | "missing-account-id";

export type AccountPromotionCheck =
  | { ok: true }
  | { ok: false; reason: AccountPromotionRefusal };

/**
 * Whether an account may be claimed by the organization.
 *
 * A personal GitHub account is refused outright rather than accepted with no
 * effect: an installation on someone's own account covers their own private
 * repositories, and promoting it would hand the whole organization access to
 * them from a screen whose stated subject is "our GitHub organizations".
 */
export function checkAccountPromotable(
  candidate: GitHubAccountCandidate,
): AccountPromotionCheck {
  if (candidate.accountType !== "Organization") {
    return { ok: false, reason: "personal-account" };
  }

  if (!Number.isInteger(candidate.accountId) || candidate.accountId <= 0) {
    return { ok: false, reason: "missing-account-id" };
  }

  return { ok: true };
}

/** The subset of an installation record the collapse decision needs. */
export interface InstallationRecord extends OwnableRecord {
  id: string;
  userId: string;
  installationId: number;
}

export interface InstallationPromotion {
  installationId: number;
  /** The record that becomes — or already is — the organization's. */
  keepId: string;
  /** The user recorded as having installed it, kept as provenance. */
  provenanceUserId: string;
  /** Records superseded by `keepId`, to be deleted. */
  deleteIds: string[];
  /** False when the surviving record is already organization-owned. */
  needsOwnershipWrite: boolean;
}

/**
 * Plan the collapse of every record for the given installations.
 *
 * @param records every installation record for the account being promoted,
 * across all users. Records for other accounts must not be passed in — this
 * groups solely by `installationId`.
 */
export function planInstallationPromotion(
  records: InstallationRecord[],
): InstallationPromotion[] {
  const byInstallation = groupBy(records, (record) => record.installationId);
  const promotions: InstallationPromotion[] = [];

  for (const [installationId, group] of byInstallation) {
    const survivor = pickSurvivor(group, (record) => record.id);

    promotions.push({
      installationId,
      keepId: survivor.id,
      provenanceUserId: survivor.userId,
      deleteIds: group
        .filter((record) => record.id !== survivor.id)
        .map((record) => record.id),
      needsOwnershipWrite: survivor.organizationId === null,
    });
  }

  // Deterministic order, so a caller applying this sees the same sequence on
  // every replay.
  return promotions.sort((a, b) => a.installationId - b.installationId);
}
