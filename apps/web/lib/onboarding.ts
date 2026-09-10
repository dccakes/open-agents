import "server-only";
import { getVisibleInstallations } from "@/lib/github/visible-installations";
import { hasGitHubAccount } from "@/lib/github/users";

/**
 * Check whether a user needs to go through onboarding.
 * Returns true when GitHub account is not linked or no installations exist.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const [linked, installations] = await Promise.all([
    hasGitHubAccount(userId),
    getVisibleInstallations(userId),
  ]);

  return !linked || installations.length === 0;
}
