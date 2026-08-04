import {
  getInstallationByAccountLogin,
  getOrgInstallationByAccountLogin,
} from "@/lib/db/installations";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { withScopedInstallationOctokit } from "./app";
import { getUserOctokit } from "./client";

export type RepoAccessDeniedReason =
  | "no_user_token"
  | "user_no_access"
  | "user_no_write"
  | "no_installation"
  | "app_no_access";

export type RequiredRepoUserPermission = "read" | "write";

export type RepoAccessResult =
  | {
      ok: true;
      installationId: number;
      repositoryId: number;
      defaultBranch: string;
    }
  | { ok: false; reason: RepoAccessDeniedReason };

function hasUserWritePermission(
  permissions:
    | {
        admin: boolean;
        maintain?: boolean;
        push: boolean;
      }
    | undefined,
): boolean {
  return Boolean(
    permissions?.admin || permissions?.maintain || permissions?.push,
  );
}

function getGitHubHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  if (
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }

  return null;
}

/**
 * Resolve the installation covering `accountLogin`.
 *
 * The organization's own installation is preferred, and a personal record is
 * the fallback — the dual read that lets this land before every account has
 * been claimed. The contract step removes the fallback.
 *
 * Note what this function does *not* take: a permission, a role, or any notion
 * of what the caller may reach. It is a resource lookup. The authorization
 * happened in step 1 of `verifyRepoAccess`, against the caller's own GitHub
 * credentials, and nothing here may be read as a substitute for it.
 */
async function resolveInstallation(userId: string, accountLogin: string) {
  const organizationId = await getSeededOrganizationId();

  if (organizationId) {
    const orgInstallation = await getOrgInstallationByAccountLogin(
      organizationId,
      accountLogin,
    );
    if (orgInstallation) {
      return orgInstallation;
    }
  }

  return await getInstallationByAccountLogin(userId, accountLogin);
}

/**
 * Verify that the user can access a repo AND the GitHub App installation
 * covers it. Returns the installationId on success.
 *
 * This enforces the intersection: user permissions ∩ installation scope.
 *
 * **The step order is load-bearing.** Step 1 checks the *caller's own* GitHub
 * credentials and is the authorization; step 2 resolves the installation and
 * is not. Because step 1 runs first and unconditionally, widening step 2 from
 * a per-user record to the organization's leaves effective access exactly
 * where it was: repositories this human can already see on GitHub, at the
 * permission the action requires, intersected with what the installation
 * covers. Reordering these, or making step 2's result able to satisfy step 1,
 * would turn org ownership into a grant. `access.test.ts` pins this.
 */
export async function verifyRepoAccess(params: {
  userId: string;
  owner: string;
  repo: string;
  requiredUserPermission?: RequiredRepoUserPermission;
}): Promise<RepoAccessResult> {
  const { userId, owner, repo, requiredUserPermission = "read" } = params;

  // 1. check user can see the repo
  const userOctokit = await getUserOctokit(userId);
  if (!userOctokit) {
    return { ok: false, reason: "no_user_token" };
  }

  let repositoryId: number;
  let defaultBranch: string;
  try {
    const userRepoResponse = await userOctokit.rest.repos.get({ owner, repo });
    repositoryId = userRepoResponse.data.id;
    defaultBranch = userRepoResponse.data.default_branch;
    if (
      requiredUserPermission === "write" &&
      !hasUserWritePermission(userRepoResponse.data.permissions)
    ) {
      return { ok: false, reason: "user_no_write" };
    }
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    if (status === 404 || status === 403) {
      return { ok: false, reason: "user_no_access" };
    }
    throw error;
  }

  // 2. check installation exists for this owner (organization's, else personal)
  const installation = await resolveInstallation(userId, owner);
  if (!installation) {
    return { ok: false, reason: "no_installation" };
  }

  // 3. check installation covers this specific repo
  try {
    await withScopedInstallationOctokit({
      installationId: installation.installationId,
      repositoryId,
      permissions: { contents: "read" },
      operation: async (installationOctokit) => {
        await installationOctokit.rest.repos.get({ owner, repo });
      },
    });
  } catch (error: unknown) {
    const status = getGitHubHttpStatus(error);
    const message = error instanceof Error ? error.message : "";
    if (
      status === 404 ||
      status === 403 ||
      status === 422 ||
      message.includes(": 422 ")
    ) {
      return { ok: false, reason: "app_no_access" };
    }
    throw error;
  }

  return {
    ok: true,
    installationId: installation.installationId,
    repositoryId,
    defaultBranch,
  };
}

/**
 * Map access denial reasons to user-facing error messages.
 */
export function getRepoAccessErrorMessage(
  reason: RepoAccessDeniedReason,
): string {
  switch (reason) {
    case "no_user_token":
      return "Connect GitHub to access repositories";
    case "user_no_access":
      return "You don't have access to this repository";
    case "user_no_write":
      return "You need write access to this repository to perform this action";
    case "no_installation":
      return "GitHub App not installed for this organization. Install it from Settings > Connections.";
    case "app_no_access":
      return "GitHub App doesn't have access to this repository. Ask an org admin to update the app's repository permissions.";
  }
}
