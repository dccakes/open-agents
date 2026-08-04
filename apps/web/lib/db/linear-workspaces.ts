import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  type LinearWorkspace,
  linearWorkspaces,
  type NewLinearWorkspace,
} from "./schema";

export interface UpsertLinearWorkspaceInput {
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  webhookSecret?: string | null;
  webhookId?: string | null;
  installedByUserId?: string | null;
  organizationId?: string | null;
}

export async function upsertLinearWorkspace(
  data: UpsertLinearWorkspaceInput,
): Promise<LinearWorkspace> {
  const existing = await db
    .select({ id: linearWorkspaces.id })
    .from(linearWorkspaces)
    .where(eq(linearWorkspaces.workspaceId, data.workspaceId))
    .limit(1);

  const now = new Date();

  if (existing[0]) {
    const [updated] = await db
      .update(linearWorkspaces)
      .set({
        workspaceName: data.workspaceName,
        accessToken: data.accessToken,
        webhookSecret: data.webhookSecret ?? null,
        webhookId: data.webhookId ?? null,
        installedByUserId: data.installedByUserId ?? null,
        // Only ever written, never cleared: a reconnect that omits the
        // organization must not orphan a connection members already resolve.
        ...(data.organizationId ? { organizationId: data.organizationId } : {}),
        updatedAt: now,
      })
      .where(eq(linearWorkspaces.id, existing[0].id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update Linear workspace");
    }

    return updated;
  }

  const workspace: NewLinearWorkspace = {
    id: nanoid(),
    workspaceId: data.workspaceId,
    workspaceName: data.workspaceName,
    accessToken: data.accessToken,
    webhookSecret: data.webhookSecret ?? null,
    webhookId: data.webhookId ?? null,
    installedByUserId: data.installedByUserId ?? null,
    organizationId: data.organizationId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db
    .insert(linearWorkspaces)
    .values(workspace)
    .returning();

  if (!created) {
    throw new Error("Failed to create Linear workspace");
  }

  return created;
}

/**
 * The organization's Linear connection.
 *
 * Resolved by organization rather than by record age, which was only ever
 * correct while exactly one row existed. The unclaimed fallback keeps a
 * connection made before this column existed working until the seeder
 * backfills it.
 */
export async function getLinearWorkspaceForOrganization(
  organizationId: string,
): Promise<LinearWorkspace | undefined> {
  const [owned] = await db
    .select()
    .from(linearWorkspaces)
    .where(eq(linearWorkspaces.organizationId, organizationId))
    .limit(1);

  if (owned) {
    return owned;
  }

  const [unclaimed] = await db
    .select()
    .from(linearWorkspaces)
    .where(isNull(linearWorkspaces.organizationId))
    .orderBy(asc(linearWorkspaces.createdAt))
    .limit(1);

  return unclaimed;
}

export async function getLinearWorkspace(): Promise<
  LinearWorkspace | undefined
> {
  const [workspace] = await db
    .select()
    .from(linearWorkspaces)
    .orderBy(asc(linearWorkspaces.createdAt))
    .limit(1);
  return workspace;
}

/**
 * Attach the existing connection to the organization.
 *
 * Runs from the seeder, not from a migration: migrations are static SQL and
 * cannot know the seeded organization's id. Idempotent — once the row is
 * claimed there is no unclaimed row left to match.
 *
 * Claims the *oldest* unclaimed row only, one per call. Claiming every
 * unclaimed row at once would violate the one-connection-per-organization
 * unique index the moment a deployment somehow held two, turning a data
 * oddity into a failed boot.
 */
export async function claimLinearWorkspaceForOrganization(
  organizationId: string,
): Promise<boolean> {
  const [existingOwned] = await db
    .select({ id: linearWorkspaces.id })
    .from(linearWorkspaces)
    .where(eq(linearWorkspaces.organizationId, organizationId))
    .limit(1);

  if (existingOwned) {
    return false;
  }

  const [candidate] = await db
    .select({ id: linearWorkspaces.id })
    .from(linearWorkspaces)
    .where(isNull(linearWorkspaces.organizationId))
    .orderBy(asc(linearWorkspaces.createdAt))
    .limit(1);

  if (!candidate) {
    return false;
  }

  await db
    .update(linearWorkspaces)
    .set({ organizationId, updatedAt: new Date() })
    .where(
      and(
        eq(linearWorkspaces.id, candidate.id),
        isNull(linearWorkspaces.organizationId),
      ),
    );

  return true;
}

export async function deleteLinearWorkspace(
  workspaceId: string,
): Promise<void> {
  await db
    .delete(linearWorkspaces)
    .where(eq(linearWorkspaces.workspaceId, workspaceId));
}
