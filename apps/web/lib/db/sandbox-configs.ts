import type { SandboxProviderType } from "@open-agents/sandbox";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import { userSandboxConfigs } from "./schema";

export interface UserSandboxConfigData {
  id: string;
  userId: string;
  providerType: SandboxProviderType;
  enabled: boolean;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSandboxConfigPatch {
  enabled?: boolean;
  config?: Record<string, string>;
}

function normalizeStoredConfig(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      continue;
    }

    const trimmedValue = entryValue.trim();
    if (!trimmedValue) {
      continue;
    }

    normalized[key] = trimmedValue;
  }

  return normalized;
}

function mergeConfig(
  baseConfig: Record<string, string>,
  patchConfig: Record<string, string> | undefined,
): Record<string, string> {
  if (!patchConfig) {
    return baseConfig;
  }

  const mergedConfig: Record<string, string> = { ...baseConfig };

  for (const [key, value] of Object.entries(patchConfig)) {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      delete mergedConfig[key];
      continue;
    }

    mergedConfig[key] = trimmedValue;
  }

  return mergedConfig;
}

function toUserSandboxConfigData(row: {
  id: string;
  userId: string;
  providerType: SandboxProviderType;
  enabled: boolean;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}): UserSandboxConfigData {
  return {
    id: row.id,
    userId: row.userId,
    providerType: row.providerType,
    enabled: row.enabled,
    config: normalizeStoredConfig(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getUserSandboxConfigs(
  userId: string,
): Promise<UserSandboxConfigData[]> {
  const rows = await db
    .select()
    .from(userSandboxConfigs)
    .where(eq(userSandboxConfigs.userId, userId));

  return rows.map(toUserSandboxConfigData);
}

export async function upsertUserSandboxConfig(
  userId: string,
  providerType: SandboxProviderType,
  patch: UserSandboxConfigPatch,
): Promise<UserSandboxConfigData> {
  const existingRows = await db
    .select()
    .from(userSandboxConfigs)
    .where(
      and(
        eq(userSandboxConfigs.userId, userId),
        eq(userSandboxConfigs.providerType, providerType),
      ),
    );
  const existing = existingRows[0];

  const now = new Date();
  const existingConfig = normalizeStoredConfig(existing?.config);
  const mergedConfig = mergeConfig(existingConfig, patch.config);
  const nextEnabled = patch.enabled ?? existing?.enabled ?? false;

  if (existing) {
    const [updated] = await db
      .update(userSandboxConfigs)
      .set({
        enabled: nextEnabled,
        config: mergedConfig,
        updatedAt: now,
      })
      .where(eq(userSandboxConfigs.id, existing.id))
      .returning();

    return toUserSandboxConfigData(updated);
  }

  const [created] = await db
    .insert(userSandboxConfigs)
    .values({
      id: nanoid(),
      userId,
      providerType,
      enabled: nextEnabled,
      config: mergedConfig,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toUserSandboxConfigData(created);
}
