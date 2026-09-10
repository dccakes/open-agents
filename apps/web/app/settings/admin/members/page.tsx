import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission } from "@/lib/auth/require-permission";
import { isUserAdmin } from "@/lib/db/users";
import {
  listOrganizationMembers,
  listPendingUsers,
} from "@/lib/org/member-directory";
import { getSessionWithMembership } from "@/lib/session/get-server-session";
import { MembersView } from "./members-view";

export const metadata: Metadata = {
  title: "Members",
};

/**
 * The members and approvals surface.
 *
 * Approve / set-role / remove map onto the organization plugin's own
 * `member.create` / `member.update` / `member.delete` statements — there is no
 * separate `membership` permission resource. Platform-role controls are gated
 * on the *platform* admin role instead, because that is a different question
 * from "may this person administer the organization".
 */
export default async function MembersPage() {
  const { session } = await getSessionWithMembership();

  const [canApprove, canUpdateRoles, canRemove, isPlatformAdmin] =
    await Promise.all([
      hasPermission({ member: ["create"] }),
      hasPermission({ member: ["update"] }),
      hasPermission({ member: ["delete"] }),
      session ? isUserAdmin(session.user.id) : Promise.resolve(false),
    ]);

  if (!(canApprove || canUpdateRoles || canRemove)) {
    notFound();
  }

  const [pendingUsers, members] = await Promise.all([
    listPendingUsers(),
    listOrganizationMembers(),
  ]);

  return (
    <MembersView
      pendingUsers={pendingUsers}
      members={members}
      canApprove={canApprove}
      canUpdateRoles={canUpdateRoles}
      canRemove={canRemove}
      canManagePlatformRole={isPlatformAdmin}
    />
  );
}
