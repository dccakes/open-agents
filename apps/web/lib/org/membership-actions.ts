"use server";

/**
 * The admin-area membership mutations.
 *
 * Every one of these maps onto a permission the organization or admin plugin
 * already defines — there is deliberately no custom `membership` resource:
 *
 * | action              | permission        |
 * |---------------------|-------------------|
 * | approve / reject    | `member.create`   |
 * | change org role     | `member.update`   |
 * | remove              | `member.delete`   |
 * | change platform role| `user.set-role`   |
 * | ban / unban         | `user.ban`        |
 *
 * The mutations themselves go through the plugins' own endpoints wherever one
 * exists, so the last-admin invariants registered in `lib/auth/plugins.ts` and
 * `lib/auth/last-admin-guard.ts` fire rather than being bypassed by a direct
 * write.
 */

import { headers as nextHeaders } from "next/headers";
import { revalidatePath } from "next/cache";
import { recordAuditEvent } from "@/lib/audit/record";
import { auth } from "@/lib/auth/config";
import { requirePermission } from "@/lib/auth/require-permission";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { getSessionWithMembership } from "@/lib/session/get-server-session";
import { revokeUserAccess } from "@/lib/org/revoke-access";

const MEMBERS_PATH = "/settings/admin/members";

export interface MembershipActionResult {
  success: boolean;
  error?: string;
}

/** Org roles an admin may assign. `owner` is included; `pending` is not a role. */
export type AssignableOrganizationRole = "owner" | "admin" | "member";

/** Platform roles, keyed by `users.role`. */
export type AssignablePlatformRole = "admin" | "user";

const ORGANIZATION_ROLES: readonly string[] = ["owner", "admin", "member"];
const PLATFORM_ROLES: readonly string[] = ["admin", "user"];

function toResult(error: unknown): MembershipActionResult {
  const message = error instanceof Error ? error.message : String(error);
  return { success: false, error: message };
}

async function currentActorId(): Promise<string | null> {
  const { session } = await getSessionWithMembership();
  return session?.user.id ?? null;
}

/** True when the plugin refused because the user already holds membership. */
function isAlreadyMemberError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already a member/i.test(message);
}

/**
 * Approve a pending user into the organization.
 *
 * Idempotent: approving someone who already holds membership succeeds without
 * creating a second row, which is what the plugin's uniqueness refusal is
 * translated into here.
 */
export async function approvePendingUser(
  userId: string,
): Promise<MembershipActionResult> {
  try {
    await requirePermission({ member: ["create"] });

    const organizationId = await getSeededOrganizationId();
    if (!organizationId) {
      return { success: false, error: "The organization has not been seeded." };
    }

    try {
      await auth.api.addMember({
        body: { userId, role: "member", organizationId },
        headers: await nextHeaders(),
      });
    } catch (error) {
      if (!isAlreadyMemberError(error)) {
        throw error;
      }
    }

    recordAuditEvent({
      action: "membership.approved",
      actorId: await currentActorId(),
      targetId: userId,
      organizationId,
      metadata: { role: "member" },
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Reject a pending user.
 *
 * There is no membership row to delete — pending *is* the absence of one — so
 * rejecting means recording the decision and cutting the access they do have:
 * their sessions and any share links they published. They stay pending; they
 * can sign in again and will still reach only the approval screen.
 */
export async function rejectPendingUser(
  userId: string,
): Promise<MembershipActionResult> {
  try {
    await requirePermission({ member: ["create"] });

    await revokeUserAccess(userId, { headers: await nextHeaders() });

    recordAuditEvent({
      action: "membership.rejected",
      actorId: await currentActorId(),
      targetId: userId,
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Change a member's organization role. */
export async function setOrganizationMemberRole(
  memberId: string,
  role: AssignableOrganizationRole,
): Promise<MembershipActionResult> {
  try {
    if (!ORGANIZATION_ROLES.includes(role)) {
      return { success: false, error: `Unknown organization role: ${role}` };
    }

    await requirePermission({ member: ["update"] });

    const organizationId = await getSeededOrganizationId();
    if (!organizationId) {
      return { success: false, error: "The organization has not been seeded." };
    }

    // Through the plugin endpoint, so `beforeUpdateMemberRole` runs and the
    // last owner/admin cannot be demoted.
    await auth.api.updateMemberRole({
      body: { memberId, role, organizationId },
      headers: await nextHeaders(),
    });

    recordAuditEvent({
      action: "membership.role_changed",
      actorId: await currentActorId(),
      targetId: memberId,
      organizationId,
      metadata: { role },
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Remove a member from the organization and cut their live access.
 *
 * Does **not** stop their in-flight agent runs — see `revoke-access.ts`. The
 * UI says so rather than implying otherwise.
 */
export async function removeOrganizationMember(
  memberId: string,
  userId: string,
): Promise<MembershipActionResult> {
  try {
    await requirePermission({ member: ["delete"] });

    const organizationId = await getSeededOrganizationId();
    if (!organizationId) {
      return { success: false, error: "The organization has not been seeded." };
    }

    // Through the plugin endpoint, so `beforeRemoveMember` runs and the last
    // owner/admin cannot be removed.
    await auth.api.removeMember({
      body: { memberIdOrEmail: memberId, organizationId },
      headers: await nextHeaders(),
    });

    await revokeUserAccess(userId, { headers: await nextHeaders() });

    recordAuditEvent({
      action: "membership.removed",
      actorId: await currentActorId(),
      targetId: userId,
      organizationId,
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/**
 * Grant or revoke the platform `admin` role.
 *
 * Separate from the organization role on purpose: this governs instance-level
 * operations that exist above any organization (ban, impersonation, session
 * revocation, bulk OAuth token revocation), and holding org `admin` grants
 * none of them.
 */
export async function setPlatformRole(
  userId: string,
  role: AssignablePlatformRole,
): Promise<MembershipActionResult> {
  try {
    if (!PLATFORM_ROLES.includes(role)) {
      return { success: false, error: `Unknown platform role: ${role}` };
    }

    await requirePermission({ user: ["set-role"] });

    // The `/admin/set-role` request hook refuses demoting the last platform
    // admin, so that invariant holds here without being restated.
    await auth.api.setRole({
      body: { userId, role },
      headers: await nextHeaders(),
    });

    recordAuditEvent({
      action: "platform_role.changed",
      actorId: await currentActorId(),
      targetId: userId,
      metadata: { role },
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Ban a user, then cut their sessions and share links. */
export async function banOrganizationMember(
  userId: string,
  reason?: string,
): Promise<MembershipActionResult> {
  try {
    await requirePermission({ user: ["ban"] });

    await auth.api.banUser({
      body: { userId, ...(reason ? { banReason: reason } : {}) },
      headers: await nextHeaders(),
    });

    await revokeUserAccess(userId, { headers: await nextHeaders() });

    recordAuditEvent({
      action: "membership.removed",
      actorId: await currentActorId(),
      targetId: userId,
      metadata: { banned: true, reason: reason ?? null },
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}

/** Lift a ban. Sessions are not restored; the user signs in again. */
export async function unbanOrganizationMember(
  userId: string,
): Promise<MembershipActionResult> {
  try {
    await requirePermission({ user: ["ban"] });

    await auth.api.unbanUser({
      body: { userId },
      headers: await nextHeaders(),
    });

    recordAuditEvent({
      action: "membership.role_changed",
      actorId: await currentActorId(),
      targetId: userId,
      metadata: { banned: false },
    });

    revalidatePath(MEMBERS_PATH);
    return { success: true };
  } catch (error) {
    return toResult(error);
  }
}
