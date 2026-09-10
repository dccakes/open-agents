"use client";

import { Loader2, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LinearActorLinkView } from "@/lib/org/integration-ownership-actions";

interface Props {
  links: LinearActorLinkView[];
  canManage: boolean;
  pending: boolean;
  onLink: (input: {
    linearUserId: string;
    userId: string;
  }) => Promise<{ success: boolean }>;
  onUnlink: (linearUserId: string) => Promise<{ success: boolean }>;
}

export function LinearActorsSection({
  links,
  canManage,
  pending,
  onLink,
  onUnlink,
}: Props) {
  const [linearUserId, setLinearUserId] = useState("");
  const [userId, setUserId] = useState("");

  async function handleLink() {
    const result = await onLink({
      linearUserId: linearUserId.trim(),
      userId: userId.trim(),
    });
    if (result.success) {
      setLinearUserId("");
      setUserId("");
    }
  }

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UserCheck className="size-4" />
          Linear identities
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          A Linear delegation runs as the member who made it. That match is
          normally made on a verified email address — map an identity here when
          someone&rsquo;s Linear address differs from the address they sign in
          with, which is why their delegations would otherwise be refused.
        </p>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          A mapping says <em>who someone is</em>, never what they may do. A
          mapped member who is removed from the organization still starts no
          runs.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {links.length === 0 ? (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            No mappings. Delegations are matched on verified email only.
          </li>
        ) : (
          links.map((link) => (
            <li
              key={link.linearUserId}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {link.linearUserId}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  runs as {link.userId}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canManage || pending}
                onClick={() => onUnlink(link.linearUserId)}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <div className="space-y-2 border-t border-border px-5 py-4">
          <Label htmlFor="linear-user-id">Map an identity</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="linear-user-id"
              placeholder="Linear user ID"
              className="max-w-64"
              value={linearUserId}
              disabled={pending}
              onChange={(event) => setLinearUserId(event.target.value)}
            />
            <Input
              aria-label="QuackOps user ID"
              placeholder="QuackOps user ID"
              className="max-w-64"
              value={userId}
              disabled={pending}
              onChange={(event) => setUserId(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={
                pending || linearUserId.trim() === "" || userId.trim() === ""
              }
              onClick={handleLink}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Map
            </Button>
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">
            The member must already be approved. Mapping an identity is not a
            way to grant access.
          </p>
        </div>
      ) : (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          You can see these mappings but not change them.
        </p>
      )}
    </section>
  );
}
