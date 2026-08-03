"use client";

import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PendingUser } from "@/lib/org/member-directory";

interface PendingUsersSectionProps {
  pendingUsers: PendingUser[];
  canApprove: boolean;
  busyKey: string | null;
  onApprove: (userId: string) => void;
  onReject: (userId: string) => void;
}

/**
 * Users holding no `org_members` row.
 *
 * "Pending" is the absence of a row, not a role value — which is why this list
 * comes from a LEFT JOIN rather than a role filter.
 */
export function PendingUsersSection({
  pendingUsers,
  canApprove,
  busyKey,
  onApprove,
  onReject,
}: PendingUsersSectionProps) {
  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">
          Waiting for approval ({pendingUsers.length})
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These people can sign in but reach nothing until they are approved.
          Approving grants the <code>member</code> role in the organization.
        </p>
      </div>

      {pendingUsers.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          Nobody is waiting for approval.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pendingUsers.map((user) => (
            <li
              key={user.userId}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user.name ?? user.username}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {user.email ?? "no email address"}
                  {user.email && !user.emailVerified ? " (unverified)" : ""}
                </p>
              </div>

              {canApprove ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busyKey !== null}
                    onClick={() => onApprove(user.userId)}
                  >
                    {busyKey === `approve:${user.userId}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyKey !== null}
                    onClick={() => onReject(user.userId)}
                  >
                    {busyKey === `reject:${user.userId}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <X className="size-4" />
                    )}
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
