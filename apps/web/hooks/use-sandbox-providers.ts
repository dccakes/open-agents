"use client";

import useSWR from "swr";
import type {
  SandboxCapabilities,
  SandboxProviderType,
} from "@open-agents/sandbox";
import { fetcher } from "@/lib/swr";

export interface SandboxProviderAvailability {
  type: SandboxProviderType;
  label: string;
  beta: boolean;
  capabilities: SandboxCapabilities;
  available: boolean;
  reasonUnavailable?: string;
}

interface SandboxProvidersResponse {
  providers: SandboxProviderAvailability[];
}

export function useSandboxProviders(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;

  const { data, error, isLoading } = useSWR<SandboxProvidersResponse>(
    enabled ? "/api/sandbox/providers" : null,
    fetcher,
  );

  const providers = data?.providers ?? [];
  const availableProviders = providers.filter((provider) => provider.available);

  return {
    providers,
    availableProviders,
    loading: isLoading,
    error: error?.message ?? null,
  };
}
