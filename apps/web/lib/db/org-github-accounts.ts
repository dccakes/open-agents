import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { type OrgGitHubAccount, orgGitHubAccounts } from "./schema";

export async function listOrgGitHubAccounts(
  organizationId: string,
): Promise<OrgGitHubAccount[]> {
  return db
    .select()
    .from(orgGitHubAccounts)
    .where(eq(orgGitHubAccounts.organizationId, organizationId))
    .orderBy(asc(orgGitHubAccounts.accountLogin));
}

export async function getOrgGitHubAccount(
  organizationId: string,
  accountId: number,
): Promise<OrgGitHubAccount | undefined> {
  const [account] = await db
    .select()
    .from(orgGitHubAccounts)
    .where(
      and(
        eq(orgGitHubAccounts.organizationId, organizationId),
        eq(orgGitHubAccounts.accountId, accountId),
      ),
    )
    .limit(1);

  return account;
}

/**
 * Record an account as the organization's.
 *
 * Conflict-tolerant on `(organizationId, accountId)` so re-adding an account
 * refreshes its login rather than raising — the promotion routine behind it is
 * convergent, and this has to be too.
 */
export async function addOrgGitHubAccount(params: {
  organizationId: string;
  accountId: number;
  accountLogin: string;
  addedByUserId: string | null;
}): Promise<OrgGitHubAccount> {
  const now = new Date();

  const [account] = await db
    .insert(orgGitHubAccounts)
    .values({
      id: nanoid(),
      organizationId: params.organizationId,
      accountId: params.accountId,
      accountLogin: params.accountLogin,
      accountType: "Organization",
      addedByUserId: params.addedByUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [orgGitHubAccounts.organizationId, orgGitHubAccounts.accountId],
      set: { accountLogin: params.accountLogin, updatedAt: now },
    })
    .returning();

  if (!account) {
    throw new Error("Failed to record organization GitHub account");
  }

  return account;
}

export async function removeOrgGitHubAccount(
  organizationId: string,
  accountId: number,
): Promise<boolean> {
  const removed = await db
    .delete(orgGitHubAccounts)
    .where(
      and(
        eq(orgGitHubAccounts.organizationId, organizationId),
        eq(orgGitHubAccounts.accountId, accountId),
      ),
    )
    .returning({ id: orgGitHubAccounts.id });

  return removed.length > 0;
}

/** Refresh a stored login after GitHub reports the account was renamed. */
export async function renameOrgGitHubAccount(params: {
  accountId: number;
  accountLogin: string;
}): Promise<void> {
  await db
    .update(orgGitHubAccounts)
    .set({ accountLogin: params.accountLogin, updatedAt: new Date() })
    .where(eq(orgGitHubAccounts.accountId, params.accountId));
}
