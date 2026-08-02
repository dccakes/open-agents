"use client";

import { useRef } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { cn } from "@/lib/utils";

export function ProductIntro() {
  const sectionRef = useRef<HTMLElement>(null);
  const isVisible = useIntersectionObserver(sectionRef, { threshold: 0.2 });
  const reveal = isVisible ? "pk-fade-in" : "opacity-0";

  return (
    <section
      ref={sectionRef}
      id="product"
      className="relative z-10 scroll-mt-24 border-t border-(--l-border) bg-(--l-surface) px-8 pb-16 pt-24 md:px-12 md:pb-24 md:pt-32"
      style={{ boxShadow: "0 -1px 4px rgba(0, 0, 0, 0.05)" }}
    >
      <div className="mx-auto max-w-[1200px] text-center">
        <div
          className={cn(
            "text-3xl leading-tight tracking-tight md:text-5xl",
            reveal,
          )}
          style={{ animationDelay: "0ms" }}
        >
          <span className="font-bold text-(--pk-primary)">Meet QuackOps.</span>{" "}
          <span className="font-normal text-(--l-fg-2)">
            The engineering team&apos;s agent runtime.
          </span>
        </div>

        <p
          className={cn(
            "mx-auto mt-6 max-w-[800px] text-base leading-relaxed text-(--l-fg-2) md:text-xl",
            reveal,
          )}
          style={{ animationDelay: "100ms" }}
        >
          Point an agent at any Pickle repo. It clones into an isolated cloud
          sandbox, works the task end to end, and comes back with a branch, a
          diff, and a pull request you can review like any other.
        </p>
      </div>
    </section>
  );
}
