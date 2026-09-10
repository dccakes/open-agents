"use client";

import { Loader2, Triangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  team: { teamId: string | null; teamSlug: string | null };
  canManage: boolean;
  pending: boolean;
  onSave: (input: {
    teamId: string | null;
    teamSlug: string | null;
  }) => Promise<{ success: boolean }>;
}

export function VercelTeamSection({ team, canManage, pending, onSave }: Props) {
  const [teamId, setTeamId] = useState(team.teamId ?? "");
  const [teamSlug, setTeamSlug] = useState(team.teamSlug ?? "");

  const disabled = !canManage || pending;

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Triangle className="size-4" />
          Vercel
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Which Vercel project a repository deploys to is one answer for the
          whole organization — linking a repository sets it for everyone. Vercel
          calls still run with each member&rsquo;s own Vercel sign-in.
        </p>
      </div>

      <div className="space-y-2 px-5 py-4">
        <Label htmlFor="vercel-team-slug">Vercel team</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="vercel-team-slug"
            placeholder="Team slug"
            className="max-w-56"
            value={teamSlug}
            disabled={disabled}
            onChange={(event) => setTeamSlug(event.target.value)}
          />
          <Input
            aria-label="Vercel team ID"
            placeholder="Team ID"
            className="max-w-56"
            value={teamId}
            disabled={disabled}
            onChange={(event) => setTeamId(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onSave({
                teamId: teamId.trim() === "" ? null : teamId.trim(),
                teamSlug: teamSlug.trim() === "" ? null : teamSlug.trim(),
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>

      {canManage ? null : (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          You can see this but not change it.
        </p>
      )}
    </section>
  );
}
