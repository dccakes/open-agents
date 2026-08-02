import { cn } from "@/lib/utils";

/**
 * QuackOps is an internal Pickle engineering tool — this makes the access
 * boundary explicit for anyone who lands on the page.
 */
export function InternalAccessNote({
  className,
  tone = "dark",
}: {
  readonly className?: string;
  readonly tone?: "light" | "dark";
}) {
  const onDark = tone === "dark";

  return (
    <p
      className={cn(
        "flex items-start gap-2 text-sm leading-relaxed",
        onDark ? "text-white/55" : "text-(--l-fg-3)",
        className,
      )}
    >
      <LockIcon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          onDark ? "text-(--pk-accent)" : "text-(--pk-primary)",
        )}
      />
      <span>
        Pickle employees only. Sign in with the Vercel account on the Pickle
        team — access requests go to{" "}
        <span className={onDark ? "text-white/75" : "text-(--l-fg-2)"}>
          #eng-platform
        </span>
        .
      </span>
    </p>
  );
}

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V4.75a2.5 2.5 0 015 0V7" />
    </svg>
  );
}
