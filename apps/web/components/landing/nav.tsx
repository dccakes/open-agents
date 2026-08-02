"use client";

import { useEffect, useState } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { cn } from "@/lib/utils";
import { brandButton } from "./brand-button";
import { GitHubLink } from "./github-link";
import { Logo } from "./logo";

const NAV_LINKS = [
  { href: "#about", label: "Why" },
  { href: "#product", label: "Product" },
  { href: "#platform", label: "Platform" },
] as const;

/**
 * Floating pill navigation on the dark teal brand surface, matching the shell
 * used across withpickle.com.
 */
export function LandingNav({
  showSignIn = false,
}: {
  readonly showSignIn?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handle = () => setScrolled(window.scrollY > 10);
    handle();
    window.addEventListener("scroll", handle, { passive: true });
    return () => window.removeEventListener("scroll", handle);
  }, []);

  return (
    <div className="fixed left-0 right-0 top-0 z-50 flex justify-center px-4 pt-4 md:px-8">
      <nav
        className={cn(
          "w-full max-w-[1200px] rounded-full bg-(--pk-dark-teal)/95 backdrop-blur-sm transition-all duration-300",
          scrolled
            ? "border border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
            : "border border-transparent",
        )}
      >
        <div className="flex h-[60px] items-center justify-between px-4 md:px-8">
          <a href="#top" className="shrink-0">
            <Logo tone="dark" />
          </a>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-white/80 transition-colors hover:text-(--pk-accent)"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <GitHubLink
              variant="ghost"
              size="icon"
              className="rounded-full text-white/70 hover:bg-white/10 hover:text-(--pk-accent)"
            />
            <div
              className={cn(
                "transition-all duration-150 [transition-timing-function:cubic-bezier(0.4,0.04,0.04,1)]",
                showSignIn
                  ? "opacity-100 blur-none"
                  : "pointer-events-none opacity-0 blur-xs",
              )}
            >
              <SignInButton
                variant="ghost"
                callbackUrl="/sessions"
                className={brandButton({ tone: "accent", scale: "sm" })}
              />
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
