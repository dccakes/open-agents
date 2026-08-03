"use client";

import { Ban, Loader2, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrganizationMemberEntry } from "@/lib/org/member-directory";
import type { AssignableOrganizationRole } from "@/lib/org/membership-actions";

const ORGANIZATION_ROLES: AssignableOrganizationRole[] = [
  "owner",
  "admin",
  "member",
];

interface MemberListSectionProps {
  members: OrganizationMemberEntry[];
  canUpdateRoles: boolean;
  canRemove: boolean;
  canManagePlatformRole: boolean;
  busyKey: string | null;
  onRoleChange: (memberId: string, role: AssignableOrganizationRole) => void;
  onRemove: (member: OrganizationMemberEntry) => void;
  onPlatformRoleChange: (userId: string, isAdmin: boolean) => void;
  onBanChange: (userId: string, banned: boolean) => void;
}

export function MemberListSection({
  members,
  canUpdateRoles,
  canRemove,
  canManagePlatformRole,
  busyKey,
  onRoleChange,
  onRemove,
  onPlatformRoleChange,
  onBanChange,
}: MemberListSectionProps) {
  const busy = busyKey !== null;

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Members ({members.length})</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The organization role governs shared configuration. The platform admin
          role is separate and governs instance-wide operations — bans,
          impersonation, and bulk token revocation.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {members.map((member) => (
          <li key={member.memberId} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.name ?? member.username}
                  {member.platformRole === "admin" ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      <ShieldCheck className="size-3" />
                      Platform admin
                    </span>
                  ) : null}
                  {member.banned ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-0.5 text-xs text-destructive">
                      <Ban className="size-3" />
                      Banned
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {member.email ?? "no email address"}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Select
                  value={member.role}
                  disabled={!canUpdateRoles || busy}
                  onValueChange={(role) =>
                    onRoleChange(
                      member.memberId,
                      role as AssignableOrganizationRole,
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORGANIZATION_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {busyKey === `role:${member.memberId}` ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : null}

                {canManagePlatformRole ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      onPlatformRoleChange(
                        member.userId,
                        member.platformRole !== "admin",
                      )
                    }
                  >
                    {busyKey === `platform:${member.userId}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="size-4" />
                    )}
                    {member.platformRole === "admin"
                      ? "Revoke platform admin"
                      : "Grant platform admin"}
                  </Button>
                ) : null}

                {canManagePlatformRole ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onBanChange(member.userId, !member.banned)}
                  >
                    {busyKey === `ban:${member.userId}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : member.banned ? (
                      <Undo2 className="size-4" />
                    ) : (
                      <Ban className="size-4" />
                    )}
                    {member.banned ? "Lift ban" : "Ban"}
                  </Button>
                ) : null}

                {canRemove ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRemove(member)}
                  >
                    {busyKey === `remove:${member.memberId}` ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
