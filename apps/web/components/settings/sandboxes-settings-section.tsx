"use client";

import type { SandboxProviderType } from "@open-agents/sandbox";
import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { DefaultSandboxPicker } from "@/components/settings/default-sandbox-picker";
import { SandboxProviderCard } from "@/components/settings/sandbox-provider-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsSandboxProviders } from "@/hooks/use-settings-sandbox-providers";
import { useUserPreferences } from "@/hooks/use-user-preferences";

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}

export function SandboxesSettingsSection() {
  const {
    providers,
    loading: providersLoading,
    error: providersError,
    refresh: refreshProviders,
  } = useSettingsSandboxProviders();
  const {
    preferences,
    loading: preferencesLoading,
    refreshPreferences,
  } = useUserPreferences();

  const [savingProviderType, setSavingProviderType] =
    useState<SandboxProviderType | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const defaultSandboxType = preferences?.defaultSandboxType ?? null;

  const defaultPickerOptions = providers
    .filter(
      (provider) =>
        provider.isAvailable && provider.enabled && provider.isConfigured,
    )
    .map((provider) => ({
      type: provider.type,
      label: provider.label,
    }));

  const defaultIsValid = Boolean(
    defaultSandboxType &&
    defaultPickerOptions.some((option) => option.type === defaultSandboxType),
  );

  const showDefaultWarning = defaultSandboxType !== null && !defaultIsValid;

  const handleProviderPatch = async (
    providerType: SandboxProviderType,
    patch: {
      enabled?: boolean;
      config?: Record<string, string>;
    },
  ) => {
    setActionError(null);
    setSavingProviderType(providerType);

    try {
      const response = await fetch(
        `/api/settings/sandbox-providers/${providerType}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(patch),
        },
      );

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to update provider settings");
      }

      await refreshProviders();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to update provider settings";
      setActionError(message);
      throw error;
    } finally {
      setSavingProviderType(null);
    }
  };

  const handleDefaultSandboxChange = async (
    providerType: SandboxProviderType,
  ) => {
    setActionError(null);
    setSavingDefault(true);

    try {
      const response = await fetch("/api/settings/user-preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defaultSandboxType: providerType,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to update default sandbox");
      }

      await refreshPreferences();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to update default sandbox",
      );
    } finally {
      setSavingDefault(false);
    }
  };

  if (providersLoading || preferencesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (providersError) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={providersError} />
        <Button
          type="button"
          variant="outline"
          onClick={() => void refreshProviders()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <DefaultSandboxPicker
          options={defaultPickerOptions}
          value={defaultSandboxType}
          disabled={savingDefault}
          onChange={handleDefaultSandboxChange}
        />
        {showDefaultWarning ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <p>
              Your current default sandbox is no longer enabled and configured.
              Choose a new default.
            </p>
          </div>
        ) : null}
      </div>

      {actionError ? <ErrorBanner message={actionError} /> : null}

      <div className="grid gap-4">
        {providers.map((provider) => (
          <SandboxProviderCard
            key={provider.type}
            provider={provider}
            isSaving={savingProviderType === provider.type}
            onToggle={(enabled) =>
              handleProviderPatch(provider.type, {
                enabled,
              })
            }
            onSaveConfig={(config) =>
              handleProviderPatch(provider.type, {
                config,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}
