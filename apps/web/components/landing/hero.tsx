"use client";

import { useEffect, useRef } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { cn } from "@/lib/utils";
import { brandButton } from "./brand-button";
import { Eyebrow } from "./eyebrow";
import { GitHubLink } from "./github-link";
import { InternalAccessNote } from "./internal-access-note";
import { RotatingCube } from "./rotating-cube";

export function LandingHero({
  onCtaVisibilityChange,
}: {
  readonly onCtaVisibilityChange?: (visible: boolean) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const isVisible = useIntersectionObserver(sectionRef, { threshold: 0 });

  useEffect(() => {
    const element = ctaRef.current;
    if (!element || !onCtaVisibilityChange) return;

    const observer = new IntersectionObserver(
      ([entry]) => onCtaVisibilityChange(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onCtaVisibilityChange]);

  const reveal = isVisible ? "pk-fade-in" : "opacity-0";

  return (
    <section
      ref={sectionRef}
      className="relative bg-(--pk-dark-teal) px-4 py-24 md:px-12 lg:min-h-screen lg:pt-[132px] lg:pb-0"
    >
      <div className="mx-auto h-full max-w-[1200px] lg:flex">
        <div className="flex h-full w-full flex-col gap-8 lg:flex-row lg:gap-12">
          <div className="flex-1 text-left lg:self-center">
            <div
              className={cn("mb-5", reveal)}
              style={{ animationDelay: "0ms" }}
            >
              <Eyebrow tone="dark" pulse>
                Internal · Pickle Engineering
              </Eyebrow>
            </div>

            <h1
              className={cn(
                "mb-5 text-4xl font-semibold leading-[1.1] tracking-tight text-(--pk-accent) sm:text-5xl md:mb-6 md:text-6xl",
                reveal,
              )}
              style={{ animationDelay: "100ms" }}
            >
              Agentic engineering,
              <br />
              running on Pickle time.
            </h1>

            <p
              className={cn(
                "mb-6 max-w-[46ch] text-base leading-relaxed text-white/85 md:mb-8 md:text-xl",
                reveal,
              )}
              style={{ animationDelay: "200ms" }}
            >
              QuackOps spawns coding agents in cloud sandboxes. Hand one a repo
              and a task — it writes the code, runs the checks, pushes the
              branch, and opens the PR while you stay on the hard problems.
            </p>

            <div
              ref={ctaRef}
              className={cn(
                "mb-6 flex flex-wrap items-center gap-3 md:mb-8",
                reveal,
              )}
              style={{ animationDelay: "300ms" }}
            >
              <SignInButton
                variant="ghost"
                callbackUrl="/sessions"
                className={brandButton({ tone: "accent", scale: "lg" })}
              />
              <GitHubLink
                className={brandButton({ tone: "outlineDark", scale: "lg" })}
              >
                Browse the repo
              </GitHubLink>
            </div>

            <div
              className={cn("mb-10 md:mb-14", reveal)}
              style={{ animationDelay: "400ms" }}
            >
              <InternalAccessNote />
            </div>
          </div>

          <div className="order-first flex flex-1 items-center justify-center lg:order-last lg:self-center">
            <div
              className={cn(
                "aspect-square w-full max-w-md lg:max-w-2xl",
                reveal,
              )}
              style={{ animationDelay: "200ms" }}
            >
              <RotatingCube className="size-full" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
