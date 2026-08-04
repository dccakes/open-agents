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

/** An account as GitHub describes it, before we decide anything about it. */
export interface GitHubAccountCandidate {
  /** GitHub's immutable numeric account id — the promotion key. */
  accountId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
}

export type AccountPromotionRefusal =
  /** Personal accounts are never promotable. See `isPromotableAccount`. */
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

export function isPromotableAccount(
  candidate: GitHubAccountCandidate,
): boolean {
  return checkAccountPromotable(candidate).ok;
}

/** The subset of an installation record the collapse decision needs. */
export interface InstallationRecord {
  id: string;
  userId: string;
  installationId: number;
  organizationId: string | null;
  createdAt: Date;
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
 * The earliest record wins, and its user becomes provenance.
 *
 * Earliest rather than latest because the first person to install the App is
 * the closest thing to the account's actual installer; every later row is a
 * copy created by someone else's sync. Ties break on record id so the outcome
 * is deterministic across replays — two rows sharing a timestamp must not
 * produce a different survivor on a preview than on production.
 */
function pickSurvivor(records: InstallationRecord[]): InstallationRecord {
  return records.reduce((earliest, candidate) => {
    const alreadyOwned = candidate.organizationId !== null;
    const earliestOwned = earliest.organizationId !== null;

    // An existing organization-owned row always survives, so a re-run cannot
    // move ownership onto a different record and churn the unique index.
    if (alreadyOwned !== earliestOwned) {
      return alreadyOwned ? candidate : earliest;
    }

    const delta = candidate.createdAt.getTime() - earliest.createdAt.getTime();
    if (delta !== 0) {
      return delta < 0 ? candidate : earliest;
    }

    return candidate.id < earliest.id ? candidate : earliest;
  });
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
  const byInstallation = new Map<number, InstallationRecord[]>();

  for (const record of records) {
    const existing = byInstallation.get(record.installationId);
    if (existing) {
      existing.push(record);
    } else {
      byInstallation.set(record.installationId, [record]);
    }
  }

  const promotions: InstallationPromotion[] = [];

  for (const [installationId, group] of byInstallation) {
    const survivor = pickSurvivor(group);

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
