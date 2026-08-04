"use client";

import {
  Check,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldHalf,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Posture } from "@/lib/policy/posture";
import { useSessionPosture } from "./hooks/use-session-posture";

/**
 * The session's security posture, in the header where it stays visible.
 *
 * Two things the spec is explicit about live here:
 *
 * - **A `dangerous` session is marked persistently.** It is not a state anyone
 *   should be able to forget they are in.
 * - **A posture change applies to what comes next.** It does not stop a run in
 *   flight or undo work already done, and the menu says so, because a user who
 *   tightens the posture to halt something needs to know it will not.
 *
 * The `dangerous` option is simply absent for a user who cannot select it —
 * `availablePostures` comes from the server. Hiding it is not the enforcement;
 * `updateSessionPosture` refuses it whether or not it was ever rendered.
 */

export type PostureTone = "strict" | "neutral" | "danger";

export interface PostureDescription {
  label: string;
  description: string;
  tone: PostureTone;
}

export const POSTURE_CHANGE_NOTICE =
  "A posture change applies to subsequent operations. It does not stop a run that is already in flight, and it does not undo work already performed.";

const DESCRIPTIONS: Record<Posture, PostureDescription> = {
  strict: {
    label: "Strict",
    description:
      "Every side-effecting operation waits for approval, including the app's own commits and pull requests. Reads are unaffected.",
    tone: "strict",
  },
  auto: {
    label: "Auto",
    description:
      "The policy decides: allowed operations run, risky ones ask, denied ones are refused.",
    tone: "neutral",
  },
  dangerous: {
    label: "Dangerous",
    description:
      "Anything that would ask runs without asking. Denied operations are still denied — no posture bypasses a denial.",
    tone: "danger",
  },
};

export function describePosture(posture: Posture): PostureDescription {
  return DESCRIPTIONS[posture];
}

/** Whether this session carries the persistent `dangerous` marking. */
export function shouldShowDangerousBadge(posture: Posture | null): boolean {
  return posture === "dangerous";
}

function PostureIcon({ posture }: { posture: Posture }) {
  if (posture === "dangerous") {
    return <ShieldAlert className="h-4 w-4 text-red-500" />;
  }
  if (posture === "strict") {
    return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
  }
  return <ShieldHalf className="h-4 w-4 text-muted-foreground" />;
}

export function SessionPostureControl({ sessionId }: { sessionId: string }) {
  const posture = useSessionPosture(sessionId);
  const current = posture.posture;

  if (posture.loading || !current) {
    return null;
  }

  const described = describePosture(current);
  const dangerous = shouldShowDangerousBadge(current);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 shrink-0 gap-1.5 px-2 text-xs",
                dangerous &&
                  "border border-red-500/40 bg-red-500/10 font-medium text-red-500 hover:bg-red-500/20 hover:text-red-500",
              )}
            >
              {posture.saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PostureIcon posture={current} />
              )}
              <span className={cn(!dangerous && "hidden sm:inline")}>
                {described.label}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {`Security posture: ${described.label}`}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Security posture</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {posture.availablePostures.map((option) => {
          const optionDescription = describePosture(option);
          return (
            <DropdownMenuItem
              key={option}
              className="items-start gap-2"
              disabled={posture.saving}
              onClick={() => posture.select(option)}
            >
              <span className="mt-0.5 h-4 w-4 shrink-0">
                {option === current ? <Check className="h-4 w-4" /> : null}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    optionDescription.tone === "danger" && "text-red-500",
                  )}
                >
                  {optionDescription.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {optionDescription.description}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {POSTURE_CHANGE_NOTICE}
        </div>
        {posture.error ? (
          <div className="px-2 pb-1.5 text-xs text-red-500">
            {posture.error}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
