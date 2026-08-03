"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type {
  AssignableOrganizationRole,
  AssignablePlatformRole,
  MembershipActionResult,
} from "@/lib/org/membership-actions";
import {
  approvePendingUser,
  banOrganizationMember,
  rejectPendingUser,
  removeOrganizationMember,
  setOrganizationMemberRole,
  setPlatformRole,
  unbanOrganizationMember,
} from "@/lib/org/membership-actions";

/**
 * Client-side plumbing for the membership mutations.
 *
 * The server actions are the authorization boundary; this hook only tracks
 * which row is busy and surfaces the result. Every control it drives is also
 * checked server-side — hiding a button is not authorization.
 */
export function useMembershipMutations() {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const run = useCallback(
    async (
      key: string,
      action: () => Promise<MembershipActionResult>,
      successMessage: string,
    ) => {
      setBusyKey(key);
      try {
        const result = await action();
        if (result.success) {
          toast.success(successMessage);
          router.refresh();
        } else {
          toast.error(result.error ?? "The action could not be completed");
        }
      } catch {
        toast.error("An unexpected error occurred");
      } finally {
        setBusyKey(null);
      }
    },
    [router],
  );

  return {
    busyKey,
    approve: (userId: string) =>
      run(
        `approve:${userId}`,
        () => approvePendingUser(userId),
        "User approved",
      ),
    reject: (userId: string) =>
      run(
        `reject:${userId}`,
        () => rejectPendingUser(userId),
        "Request rejected; their sessions and shares were revoked",
      ),
    setOrganizationRole: (memberId: string, role: AssignableOrganizationRole) =>
      run(
        `role:${memberId}`,
        () => setOrganizationMemberRole(memberId, role),
        `Organization role set to ${role}`,
      ),
    remove: (memberId: string, userId: string) =>
      run(
        `remove:${memberId}`,
        () => removeOrganizationMember(memberId, userId),
        "Member removed; their sessions and shares were revoked",
      ),
    setPlatform: (userId: string, role: AssignablePlatformRole) =>
      run(
        `platform:${userId}`,
        () => setPlatformRole(userId, role),
        role === "admin" ? "Platform admin granted" : "Platform admin revoked",
      ),
    ban: (userId: string) =>
      run(
        `ban:${userId}`,
        () => banOrganizationMember(userId),
        "User banned; their sessions and shares were revoked",
      ),
    unban: (userId: string) =>
      run(`ban:${userId}`, () => unbanOrganizationMember(userId), "Ban lifted"),
  };
}
