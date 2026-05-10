import { asc, eq } from "drizzle-orm";
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

export async function deleteLinearWorkspace(
  workspaceId: string,
): Promise<void> {
  await db
    .delete(linearWorkspaces)
    .where(eq(linearWorkspaces.workspaceId, workspaceId));
}
