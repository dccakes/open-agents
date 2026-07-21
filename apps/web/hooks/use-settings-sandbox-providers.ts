"use client";

import type {
  SandboxCapabilities,
  SandboxConfigField,
  SandboxProviderType,
} from "@open-agents/sandbox";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

export interface SettingsSandboxProvider {
  type: SandboxProviderType;
  label: string;
  beta: boolean;
  capabilities: SandboxCapabilities;
  configFields: SandboxConfigField[];
  isAvailable: boolean;
  reasonUnavailable?: string;
  enabled: boolean;
  config: Record<string, string>;
  secretConfigKeys: string[];
  environmentConfigKeys: string[];
  overriddenEnvironmentConfigKeys: string[];
  isConfigured: boolean;
}

interface SettingsSandboxProvidersResponse {
  providers: SettingsSandboxProvider[];
}

export function useSettingsSandboxProviders(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  const { data, error, isLoading, mutate } =
    useSWR<SettingsSandboxProvidersResponse>(
      enabled ? "/api/settings/sandbox-providers" : null,
      fetcher,
    );

  const providers = data?.providers ?? [];
  const selectableProviders = providers.filter(
    (provider) =>
      provider.isAvailable && provider.enabled && provider.isConfigured,
  );

  return {
    providers,
    selectableProviders,
    loading: isLoading,
    error: error?.message ?? null,
    refresh: mutate,
  };
}
