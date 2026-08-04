/**
 * The installations a member can see: the organization's, plus their own.
 *
 * Every listing surface goes through here rather than calling
 * `getInstallationsByUserId` directly, so "what the organization owns is
 * visible to every approved member" is one decision in one place instead of
 * six routes each remembering.
 *
 * Visibility is not access. Seeing that the organization has an installation
 * on an account tells a member nothing they could act on — `verifyRepoAccess`
 * still requires their own GitHub credentials to reach the repository.
 */

import {
  getInstallationsByUserId,
  getOrgInstallations,
} from "@/lib/db/installations";
import type { GitHubInstallation } from "@/lib/db/schema";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

export async function getVisibleInstallations(
  userId: string,
): Promise<GitHubInstallation[]> {
  const organizationId = await getSeededOrganizationId();

  const [personal, organizational] = await Promise.all([
    getInstallationsByUserId(userId),
    organizationId ? getOrgInstallations(organizationId) : Promise.resolve([]),
  ]);

  // Organization-owned records win on collision: after promotion a member
  // should never see a stale personal duplicate of the same installation.
  const byInstallationId = new Map<number, GitHubInstallation>();
  for (const installation of personal) {
    byInstallationId.set(installation.installationId, installation);
  }
  for (const installation of organizational) {
    byInstallationId.set(installation.installationId, installation);
  }

  return [...byInstallationId.values()].sort((a, b) =>
    a.accountLogin.localeCompare(b.accountLogin),
  );
}

/** One visible installation, by its GitHub installation id. */
export async function getVisibleInstallationById(
  userId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const visible = await getVisibleInstallations(userId);
  return visible.find(
    (installation) => installation.installationId === installationId,
  );
}
