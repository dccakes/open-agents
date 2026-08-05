import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type GitHubInstallation,
  githubInstallations,
  type NewGitHubInstallation,
} from "./schema";

export interface UpsertInstallationInput {
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl?: string | null;
  /** GitHub's immutable numeric account id, when the payload carried one. */
  accountId?: number | null;
}

/**
 * Metadata a refresh may overwrite. `accountId` is only ever written, never
 * cleared: a payload that omits it must not erase what an earlier one told us,
 * because it is the key the organization allowlist matches on.
 */
function refreshedColumns(data: UpsertInstallationInput, now: Date) {
  return {
    installationId: data.installationId,
    accountLogin: data.accountLogin,
    accountType: data.accountType,
    repositorySelection: data.repositorySelection,
    installationUrl: data.installationUrl ?? null,
    ...(typeof data.accountId === "number"
      ? { accountId: data.accountId }
      : {}),
    updatedAt: now,
  };
}

export async function upsertInstallation(
  data: UpsertInstallationInput,
): Promise<GitHubInstallation> {
  const now = new Date();

  // Both candidate rows in one query: the organization's record for this
  // installation, and this user's own.
  //
  // The organization's has to be considered at all because without it a member
  // syncing an installation the organization already owns would find no row of
  // *their own*, insert a personal one, and re-fragment exactly what promotion
  // collapsed — silently, on every sync. Fetching both together keeps that
  // correctness without paying a second round-trip per installation, which
  // `syncUserInstallations` would multiply by the user's installation count.
  const candidates = await db
    .select({
      id: githubInstallations.id,
      organizationId: githubInstallations.organizationId,
    })
    .from(githubInstallations)
    .where(
      or(
        and(
          eq(githubInstallations.installationId, data.installationId),
          isNotNull(githubInstallations.organizationId),
        ),
        and(
          eq(githubInstallations.userId, data.userId),
          or(
            eq(githubInstallations.installationId, data.installationId),
            eq(githubInstallations.accountLogin, data.accountLogin),
          ),
        ),
      ),
    );

  const target =
    candidates.find((row) => row.organizationId !== null) ?? candidates[0];

  if (target) {
    const [updated] = await db
      .update(githubInstallations)
      // `userId` is deliberately absent: on an organization-owned record it is
      // provenance — who installed it — not whoever synced most recently.
      .set(refreshedColumns(data, now))
      .where(eq(githubInstallations.id, target.id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update GitHub installation");
    }

    return updated;
  }

  const installation: NewGitHubInstallation = {
    id: nanoid(),
    userId: data.userId,
    installationId: data.installationId,
    accountId: data.accountId ?? null,
    accountLogin: data.accountLogin,
    accountType: data.accountType,
    repositorySelection: data.repositorySelection,
    installationUrl: data.installationUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db
    .insert(githubInstallations)
    .values(installation)
    .returning();

  if (!created) {
    throw new Error("Failed to create GitHub installation");
  }

  return created;
}

export async function getInstallationsByUserId(
  userId: string,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .orderBy(asc(githubInstallations.accountLogin));
}

export async function getInstallationByAccountLogin(
  userId: string,
  accountLogin: string,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.accountLogin, accountLogin),
      ),
    )
    .limit(1);

  return installation;
}

/**
 * The organization's installation for a repository owner.
 *
 * Takes no caller id — that is the whole point. Every approved member resolves
 * the same record, so access stops depending on which colleague happened to
 * sync most recently. Authorization is not weakened by this: `verifyRepoAccess`
 * has already proved the caller's own GitHub credentials reach the repository
 * before it gets here.
 */
export async function getOrgInstallationByAccountLogin(
  organizationId: string,
  accountLogin: string,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.organizationId, organizationId),
        eq(githubInstallations.accountLogin, accountLogin),
      ),
    )
    .limit(1);

  return installation;
}

/** The organization's record for one installation id. */
export async function getOrgInstallationById(
  organizationId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.organizationId, organizationId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .limit(1);

  return installation;
}

