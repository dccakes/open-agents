"use client";

import { useEffect, useRef, useState } from "react";
import { SignInButton } from "@/components/auth/sign-in-button";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";
import { brandButton } from "./brand-button";
import { InternalAccessNote } from "./internal-access-note";

/**
 * Closing call to action over the branded isometric-blocks field, drifting on
 * scroll — the parallax treatment from withpickle.com's final section.
 */
export function FinalCta() {
  const sectionRef = useRef<HTMLElement>(null);
  const isVisible = useIntersectionObserver(sectionRef, { threshold: 0 });
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    if (!isVisible) return;

    const handleScroll = () => {
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const progress = -rect.top / (rect.height + window.innerHeight);
      setOffsetY(progress * 200);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isVisible]);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-4 py-24 text-center md:px-12 md:py-[100px]"
      style={{
        boxShadow:
          "inset 0 8px 16px rgba(0, 0, 0, 0.1), inset 0 -8px 16px rgba(0, 0, 0, 0.1)",
      }}
    >
      <div
        className="absolute inset-x-0 bg-center bg-no-repeat"
        style={{
          backgroundImage: "url(/brand/isometric-blocks-branded.svg)",
          backgroundSize: "cover",
          transform: `translateY(${offsetY}px) scale(${1 + Math.abs(offsetY) * 0.0005})`,
          transition: "transform 0.05s ease-out",
          top: "-200px",
          height: "calc(100% + 400px)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "hsla(178, 79%, 10%, 0.72)" }}
      />

      <div className="relative z-10 mx-auto max-w-[1200px] md:p-8">
        <h2 className="mb-10 text-3xl font-semibold leading-tight tracking-tight text-white md:text-4xl">
          Give your next ticket to an agent.
        </h2>

        <div className="flex flex-col items-center gap-6">
          <SignInButton
            variant="ghost"
            callbackUrl="/sessions"
            className={brandButton({ tone: "accent", scale: "lg" })}
          />
          <InternalAccessNote className="max-w-md justify-center text-center" />
        </div>
      </div>
    </section>
  );
}
