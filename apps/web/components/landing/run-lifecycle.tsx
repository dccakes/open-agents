"use client";

import { useRef } from "react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { cn } from "@/lib/utils";
import { RUN_LIFECYCLE } from "./run-lifecycle-data";

export function RunLifecycle() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const isVisible = useIntersectionObserver(sectionRef, { threshold: 0.3 });

  return (
    <section
      ref={sectionRef}
      className="relative z-10 border-y border-(--l-border-subtle) bg-(--pk-cloud) px-4 py-24 lg:px-12 lg:py-32"
    >
      <div className="mx-auto max-w-[1200px] text-center">
        <h2 className="mb-10 text-2xl font-normal text-(--l-fg-2) lg:mb-16 lg:text-3xl">
          One run, start to finish
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {RUN_LIFECYCLE.map((item, index) => (
            <article
              key={item.step}
              className={cn(
                "flex flex-col overflow-hidden rounded-3xl border border-(--l-border) bg-(--l-surface) text-left shadow-[0_4px_20px_rgb(0,0,0,0.02)] transition-shadow duration-300 hover:shadow-[0_6px_25px_rgb(0,0,0,0.05)]",
                isVisible ? "pk-fade-in" : "opacity-0",
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div
                className="flex items-center justify-between px-6 py-6 lg:px-8 lg:py-8"
                style={{
                  background: `linear-gradient(135deg, ${item.tint} 0%, transparent 140%)`,
                }}
              >
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-(--pk-dark-teal)/70">
                  {item.step}
                </span>
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: "hsl(178 79% 8% / 0.35)" }}
                />
              </div>

              <div className="flex flex-1 flex-col gap-1 px-6 py-6 lg:px-8">
                <h3 className="text-lg font-semibold text-(--l-fg)">
                  {item.title}
                </h3>
                <p className="text-sm leading-relaxed text-(--l-fg-3)">
                  {item.detail}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
