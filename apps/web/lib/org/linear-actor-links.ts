/**
 * Administering the Linear identity mappings.
 *
 * Reads are open to any approved member — knowing who is mapped is ordinary
 * team information. Writes are gated on `integration.connect`, because a
 * mapping decides whose account a Linear delegation runs as, and anyone who
 * could write one for themselves could run as anybody.
 */

import {
  type PermissionCheckOptions,
  requireApprovedMember,
  requirePermission,
} from "@/lib/auth/require-permission";
import {
  deleteLinearActorLink,
  listLinearActorLinks,
  upsertLinearActorLink,
} from "@/lib/db/linear-actor-links";
import type { LinearActorLink } from "@/lib/db/schema";
import { isApprovedMember } from "@/lib/org/membership";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { OrgSettingsError } from "@/lib/org/settings-errors";

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

export async function readLinearActorLinks(
  options?: PermissionCheckOptions,
): Promise<LinearActorLink[]> {
  await requireApprovedMember(options);
  const organizationId = await requireSeededOrganizationId();
  return await listLinearActorLinks(organizationId);
}

/**
 * Map a Linear identity to a member.
 *
 * The target must already be an approved member. Mapping to a pending user
 * would be a way to grant access from a screen that is not the membership
 * screen — the actor resolution would refuse the run anyway, but a mapping
 * that silently does nothing is worse than one that refuses to be created.
 *
 * @throws AuthorizationError when the caller lacks `integration.connect`.
 * @throws OrgSettingsError (`invalid`) on empty input or a non-member target.
 */
export async function linkLinearActor(
  params: { linearUserId: string; userId: string },
  options?: PermissionCheckOptions,
): Promise<LinearActorLink> {
  const actor = await requireApprovedMember(options);
  await requirePermission({ integration: ["connect"] }, options);

  const linearUserId = params.linearUserId.trim();
  if (linearUserId === "" || params.userId.trim() === "") {
    throw new OrgSettingsError(
      "invalid",
      "A Linear actor mapping needs both a Linear user id and a QuackOps user.",
    );
  }

  if (!(await isApprovedMember(params.userId))) {
    throw new OrgSettingsError(
      "invalid",
      "That user is not an approved member of the organization. Approve them first, then map their Linear identity.",
    );
  }

  const organizationId = await requireSeededOrganizationId();

  return await upsertLinearActorLink({
    organizationId,
    linearUserId,
    userId: params.userId,
    createdByUserId: actor.userId,
  });
}

/** @throws AuthorizationError when the caller lacks `integration.connect`. */
export async function unlinkLinearActor(
  linearUserId: string,
  options?: PermissionCheckOptions,
): Promise<boolean> {
  await requireApprovedMember(options);
  await requirePermission({ integration: ["connect"] }, options);

  const organizationId = await requireSeededOrganizationId();
  return await deleteLinearActorLink(organizationId, linearUserId);
}
