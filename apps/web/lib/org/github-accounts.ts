/**
 * Claiming GitHub accounts for the organization, and the promotion that
 * follows.
 *
 * Adding an account here is the *only* way an installation becomes
 * organization-owned. No migration does it, and no heuristic infers it from
 * the account type — both would widen who can reach a repository at deploy
 * time, silently, based on a guess about intent.
 *
 * Authorization runs before validation and before any read of installation
 * state, matching `lib/org/settings.ts`: a caller without the permission
 * cannot promote, and cannot probe which installations exist either.
 */

import {
  type PermissionCheckOptions,
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import {
  claimInstallationForOrganization,
  deleteInstallationsByIds,
  getInstallationsByAccountId,
  releaseInstallationsFromOrganization,
} from "@/lib/db/installations";
import {
  addOrgGitHubAccount,
  getOrgGitHubAccount,
  listOrgGitHubAccounts,
  removeOrgGitHubAccount,
} from "@/lib/db/org-github-accounts";
import type { OrgGitHubAccount } from "@/lib/db/schema";
import {
  checkAccountPromotable,
  type GitHubAccountCandidate,
  planInstallationPromotion,
} from "@/lib/org/github-account-plan";
import { requireSeededOrganizationId } from "@/lib/org/seeded-organization";
import { OrgSettingsError } from "@/lib/org/settings-errors";

/** The accounts the organization claims. Open to any approved member. */
export async function readOrgGitHubAccounts(
  options?: PermissionCheckOptions,
): Promise<OrgGitHubAccount[]> {
  await requireApprovedMember(options);
  const organizationId = await requireSeededOrganizationId();
  return await listOrgGitHubAccounts(organizationId);
}

export interface PromotionOutcome {
  account: OrgGitHubAccount;
  /** Installations now owned by the organization. */
  promotedInstallationIds: number[];
  /** Duplicate per-user records the collapse removed. */
  removedRecordCount: number;
}

/**
 * Claim a GitHub account and collapse its installations onto the organization.
 *
 * Convergent: the end state is "exactly one organization-owned record per
 * installation on this account", so a re-run — a preview fork replaying it, an
 * admin re-adding an account — is a no-op rather than a second insert.
 *
 * @throws AuthorizationError when the caller lacks `integration.connect`.
 * @throws OrgSettingsError (`invalid`) for an account that may not be claimed.
 */
export async function claimGitHubAccount(
  candidate: GitHubAccountCandidate,
  options?: PermissionCheckOptions,
): Promise<PromotionOutcome> {
  const actor = await requireApprovedMember(options);
  await requirePermission({ integration: ["connect"] }, options);

  const promotable = checkAccountPromotable(candidate);
  if (!promotable.ok) {
    throw new OrgSettingsError(
      "invalid",
      promotable.reason === "personal-account"
        ? `${candidate.accountLogin} is a personal GitHub account. Only GitHub organizations can be shared — an installation on a personal account covers that person's own repositories.`
        : `GitHub did not report a numeric account id for ${candidate.accountLogin}, so it cannot be claimed.`,
    );
  }

  const organizationId = await requireSeededOrganizationId();

  const account = await addOrgGitHubAccount({
    organizationId,
    accountId: candidate.accountId,
    accountLogin: candidate.accountLogin,
    addedByUserId: actor.userId,
  });

  const records = await getInstallationsByAccountId(candidate.accountId);
  const plan = planInstallationPromotion(records);

  let removedRecordCount = 0;
  for (const promotion of plan) {
    if (promotion.needsOwnershipWrite) {
      await claimInstallationForOrganization({
        id: promotion.keepId,
        organizationId,
      });
    }
    removedRecordCount += await deleteInstallationsByIds(promotion.deleteIds);
  }

  return {
    account,
    promotedInstallationIds: plan.map((entry) => entry.installationId),
    removedRecordCount,
  };
}

export interface DemotionOutcome {
  accountId: number;
  /** Installations returned to the user recorded as having installed them. */
  releasedInstallationIds: number[];
}

/**
 * Release a GitHub account, returning its installations to personal ownership.
 *
 * The reverse of `claimGitHubAccount`, and an expected operation rather than
 * an emergency one — an admin who claims the wrong account needs a way back
 * that is not a database console. It does not, and cannot, un-see what members
 * reached while the account was claimed; the admin screen says so.
 *
 * @throws AuthorizationError when the caller lacks `integration.disconnect`.
 */
export async function releaseGitHubAccount(
  accountId: number,
  options?: PermissionCheckOptions,
): Promise<DemotionOutcome> {
  await requireApprovedMember(options);
  await requirePermission({ integration: ["disconnect"] }, options);

  const organizationId = await requireSeededOrganizationId();
  const existing = await getOrgGitHubAccount(organizationId, accountId);
  if (!existing) {
    return { accountId, releasedInstallationIds: [] };
  }

  // Queried by account id, symmetric with `claimGitHubAccount` above, rather
  // than reading every organization-owned record and filtering in memory.
  const owned = (await getInstallationsByAccountId(accountId)).filter(
    (installation) => installation.organizationId === organizationId,
  );

  await releaseInstallationsFromOrganization(
    owned.map((installation) => installation.id),
  );
  await removeOrgGitHubAccount(organizationId, accountId);

  const released = owned.map((installation) => installation.installationId);

  return { accountId, releasedInstallationIds: released };
}
