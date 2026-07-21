import type { Metadata } from "next";
import { SandboxesSettingsSection } from "@/components/settings/sandboxes-settings-section";

export const metadata: Metadata = {
  title: "Sandboxes",
  description: "Manage sandbox providers and your default sandbox.",
};

export default function SandboxesSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sandboxes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enable providers, configure credentials, and choose a default sandbox.
        </p>
      </div>
      <SandboxesSettingsSection />
    </div>
  );
}
