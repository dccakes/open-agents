"use server";

/**
 * Server actions behind the integration-ownership admin surfaces.
 *
 * Reading is open to any approved member; every mutation is gated in the
 * module that performs it, not here. The `canManage` flag these actions return
 * exists only to hide an affordance — hiding a control is not authorization,
 * and a caller who posts directly still meets `requirePermission`.
 */

import { isAuthorizationError } from "@/lib/auth/authorization-error";
import { hasPermission } from "@/lib/auth/require-permission";
import {
  claimGitHubAccount,
  readOrgGitHubAccounts,
  releaseGitHubAccount,
} from "@/lib/org/github-accounts";
import {
  linkLinearActor,
  readLinearActorLinks,
  unlinkLinearActor,
} from "@/lib/org/linear-actor-links";
import { isOrgSettingsError } from "@/lib/org/settings-errors";
import {
  readVercelLinkConflicts,
  resolveVercelLinkDisagreement,
} from "@/lib/org/vercel-links";
import { readOrgVercelTeam, setOrgVercelTeam } from "@/lib/org/vercel-team";

export interface OrgGitHubAccountView {
  accountId: number;
  accountLogin: string;
}

export interface LinearActorLinkView {
  linearUserId: string;
  userId: string;
}

export interface VercelConflictView {
  repoOwner: string;
  repoName: string;
  candidates: { projectId: string; projectName: string; userIds: string[] }[];
}

export interface IntegrationOwnershipView {
  githubAccounts: OrgGitHubAccountView[];
  linearActorLinks: LinearActorLinkView[];
  vercelConflicts: VercelConflictView[];
  vercelTeam: { teamId: string | null; teamSlug: string | null };
  /** Whether the viewer may change any of this. UI affordance only. */
  canManage: boolean;
}

export type OwnershipActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

function toActionError<T>(error: unknown): OwnershipActionResult<T> {
  if (isAuthorizationError(error)) {
    return { success: false, error: error.message, status: error.status };
  }
  if (isOrgSettingsError(error)) {
    return { success: false, error: error.message, status: error.status };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("[integration-ownership] Action failed:", message);
  return {
    success: false,
    error: "Integration ownership is unavailable right now.",
    status: 500,
  };
}

export async function loadIntegrationOwnership(): Promise<
  OwnershipActionResult<IntegrationOwnershipView>
> {
  try {
    const [accounts, actorLinks, conflicts, vercelTeam, canManage] =
      await Promise.all([
        readOrgGitHubAccounts(),
        readLinearActorLinks(),
        readVercelLinkConflicts(),
        readOrgVercelTeam(),
        hasPermission({ integration: ["connect"] }),
      ]);

    return {
      success: true,
      data: {
        githubAccounts: accounts.map((account) => ({
          accountId: account.accountId,
          accountLogin: account.accountLogin,
        })),
        linearActorLinks: actorLinks.map((link) => ({
          linearUserId: link.linearUserId,
          userId: link.userId,
        })),
        vercelConflicts: conflicts.map((conflict) => ({
          repoOwner: conflict.repoOwner,
          repoName: conflict.repoName,
          candidates: conflict.candidates,
        })),
        vercelTeam,
        canManage,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function claimGitHubAccountAction(input: {
  accountId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
}): Promise<OwnershipActionResult<{ promotedInstallations: number }>> {
  try {
    const outcome = await claimGitHubAccount(input);
    return {
      success: true,
      data: { promotedInstallations: outcome.promotedInstallationIds.length },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function releaseGitHubAccountAction(
  accountId: number,
): Promise<OwnershipActionResult<{ releasedInstallations: number }>> {
  try {
    const outcome = await releaseGitHubAccount(accountId);
    return {
      success: true,
      data: { releasedInstallations: outcome.releasedInstallationIds.length },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function linkLinearActorAction(input: {
  linearUserId: string;
  userId: string;
}): Promise<OwnershipActionResult<null>> {
  try {
    await linkLinearActor(input);
    return { success: true, data: null };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unlinkLinearActorAction(
  linearUserId: string,
): Promise<OwnershipActionResult<null>> {
  try {
    await unlinkLinearActor(linearUserId);
    return { success: true, data: null };
  } catch (error) {
    return toActionError(error);
  }
}

export async function resolveVercelConflictAction(input: {
  repoOwner: string;
  repoName: string;
  projectId: string;
}): Promise<OwnershipActionResult<null>> {
  try {
    await resolveVercelLinkDisagreement(input);
    return { success: true, data: null };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setOrgVercelTeamAction(input: {
  teamId: string | null;
  teamSlug: string | null;
}): Promise<OwnershipActionResult<null>> {
  try {
    await setOrgVercelTeam(input);
    return { success: true, data: null };
  } catch (error) {
    return toActionError(error);
  }
}
