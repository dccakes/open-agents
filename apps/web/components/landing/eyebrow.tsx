import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pill-shaped section label with a leading accent node — the eyebrow treatment
 * used across withpickle.com.
 */
export function Eyebrow({
  children,
  className,
  tone = "light",
  pulse = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly tone?: "light" | "dark";
  readonly pulse?: boolean;
}) {
  const onDark = tone === "dark";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em]",
        onDark
          ? "border-white/20 bg-white/10 text-white/80 backdrop-blur-sm"
          : "border-(--l-border) bg-(--l-surface) text-(--l-fg-2)",
        className,
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-(--pk-accent)",
          pulse && "pk-pulse-ring",
        )}
      />
      {children}
    </span>
  );
}
