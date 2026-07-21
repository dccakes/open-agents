"use client";

import { useState } from "react";
import { AlertTriangleIcon, InfoIcon, SettingsIcon } from "lucide-react";
import type { SettingsSandboxProvider } from "@/hooks/use-settings-sandbox-providers";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SandboxConfigForm } from "./sandbox-config-form";
import { SandboxConfigModal } from "./sandbox-config-modal";
import { SandboxProviderLogo } from "./sandbox-provider-logo";

interface SandboxProviderCardProps {
  provider: SettingsSandboxProvider;
  isSaving?: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onSaveConfig: (config: Record<string, string>) => Promise<void>;
}

function getProviderScopeTags(
  providerType: SettingsSandboxProvider["type"],
): string[] {
  if (providerType === "vercel") {
    return ["LOCAL", "CLOUD"];
  }

  if (providerType === "docker") {
    return ["LOCAL"];
  }

  if (providerType === "daytona") {
    return ["CLOUD"];
  }

  return [];
}

function getStatus(provider: SettingsSandboxProvider): {
  label: string;
  dotClassName: string;
} {
  if (!provider.isAvailable) {
    return {
      label: "Unavailable",
      dotClassName: "bg-muted-foreground/50",
    };
  }

  if (!provider.enabled) {
    return {
      label: "Disabled",
      dotClassName: "bg-muted-foreground/50",
    };
  }

  if (provider.isConfigured) {
    return {
      label: "Configured",
      dotClassName: "bg-emerald-500",
    };
  }

  return {
    label: "Needs configuration",
    dotClassName: "bg-amber-500",
  };
}

export function SandboxProviderCard({
  provider,
  isSaving = false,
  onToggle,
  onSaveConfig,
}: SandboxProviderCardProps) {
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);

  const status = getStatus(provider);
  const scopeTags = getProviderScopeTags(provider.type);
  const isToggleDisabled = isSaving || !provider.isAvailable;
  const showInlineForm =
    provider.enabled &&
    !provider.isConfigured &&
    provider.configFields.length > 0;
  const hasEnvironmentFallback =
    provider.enabled && provider.environmentConfigKeys.length > 0;

  const handleToggleChange = async (enabled: boolean) => {
    setToggleError(null);

    try {
      await onToggle(enabled);
    } catch (error) {
      setToggleError(
        error instanceof Error ? error.message : "Failed to update provider",
      );
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card p-4 shadow-sm",
        !provider.isAvailable && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <SandboxProviderLogo
            providerType={provider.type}
            label={provider.label}
            className={!provider.isAvailable ? "opacity-70" : undefined}
          />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold">
                {provider.label}
              </h3>
              {provider.beta ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                  Beta
                </span>
              ) : null}
              {scopeTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-border/70 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn("size-2 rounded-full", status.dotClassName)}
                aria-hidden
              />
              <span>{status.label}</span>
              {!provider.isAvailable && provider.reasonUnavailable ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Unavailable reason"
                    >
                      <InfoIcon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={8}>
                    {provider.reasonUnavailable}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </div>
        </div>

        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked) => {
            void handleToggleChange(checked);
          }}
          disabled={isToggleDisabled}
          aria-label={`Enable ${provider.label}`}
        />
      </div>

      {toggleError ? (
        <p className="mt-3 text-sm text-destructive">{toggleError}</p>
      ) : null}

      {hasEnvironmentFallback ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Environment variables are used as fallback values. Saved provider
            settings override environment values for your sessions.
          </p>
        </div>
      ) : null}

      {provider.enabled &&
      provider.overriddenEnvironmentConfigKeys.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Saved settings override environment values for{" "}
          {provider.overriddenEnvironmentConfigKeys.join(", ")}.
        </p>
      ) : null}

      {provider.enabled && provider.environmentConfigKeys.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Using environment values for{" "}
          {provider.environmentConfigKeys.join(", ")}. Save settings here to
          override.
        </p>
      ) : null}

      {provider.enabled &&
      provider.isConfigured &&
      provider.configFields.length > 0 ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">Configuration saved</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfigModalOpen(true)}
            disabled={isSaving}
          >
            <SettingsIcon className="size-3.5" />
            Settings
          </Button>
        </div>
      ) : null}

      {showInlineForm ? (
        <div className="mt-4 border-t border-border/60 pt-4">
          <SandboxConfigForm
            fields={provider.configFields}
            initialConfig={provider.config}
            secretConfigKeys={provider.secretConfigKeys}
            onSave={onSaveConfig}
            isSaving={isSaving}
            saveLabel="Save configuration"
          />
        </div>
      ) : null}

      {provider.enabled &&
      provider.isConfigured &&
      provider.configFields.length > 0 ? (
        <SandboxConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          providerLabel={provider.label}
          fields={provider.configFields}
          initialConfig={provider.config}
          secretConfigKeys={provider.secretConfigKeys}
          onSave={onSaveConfig}
          isSaving={isSaving}
        />
      ) : null}
    </div>
  );
}
