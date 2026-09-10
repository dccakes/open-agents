/**
 * The organization's Vercel team.
 *
 * Stored on the `org_settings` row for convenience, but gated on
 * `integration.connect` rather than `orgSettings.update`: it is integration
 * configuration, and which gate guards it should follow what it *is*, not
 * which table it happens to live in.
 *
 * That different gate is the *only* thing that lives here. The read comes from
 * `readOrgSettings()`, and the write keeps `updateOrgSettings`' transaction and
 * audit record — an earlier draft re-implemented both, which quietly gave
 * `org_settings` a second writer with weaker durability than the first, and
 * would have left these two columns outside the audit trail that
 * `shared-config-governance` is going to fill in.
 *
 * This records the organization's tie-in to Vercel. It does not change how
 * Vercel calls are authenticated — those still use the acting member's own
 * Vercel OAuth credential, because Vercel sign-in is a personal identity and
 * this change does not touch authentication.
 */

import { z } from "zod";
import {
  type PermissionCheckOptions,
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import { readOrgSettings, writeOrgSettingsFields } from "@/lib/org/settings";
import { OrgSettingsError } from "@/lib/org/settings-errors";

export interface OrgVercelTeam {
  teamId: string | null;
  teamSlug: string | null;
}

const orgVercelTeamSchema = z.object({
  teamId: z.string().trim().min(1).nullable(),
  teamSlug: z.string().trim().min(1).nullable(),
});

/** Open to any approved member — knowing the team is ordinary information. */
export async function readOrgVercelTeam(
  options?: PermissionCheckOptions,
): Promise<OrgVercelTeam> {
  await requireApprovedMember(options);
  const settings = await readOrgSettings();

  return {
    teamId: settings.vercelTeamId,
    teamSlug: settings.vercelTeamSlug,
  };
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
  const actor = await requireApprovedMember(options);
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

  const next = await writeOrgSettingsFields(
    {
      vercelTeamId: parsed.data.teamId,
      vercelTeamSlug: parsed.data.teamSlug,
    },
    actor.userId,
  );

  return { teamId: next.vercelTeamId, teamSlug: next.vercelTeamSlug };
}
