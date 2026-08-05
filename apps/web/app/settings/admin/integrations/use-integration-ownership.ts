"use client";

/**
 * Loading and mutating integration ownership from the admin surface.
 *
 * The hook holds every call so the section components stay presentational —
 * and so the "reload after a mutation" rule lives once rather than in each
 * handler. Reloading rather than patching local state is deliberate: a
 * promotion changes installation records this view does not itself hold, and a
 * stale optimistic row here would misreport who owns what.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  claimGitHubAccountAction,
  type IntegrationOwnershipView,
  linkLinearActorAction,
  loadIntegrationOwnership,
  releaseGitHubAccountAction,
  setOrgVercelTeamAction,
  unlinkLinearActorAction,
} from "@/lib/org/integration-ownership-actions";

export function useIntegrationOwnership() {
  const [view, setView] = useState<IntegrationOwnershipView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reload = useCallback(async () => {
    const result = await loadIntegrationOwnership();
    if (result.success) {
      setView(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      action: () => Promise<{ success: boolean; error?: string }>,
      successMessage: string,
    ): Promise<{ success: boolean }> => {
      setPending(true);
      try {
        const result = await action();
        if (!result.success) {
          // The message is surfaced here rather than returned; no caller reads
          // it, they only branch on success to decide whether to clear a form.
          toast.error(result.error ?? "That didn't work.");
          return { success: false };
        }
        toast.success(successMessage);
        await reload();
        return { success: true };
      } finally {
        setPending(false);
      }
    },
    [reload],
  );

  const claimAccount = useCallback(
    (input: {
      accountId: number;
      accountLogin: string;
      accountType: "User" | "Organization";
    }) =>
      run(
        () => claimGitHubAccountAction(input),
        `${input.accountLogin} is now shared with the organization.`,
      ),
    [run],
  );

  const releaseAccount = useCallback(
    (accountId: number, accountLogin: string) =>
      run(
        () => releaseGitHubAccountAction(accountId),
        `${accountLogin} is no longer shared.`,
      ),
    [run],
  );

  const linkActor = useCallback(
    (input: { linearUserId: string; userId: string }) =>
      run(() => linkLinearActorAction(input), "Linear identity mapped."),
    [run],
  );

  const unlinkActor = useCallback(
    (linearUserId: string) =>
      run(() => unlinkLinearActorAction(linearUserId), "Mapping removed."),
    [run],
  );

  const saveVercelTeam = useCallback(
    (input: { teamId: string | null; teamSlug: string | null }) =>
      run(() => setOrgVercelTeamAction(input), "Vercel team recorded."),
    [run],
  );

  return {
    view,
    loadError,
    pending,
    claimAccount,
    releaseAccount,
    linkActor,
    unlinkActor,
    saveVercelTeam,
  };
}
