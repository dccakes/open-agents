"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { GitHubAccountsSection } from "./github-accounts-section";
import { LinearActorsSection } from "./linear-actors-section";
import { useIntegrationOwnership } from "./use-integration-ownership";
import { VercelLinksSection } from "./vercel-links-section";

export function IntegrationsView() {
  const {
    view,
    loadError,
    pending,
    claimAccount,
    releaseAccount,
    linkActor,
    unlinkActor,
    resolveConflict,
    saveVercelTeam,
  } = useIntegrationOwnership();

  if (loadError) {
    return (
      <section className="rounded-lg border border-border px-5 py-4">
        <h2 className="text-base font-semibold">Integrations</h2>
        <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
      </section>
    );
  }

  if (!view) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GitHubAccountsSection
        accounts={view.githubAccounts}
        canManage={view.canManage}
        pending={pending}
        onClaim={claimAccount}
        onRelease={releaseAccount}
      />
      <LinearActorsSection
        links={view.linearActorLinks}
        canManage={view.canManage}
        pending={pending}
        onLink={linkActor}
        onUnlink={unlinkActor}
      />
      <VercelLinksSection
        conflicts={view.vercelConflicts}
        team={view.vercelTeam}
        canManage={view.canManage}
        pending={pending}
        onResolve={resolveConflict}
        onSaveTeam={saveVercelTeam}
      />
    </div>
  );
}
