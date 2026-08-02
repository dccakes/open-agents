import { cn } from "@/lib/utils";
import { PickleStar } from "./pickle-star";

type LogoTone = "light" | "dark";

/**
 * QuackOps lockup: the Pickle star paired with the product wordmark.
 * `tone="dark"` is for placement on the dark teal brand surfaces.
 */
export function Logo({
  className,
  tone = "light",
  showSuffix = true,
}: {
  readonly className?: string;
  readonly tone?: LogoTone;
  readonly showSuffix?: boolean;
}) {
  const onDark = tone === "dark";

  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      aria-label="QuackOps by Pickle"
    >
      <PickleStar
        className={cn(
          "size-6 shrink-0",
          onDark ? "text-(--pk-accent)" : "text-(--pk-primary)",
        )}
      />
      <span className="inline-flex items-baseline gap-2">
        <span
          className={cn(
            "text-[17px] font-semibold tracking-tight",
            onDark ? "text-white" : "text-foreground",
          )}
        >
          QuackOps
        </span>
        {showSuffix ? (
          <span
            className={cn(
              "hidden font-mono text-[10px] uppercase tracking-[0.14em] sm:inline",
              onDark ? "text-white/45" : "text-muted-foreground",
            )}
          >
            Pickle Eng
          </span>
        ) : null}
      </span>
    </span>
  );
}
