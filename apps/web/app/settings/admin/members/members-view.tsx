"use client";

import { useState } from "react";
import type {
  OrganizationMemberEntry,
  PendingUser,
} from "@/lib/org/member-directory";
import { MemberListSection } from "./member-list-section";
import { PendingUsersSection } from "./pending-users-section";
import { RemoveMemberDialog } from "./remove-member-dialog";
import { useMembershipMutations } from "./use-membership-mutations";

export interface MembersViewProps {
  pendingUsers: PendingUser[];
  members: OrganizationMemberEntry[];
  canApprove: boolean;
  canUpdateRoles: boolean;
  canRemove: boolean;
  canManagePlatformRole: boolean;
}

/**
 * The members and approvals surface.
 *
 * The capability flags only decide which controls render. Each server action
 * re-checks the corresponding permission, because hiding a button is not
 * authorization.
 */
export function MembersView({
  pendingUsers,
  members,
  canApprove,
  canUpdateRoles,
  canRemove,
  canManagePlatformRole,
}: MembersViewProps) {
  const mutations = useMembershipMutations();
  const [memberToRemove, setMemberToRemove] =
    useState<OrganizationMemberEntry | null>(null);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Access is membership in this organization. A signed-in user with no
          membership reaches nothing but the approval screen.
        </p>
      </div>

      <PendingUsersSection
        pendingUsers={pendingUsers}
        canApprove={canApprove}
        busyKey={mutations.busyKey}
        onApprove={(userId) => mutations.approve(userId)}
        onReject={(userId) => mutations.reject(userId)}
      />

      <MemberListSection
        members={members}
        canUpdateRoles={canUpdateRoles}
        canRemove={canRemove}
        canManagePlatformRole={canManagePlatformRole}
        busyKey={mutations.busyKey}
        onRoleChange={(memberId, role) =>
          mutations.setOrganizationRole(memberId, role)
        }
        onRemove={setMemberToRemove}
        onPlatformRoleChange={(userId, isAdmin) =>
          mutations.setPlatform(userId, isAdmin ? "admin" : "user")
        }
        onBanChange={(userId, banned) =>
          banned ? mutations.ban(userId) : mutations.unban(userId)
        }
      />

      <RemoveMemberDialog
        memberLabel={
          memberToRemove
            ? (memberToRemove.name ?? memberToRemove.username)
            : null
        }
        busy={mutations.busyKey !== null}
        onCancel={() => setMemberToRemove(null)}
        onConfirm={() => {
          if (memberToRemove) {
            mutations.remove(memberToRemove.memberId, memberToRemove.userId);
            setMemberToRemove(null);
          }
        }}
      />
    </>
  );
}
