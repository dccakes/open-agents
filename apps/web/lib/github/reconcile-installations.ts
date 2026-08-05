/**
 * Reconciling organization-owned installations against the App's own list.
 *
 * Once one record serves the whole organization, no individual's view of
 * GitHub can be allowed to delete it — see `deleteInstallationsNotInList`.
 * That leaves two authoritative removal signals: the `installation.deleted`
 * webhook, and this. Webhook delivery is best-effort, so this is the one that
 * converges after a missed event or an App reconfiguration.
 *
 * `GET /app/installations` authenticates as the App itself, so what it returns
 * depends on no human's OAuth grant, no GitHub organization membership, and
 * nothing that lapses when someone leaves.
 */

import { z } from "zod";
import {
  deleteInstallationsByIds,
  getAllOrgOwnedInstallations,
  getInstallationsMissingAccountId,
  setInstallationAccountId,
} from "@/lib/db/installations";
import { renameOrgGitHubAccount } from "@/lib/db/org-github-accounts";
import { getAppOctokit } from "./app";

const appInstallationSchema = z.object({
  id: z.number(),
  account: z
    .object({
      id: z.number().optional(),
      login: z.string().optional(),
    })
    .nullable()
    .optional(),
});

interface AppInstallationSummary {
  installationId: number;
  accountId: number | null;
  accountLogin: string | null;
}

/** Every installation the App currently holds, across all accounts. */
async function listAppInstallations(): Promise<AppInstallationSummary[]> {
  const octokit = getAppOctokit();
  const pages = await octokit.paginate("GET /app/installations", {
    per_page: 100,
  });

  const summaries: AppInstallationSummary[] = [];
  for (const raw of pages) {
    const parsed = appInstallationSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    summaries.push({
      installationId: parsed.data.id,
      accountId: parsed.data.account?.id ?? null,
      accountLogin: parsed.data.account?.login ?? null,
    });
  }

  return summaries;
}

export interface ReconciliationOutcome {
  /** Organization-owned records GitHub no longer knows about. */
  removedInstallationIds: number[];
  /** Records that gained a numeric account id from the App's view. */
  backfilledAccountIdCount: number;
  /** Claimed accounts whose login GitHub reports as changed. */
  renamedAccountCount: number;
}

/**
 * Converge stored installation state on what the App actually holds.
 *
 * Idempotent and safe to run repeatedly. Removal is restricted to
 * organization-owned records: a personal record absent from the App's list is
 * left to its owner's own sync, which is the signal that governs it.
 */
export async function reconcileOrgInstallations(): Promise<ReconciliationOutcome> {
  const live = await listAppInstallations();
  const liveById = new Map(
    live.map((installation) => [installation.installationId, installation]),
  );

  const owned = await getAllOrgOwnedInstallations();
  const stale = owned.filter(
    (installation) => !liveById.has(installation.installationId),
  );

  await deleteInstallationsByIds(stale.map((installation) => installation.id));

  // Backfill the numeric account id for records written before the column
  // existed. Without it the allowlist can never match them, so they would stay
  // personal forever with no explanation.
  let backfilledAccountIdCount = 0;
  for (const installation of await getInstallationsMissingAccountId()) {
    const match = liveById.get(installation.installationId);
    if (typeof match?.accountId !== "number") {
      continue;
    }
    await setInstallationAccountId(installation.id, match.accountId);
    backfilledAccountIdCount += 1;
  }

  // A claimed account that was renamed on GitHub keeps its id and its
  // ownership; only the stored display login is behind.
  let renamedAccountCount = 0;
  for (const installation of owned) {
    const match = liveById.get(installation.installationId);
    if (
      typeof installation.accountId !== "number" ||
      !match?.accountLogin ||
      match.accountLogin === installation.accountLogin
    ) {
      continue;
    }
    await renameOrgGitHubAccount({
      accountId: installation.accountId,
      accountLogin: match.accountLogin,
    });
    renamedAccountCount += 1;
  }

  return {
    removedInstallationIds: stale.map(
      (installation) => installation.installationId,
    ),
    backfilledAccountIdCount,
    renamedAccountCount,
  };
}
