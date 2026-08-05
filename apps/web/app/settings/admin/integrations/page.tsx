import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireApprovedMember } from "@/lib/auth/require-permission";
import { IntegrationsView } from "./integrations-view";

export const metadata: Metadata = {
  title: "Integrations",
};

/**
 * Who owns which integration, and the decisions that ownership needs.
 *
 * Reading is open to any approved member — the mutations underneath are each
 * gated on `integration.connect` / `integration.disconnect` in their own
 * module. This page's own check is membership, so a pending user gets the
 * same 404 every other protected surface gives them.
 */
export default async function IntegrationsPage() {
  try {
    await requireApprovedMember();
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          GitHub, Linear, and Vercel connections belong to the organization, not
          to whoever set them up. This is where you say which ones are ours.
        </p>
      </div>
      <IntegrationsView />
    </div>
  );
}
