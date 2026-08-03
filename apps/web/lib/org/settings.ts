/**
 * Reading and updating organization-wide settings.
 *
 * Reads are open to any approved member; only updates are gated, on
 * `orgSettings.update`. Reads deliberately do not swallow failures: the
 * run-start gate has to be able to tell "not paused" from "could not tell",
 * and it can only do that if this module raises instead of guessing.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  type PermissionCheckOptions,
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import { db } from "@/lib/db/client";
import { orgSettings } from "@/lib/db/schema";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { OrgSettingsError } from "@/lib/org/settings-errors";
import {
  type DbTransaction,
  type OrgSettingsChange,
  recordOrgSettingsAudit,
} from "@/lib/org/settings-audit";

export {
  isOrgSettingsError,
  OrgSettingsError,
} from "@/lib/org/settings-errors";

export interface OrgSettingsValues {
  organizationId: string;
  /** True stops *new* runs in this deployment; in-flight runs keep going. */
  agentRunsPaused: boolean;
  /** NULL means unlimited. */
  dailyTokenBudget: number | null;
}

/**
 * The budget as a consumer should see it: "unlimited" is a value, not the
 * absence of one, so a caller cannot mistake NULL for zero.
 */
export type DailyTokenBudget =
  | { limit: "unlimited" }
  | { limit: "limited"; dailyTokens: number };

export const orgSettingsUpdateSchema = z
  .object({
    agentRunsPaused: z.boolean(),
    dailyTokenBudget: z.number().int().nonnegative().nullable(),
  })
  .partial();

export type OrgSettingsUpdate = z.infer<typeof orgSettingsUpdateSchema>;

const settingsColumns = {
  organizationId: orgSettings.organizationId,
  agentRunsPaused: orgSettings.agentRunsPaused,
  dailyTokenBudget: orgSettings.dailyTokenBudget,
};

async function requireSeededOrganizationId(): Promise<string> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    throw new OrgSettingsError(
      "unavailable",
      "The organization has not been seeded yet.",
    );
  }
  return organizationId;
}

async function selectSettings(
  client: typeof db | DbTransaction,
  organizationId: string,
): Promise<OrgSettingsValues> {
  const rows = await client
    .select(settingsColumns)
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, organizationId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new OrgSettingsError(
      "unavailable",
      `No settings row exists for organization ${organizationId}.`,
    );
  }

  return row;
}

/**
 * The organization's current settings.
 *
 * @throws OrgSettingsError (`unavailable`) when the organization or its
 * settings row is missing. Database failures propagate unchanged.
 */
export async function readOrgSettings(): Promise<OrgSettingsValues> {
  const organizationId = await requireSeededOrganizationId();
  return await selectSettings(db, organizationId);
}

/**
 * The daily token budget, for WS-1.1's run-budget enforcement to consume.
 *
 * This capability stores and gates the value; halting runs on a breach is the
 * consumer's job.
 */
export async function getDailyTokenBudget(): Promise<DailyTokenBudget> {
  const { dailyTokenBudget } = await readOrgSettings();
  return dailyTokenBudget === null
    ? { limit: "unlimited" }
    : { limit: "limited", dailyTokens: dailyTokenBudget };
}

function parseUpdate(input: unknown): OrgSettingsUpdate {
  const parsed = orgSettingsUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new OrgSettingsError(
      "invalid",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new OrgSettingsError(
      "invalid",
      "A settings update must name at least one field.",
    );
  }

  return parsed.data;
}

/** The fields whose value actually changed, so the audit records no no-ops. */
function diffOrgSettings(
  previous: OrgSettingsValues,
  next: OrgSettingsValues,
): OrgSettingsChange[] {
  const changes: OrgSettingsChange[] = [];

  if (previous.agentRunsPaused !== next.agentRunsPaused) {
    changes.push({
      field: "agentRunsPaused",
      previousValue: previous.agentRunsPaused,
      newValue: next.agentRunsPaused,
    });
  }

  if (previous.dailyTokenBudget !== next.dailyTokenBudget) {
    changes.push({
      field: "dailyTokenBudget",
      previousValue: previous.dailyTokenBudget,
      newValue: next.dailyTokenBudget,
    });
  }

  return changes;
}

/**
 * Apply a settings change.
 *
 * Authorization runs before validation and before any write, so a caller
 * lacking `orgSettings.update` cannot modify a column or probe the schema.
 * The mutation and its audit record share one transaction.
 *
 * @throws AuthorizationError (`unauthenticated` / `forbidden`) or
 * OrgSettingsError (`invalid` / `unavailable`).
 */
export async function updateOrgSettings(
  input: unknown,
  options?: PermissionCheckOptions,
): Promise<OrgSettingsValues> {
  const actor = await requireApprovedMember(options);
  await requirePermission({ orgSettings: ["update"] }, options);

  const update = parseUpdate(input);
  const organizationId = await requireSeededOrganizationId();

  return await db.transaction(async (tx) => {
    const previous = await selectSettings(tx, organizationId);

    const rows = await tx
      .update(orgSettings)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(orgSettings.organizationId, organizationId))
      .returning(settingsColumns);

    const next = rows[0];
    if (!next) {
      throw new OrgSettingsError(
        "unavailable",
        `Settings for organization ${organizationId} disappeared mid-update.`,
      );
    }

    await recordOrgSettingsAudit(tx, {
      organizationId,
      actorId: actor.userId,
      changes: diffOrgSettings(previous, next),
      occurredAt: new Date(),
    });

    return next;
  });
}
