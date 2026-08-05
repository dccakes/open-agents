import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
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
 * Takes no caller id and has no fallback: the connect flow sets
 * `organizationId` when it creates the row, so a connection is owned from the
 * moment it exists. Resolving by row age — which is what this did before the
 * column existed — is gone, along with the window where a connection belonged
 * to nobody.
 */
export async function getLinearWorkspace(): Promise<
  LinearWorkspace | undefined
> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return undefined;
  }

  const [workspace] = await db
    .select()
    .from(linearWorkspaces)
    .where(eq(linearWorkspaces.organizationId, organizationId))
    .limit(1);

  return workspace;
}

export async function deleteLinearWorkspace(
  workspaceId: string,
): Promise<void> {
  await db
    .delete(linearWorkspaces)
    .where(eq(linearWorkspaces.workspaceId, workspaceId));
}
