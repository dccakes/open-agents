import { Cloud, Container } from "lucide-react";
import Image from "next/image";
import type { SandboxProviderType } from "@open-agents/sandbox";
import { cn } from "@/lib/utils";

interface SandboxProviderLogoProps {
  providerType: SandboxProviderType;
  label: string;
  className?: string;
}

export function SandboxProviderLogo({
  providerType,
  label,
  className,
}: SandboxProviderLogoProps) {
  if (providerType === "vercel") {
    return (
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md border border-border/70 bg-background",
          className,
        )}
      >
        <Image src="/vercel.svg" alt="Vercel" width={16} height={16} />
      </span>
    );
  }

  if (providerType === "docker") {
    return (
      <span
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md border border-border/70 bg-background text-blue-600",
          className,
        )}
        aria-label={label}
      >
        <Container className="size-4" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md border border-border/70 bg-background text-sky-600",
        className,
      )}
      aria-label={label}
    >
      <Cloud className="size-4" />
    </span>
  );
}
