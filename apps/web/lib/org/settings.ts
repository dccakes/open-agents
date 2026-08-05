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
import { requireSeededOrganizationId } from "@/lib/org/seeded-organization";
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
  /**
   * The Vercel team the organization's projects live under — the org's tie-in
   * to Vercel, as distinct from the per-user Vercel OAuth identity that
   * performs the API calls. NULL means "not recorded yet".
   */
  vercelTeamId: string | null;
  vercelTeamSlug: string | null;
}

/**
 * The budget as a consumer should see it: "unlimited" is a value, not the
 * absence of one, so a caller cannot mistake NULL for zero.
 */
export type DailyTokenBudget =
  | { limit: "unlimited" }
  | { limit: "limited"; dailyTokens: number };

/**
 * Deliberately excludes the Vercel team columns. They live on this row for
 * storage convenience, but they are integration configuration and are gated on
 * `integration.connect` through `lib/org/vercel-team.ts` — routing them
 * through here would silently re-gate them on `orgSettings.update`.
 */
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
  vercelTeamId: orgSettings.vercelTeamId,
  vercelTeamSlug: orgSettings.vercelTeamSlug,
};

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

  if (previous.vercelTeamId !== next.vercelTeamId) {
    changes.push({
      field: "vercelTeamId",
      previousValue: previous.vercelTeamId,
      newValue: next.vercelTeamId,
    });
  }

  if (previous.vercelTeamSlug !== next.vercelTeamSlug) {
    changes.push({
      field: "vercelTeamSlug",
      previousValue: previous.vercelTeamSlug,
      newValue: next.vercelTeamSlug,
    });
  }

  return changes;
}

/** Columns a caller may write through `writeOrgSettingsFields`. */
export type OrgSettingsWritableFields = Partial<
  Pick<
    OrgSettingsValues,
    "agentRunsPaused" | "dailyTokenBudget" | "vercelTeamId" | "vercelTeamSlug"
  >
>;

/**
 * Write settings columns inside the transaction that also records the audit.
 *
 * **Carries no permission check** — the caller has already made it, and which
 * one it is depends on the field: `orgSettings.update` for the run controls,
 * `integration.connect` for the Vercel team (see `lib/org/vercel-team.ts`).
 * That is exactly why this is a separate, unexported-from-the-gate function
 * rather than another branch inside `updateOrgSettings`.
 *
 * What it does guarantee is the part no caller should be re-deciding: one
 * transaction, one before/after diff, one audit record. A second writer to
 * `org_settings` that skipped this would sit outside the audit trail
 * `shared-config-governance` is going to fill in, and nobody would notice
 * while the seam is still a log line.
 */
export async function writeOrgSettingsFields(
  fields: OrgSettingsWritableFields,
  actorId: string,
): Promise<OrgSettingsValues> {
  const organizationId = await requireSeededOrganizationId();

  return await db.transaction(async (tx) => {
    const previous = await selectSettings(tx, organizationId);

    const rows = await tx
      .update(orgSettings)
      .set({ ...fields, updatedAt: new Date() })
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
      actorId,
      changes: diffOrgSettings(previous, next),
      occurredAt: new Date(),
    });

    return next;
  });
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

  return await writeOrgSettingsFields(update, actor.userId);
}
