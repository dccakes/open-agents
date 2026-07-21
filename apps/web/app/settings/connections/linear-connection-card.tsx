"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/swr";

interface LinearConnectionStatus {
  connected: boolean;
  workspaceName?: string;
  workspaceId?: string;
  reason?: string;
}

function LinearIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Linear"
    >
      <path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857l36.0112 36.0112c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375 1.1378.28565635 1.5644 1.33666665 1.5644l49.4862-.0589c1.0511 0 1.5578-.5068 1.5578-1.5578l-.0589-49.4863c0-1.05101-.4267-1.35430-1.5644-1.33666-.9285.01435-1.8545.04719-2.7776.09846l-.0001.0001C26.0411 1.10914 1.10914 26.041.09836 48.6115c-.05127.9231-.08411 1.849-.09647 2.7776ZM6.98249 66.925c-.15832-.5936.47946-1.0845.99999-.7417l26.837 26.837c.3428.5206-.1481 1.1584-.7417.9999C27.0165 90.5037 15.4955 79.3614 6.98249 66.925ZM15.5172 77.9155c-.1797-.5698.39993-1.0516.93038-.7585l6.3367 6.3367c.2931.5305-.1887 1.1101-.7585.9304-2.3668-.7472-4.5346-2.1569-6.5085-6.5086Z" />
    </svg>
  );
}

function useLinearReturnToast() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const linearParam = searchParams.get("linear");
    if (!linearParam) return;

    const url = new URL(window.location.href);
    url.searchParams.delete("linear");
    window.history.replaceState({}, "", url.toString());

    switch (linearParam) {
      case "connected":
        toast.success("Linear workspace connected");
        break;
      case "error":
        toast.error("Failed to connect Linear workspace");
        break;
      case "org_required":
        toast.error(
          "Linear requires a workspace (organization). Personal accounts are not supported.",
        );
        break;
      case "not_configured":
        toast.error("Linear is not configured on this deployment");
        break;
      default:
        break;
    }
  }, [searchParams]);
}

export function LinearConnectionCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-14" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="p-4">
        <Skeleton className="h-4 w-72" />
      </div>
    </div>
  );
}

export function LinearConnectionCard() {
  const { mutate } = useSWRConfig();
  const [disconnecting, setDisconnecting] = useState(false);

  useLinearReturnToast();

  const { data, isLoading } = useSWR<LinearConnectionStatus>(
    "/api/linear/connection-status",
    fetcher,
  );

  if (isLoading) {
    return <LinearConnectionCardSkeleton />;
  }

  const connected = data?.connected ?? false;

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/linear/disconnect", { method: "POST" });
      if (!res.ok) {
        throw new Error("Request failed");
      }
      await mutate("/api/linear/connection-status");
      toast.success("Linear workspace disconnected");
    } catch {
      toast.error("Failed to disconnect Linear workspace");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div>
          <div className="flex items-center gap-2.5">
            <LinearIcon className="h-4 w-4" />
            <span className="text-sm font-medium">Linear</span>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Workspace-level agent integration
          </p>
        </div>

        {connected ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? (
              <Loader2 className="mr-1.5 size-3 animate-spin" />
            ) : null}
            Disconnect
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              window.location.href = "/api/linear/connect";
            }}
          >
            Connect Linear
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        {connected ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{data?.workspaceName}</span>
            <span className="text-muted-foreground">·</span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-3.5" />
              Connected
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect your Linear workspace to link issues and sync work with your
            agents.
          </p>
        )}
      </div>
    </div>
  );
}