/** Every installation the organization owns, for listing surfaces. */
export async function getOrgInstallations(
  organizationId: string,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.organizationId, organizationId))
    .orderBy(asc(githubInstallations.accountLogin));
}

/** Installation records for a GitHub account id, across every owner. */
export async function getInstallationsByAccountId(
  accountId: number,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.accountId, accountId));
}

/** Every organization-owned installation, regardless of organization. */
export async function getAllOrgOwnedInstallations(): Promise<
  GitHubInstallation[]
> {
  return db
    .select()
    .from(githubInstallations)
    .where(isNotNull(githubInstallations.organizationId));
}

/** Installation records still missing the numeric account id, for backfill. */
export async function getInstallationsMissingAccountId(): Promise<
  GitHubInstallation[]
> {
  return db
    .select()
    .from(githubInstallations)
    .where(isNull(githubInstallations.accountId));
}

export async function setInstallationAccountId(
  id: string,
  accountId: number,
): Promise<void> {
  await db
    .update(githubInstallations)
    .set({ accountId, updatedAt: new Date() })
    .where(eq(githubInstallations.id, id));
}

/** Make a record the organization's. Idempotent by construction. */
export async function claimInstallationForOrganization(params: {
  id: string;
  organizationId: string;
}): Promise<void> {
  await db
    .update(githubInstallations)
    .set({ organizationId: params.organizationId, updatedAt: new Date() })
    .where(eq(githubInstallations.id, params.id));
}

/** Return records to personal ownership by the users recorded on them. */
export async function releaseInstallationsFromOrganization(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await db
    .update(githubInstallations)
    .set({ organizationId: null, updatedAt: new Date() })
    .where(inArray(githubInstallations.id, ids));
}

export async function deleteInstallationsByIds(ids: string[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const deleted = await db
    .delete(githubInstallations)
    .where(inArray(githubInstallations.id, ids))
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

export async function getInstallationByUserAndId(
  userId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .limit(1);

  return installation;
}

export async function getInstallationsByInstallationId(
  installationId: number,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId));
}

export async function deleteInstallationByInstallationId(
  installationId: number,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

/**
 * Delete a user's *personal* installation records.
 *
 * Scoped to `organization_id IS NULL` so account removal or a failed sync
 * cannot take the organization's installations with it. Organization-owned
 * records are removed by GitHub's `installation.deleted` event or by
 * reconciliation against the App's own list — never as a side effect of one
 * person's state.
 */
export async function deleteInstallationsByUserId(
  userId: string,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        isNull(githubInstallations.organizationId),
      ),
    )
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

/**
 * Prune the personal records absent from a user's own view of GitHub.
 *
 * `GET /user/installations` answers "what can *this user* see", which stopped
 * being a safe basis for deletion the moment one record began serving the
 * whole organization: a member who leaves the GitHub organization, or whose
 * OAuth grant lapses, would otherwise delete the organization's installation
 * for everyone on their next sync. The `organization_id IS NULL` predicate is
 * what makes that impossible.
 */
export async function deleteInstallationsNotInList(
  userId: string,
  installationIds: number[],
): Promise<number> {
  if (installationIds.length === 0) {
    return deleteInstallationsByUserId(userId);
  }

  const deleted = await db
    .delete(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        isNull(githubInstallations.organizationId),
        notInArray(githubInstallations.installationId, installationIds),
      ),
    )
    .returning({ id: githubInstallations.id });

  return deleted.length;
}

export async function updateInstallationsByInstallationId(
  installationId: number,
  updates: {
    accountLogin?: string;
    accountType?: "User" | "Organization";
    repositorySelection?: "all" | "selected";
    installationUrl?: string | null;
  },
): Promise<number> {
  if (
    updates.accountLogin === undefined &&
    updates.accountType === undefined &&
    updates.repositorySelection === undefined &&
    updates.installationUrl === undefined
  ) {
    return 0;
  }

  const updated = await db
    .update(githubInstallations)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return updated.length;
}
