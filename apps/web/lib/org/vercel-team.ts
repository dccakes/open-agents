/**
 * The organization's Vercel team.
 *
 * Stored on the `org_settings` row for convenience, but gated on
 * `integration.connect` rather than `orgSettings.update`: it is integration
 * configuration, and which gate guards it should follow what it *is*, not
 * which table it happens to live in.
 *
 * This records the organization's tie-in to Vercel. It does not change how
 * Vercel calls are authenticated — those still use the acting member's own
 * Vercel OAuth credential, because Vercel sign-in is a personal identity and
 * this change does not touch authentication.
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

export interface OrgVercelTeam {
  teamId: string | null;
  teamSlug: string | null;
}

export const orgVercelTeamSchema = z.object({
  teamId: z.string().trim().min(1).nullable(),
  teamSlug: z.string().trim().min(1).nullable(),
});

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

/** Open to any approved member — knowing the team is ordinary information. */
export async function readOrgVercelTeam(
  options?: PermissionCheckOptions,
): Promise<OrgVercelTeam> {
  await requireApprovedMember(options);
  const organizationId = await requireSeededOrganizationId();

  const rows = await db
    .select({
      teamId: orgSettings.vercelTeamId,
      teamSlug: orgSettings.vercelTeamSlug,
    })
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
 * Record the organization's Vercel team.
 *
 * @throws AuthorizationError when the caller lacks `integration.connect`.
 * @throws OrgSettingsError (`invalid`) on malformed input.
 */
export async function setOrgVercelTeam(
  input: unknown,
  options?: PermissionCheckOptions,
): Promise<OrgVercelTeam> {
  await requireApprovedMember(options);
  await requirePermission({ integration: ["connect"] }, options);

  const parsed = orgVercelTeamSchema.safeParse(input);
  if (!parsed.success) {
    throw new OrgSettingsError(
      "invalid",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("; "),
    );
  }

  const organizationId = await requireSeededOrganizationId();

  const rows = await db
    .update(orgSettings)
    .set({
      vercelTeamId: parsed.data.teamId,
      vercelTeamSlug: parsed.data.teamSlug,
      updatedAt: new Date(),
    })
    .where(eq(orgSettings.organizationId, organizationId))
    .returning({
      teamId: orgSettings.vercelTeamId,
      teamSlug: orgSettings.vercelTeamSlug,
    });

  const next = rows[0];
  if (!next) {
    throw new OrgSettingsError(
      "unavailable",
      `Settings for organization ${organizationId} disappeared mid-update.`,
    );
  }

  return next;
}
