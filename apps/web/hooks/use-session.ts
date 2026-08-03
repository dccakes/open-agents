"use client";

import useSWR from "swr";
import type { SessionUserInfo } from "@/lib/session/types";
import { fetcher } from "@/lib/swr";

export function useSession() {
  const { data, isLoading } = useSWR<SessionUserInfo>(
    "/api/auth/info",
    fetcher,
    {
      revalidateOnFocus: true,
    },
  );

  return {
    session: data ?? null,
    loading: isLoading,
    isAuthenticated: !!data?.user,
    /** Signed in but holding no membership row — route them to `/pending`. */
    isPendingApproval: data?.isPendingApproval ?? false,
    isAdmin: data?.isAdmin ?? false,
    hasGitHub: data?.hasGitHub ?? false,
    hasGitHubAccount: data?.hasGitHubAccount ?? false,
    hasGitHubInstallations: data?.hasGitHubInstallations ?? false,
  };
}
