"use client";

import { AlertTriangle, Loader2, Triangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VercelConflictView } from "@/lib/org/integration-ownership-actions";

interface Props {
  conflicts: VercelConflictView[];
  team: { teamId: string | null; teamSlug: string | null };
  canManage: boolean;
  pending: boolean;
  onResolve: (input: {
    repoOwner: string;
    repoName: string;
    projectId: string;
  }) => Promise<{ success: boolean }>;
  onSaveTeam: (input: {
    teamId: string | null;
    teamSlug: string | null;
  }) => Promise<{ success: boolean }>;
}

export function VercelLinksSection({
  conflicts,
  team,
  canManage,
  pending,
  onResolve,
  onSaveTeam,
}: Props) {
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
          Which Vercel project a repository deploys to is now one answer for the
          whole organization. Vercel calls still run with each member&rsquo;s
          own Vercel sign-in.
        </p>
      </div>

      <div className="space-y-2 border-b border-border px-5 py-4">
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
              onSaveTeam({
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

      <div className="px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="size-4" />
          Repositories needing a decision
        </h3>
        {/*
          These were left alone on purpose. Picking a winner automatically
          would silently change where someone's work deploys, so the migration
          refuses and asks instead.
        */}
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Members linked these repositories to different Vercel projects, so no
          shared answer was chosen for them. Until one is, each member keeps
          using the project they linked themselves.
        </p>

        {conflicts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing to decide — every repository has one agreed project.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {conflicts.map((conflict) => (
              <li
                key={`${conflict.repoOwner}/${conflict.repoName}`}
                className="rounded-md border border-border px-4 py-3"
              >
                <p className="text-sm font-medium">
                  {conflict.repoOwner}/{conflict.repoName}
                </p>
                <ul className="mt-2 space-y-2">
                  {conflict.candidates.map((candidate) => (
                    <li
                      key={candidate.projectId}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          {candidate.projectName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          linked by {candidate.userIds.length}{" "}
                          {candidate.userIds.length === 1
                            ? "member"
                            : "members"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                          onResolve({
                            repoOwner: conflict.repoOwner,
                            repoName: conflict.repoName,
                            projectId: candidate.projectId,
                          })
                        }
                      >
                        Use this one
                      </Button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
