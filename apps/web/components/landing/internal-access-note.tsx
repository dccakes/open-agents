import { cn } from "@/lib/utils";

/**
 * QuackOps is an internal Pickle engineering tool — this makes the access
 * boundary explicit for anyone who lands on the page.
 */
export function InternalAccessNote({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 text-sm leading-relaxed text-white/55",
        className,
      )}
    >
      <LockIcon className="mt-0.5 size-3.5 shrink-0 text-(--pk-accent)" />
      <span>
        Pickle employees only. Sign in with the Vercel account on the Pickle
        team — access requests go to{" "}
        <span className="text-white/75">#eng-platform</span>.
      </span>
    </p>
  );
}

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
    >
      <rect height="7" rx="1.5" width="10" x="3" y="7" />
      <path d="M5.5 7V4.75a2.5 2.5 0 015 0V7" />
    </svg>
  );
}
