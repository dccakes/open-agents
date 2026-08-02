"use client";

import { useEffect, useRef, useState } from "react";
import { GridBackdrop } from "./grid-backdrop";

/**
 * Scroll-lit manifesto: words warm from brand green to white as the section
 * scrolls past, one at a time. Ported from the withpickle.com about section.
 */

type ManifestoLine = {
  readonly id: string;
  readonly text: string;
  readonly kind: "headline" | "problem" | "solution" | "cta";
  readonly href?: string;
};

const LINES: readonly ManifestoLine[] = [
  {
    id: "headline",
    text: "Shipping software is bottlenecked by engineering hours.",
    kind: "headline",
  },
  {
    id: "problem-1",
    text: "Context scattered across five tools.",
    kind: "problem",
  },
  {
    id: "problem-2",
    text: "Boring work eating the whole afternoon.",
    kind: "problem",
  },
  {
    id: "problem-3",
    text: "Good ideas parked in the backlog.",
    kind: "problem",
  },
  {
    id: "solution",
    text: "So we gave every Pickle engineer a fleet.",
    kind: "solution",
  },
  { id: "cta", text: "See how it works.", kind: "cta", href: "#product" },
];

const MIN_UPDATE_INTERVAL_MS = 33; // ~30fps

// Unlit words sit at the brand's dark green and resolve to near-white.
const START_HSL = { h: 178, s: 79, l: 16 };
const END_HSL = { h: 0, s: 0, l: 100 };
const END_ALPHA = 0.9;

function wordColor(progress: number): string {
  const h = START_HSL.h + (END_HSL.h - START_HSL.h) * progress;
  const s = START_HSL.s + (END_HSL.s - START_HSL.s) * progress;
  const l = START_HSL.l + (END_HSL.l - START_HSL.l) * progress;

  if (progress > 0.8) {
    const alpha = 1 + (END_ALPHA - 1) * ((progress - 0.8) / 0.2);
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
  }

  return `hsl(${h}, ${s}%, ${l}%)`;
}

function useScrollProgress(ref: React.RefObject<HTMLElement | null>): number {
  const [progress, setProgress] = useState(0);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    let ticking = false;

    const measure = () => {
      const section = ref.current;
      if (!section) return;

      const now = performance.now();
      if (now - lastUpdateRef.current < MIN_UPDATE_INTERVAL_MS) return;
      lastUpdateRef.current = now;

      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) {
        setProgress(1);
        return;
      }

      setProgress(Math.max(0, Math.min(1, -rect.top / scrollable)));
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        measure();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => window.removeEventListener("scroll", onScroll);
  }, [ref]);

  return progress;
}

export function ScrollManifesto() {
  const sectionRef = useRef<HTMLElement>(null);
  const progress = useScrollProgress(sectionRef);

  // Flatten to a single word stream so each word lights in reading order.
  const wordStream = LINES.map((line) => ({
    ...line,
    words: line.text.split(" "),
  }));
  const totalWords = wordStream.reduce(
    (count, line) => count + line.words.length,
    0,
  );

  let cursor = 0;
  const litColor = (index: number) =>
    wordColor(Math.max(0, Math.min(1, progress * totalWords - index)));

  const rendered = wordStream.map((line) => {
    const offset = cursor;
    cursor += line.words.length;
    return { ...line, offset };
  });

  const headline = rendered.find((line) => line.kind === "headline");
  const body = rendered.filter((line) => line.kind !== "headline");

  return (
    <section
      ref={sectionRef}
      id="about"
      className="relative h-[200vh] scroll-mt-24 border-b border-(--pk-accent)"
    >
      <GridBackdrop />

      <div className="sticky top-0 flex h-screen items-center justify-center">
        <div className="max-w-[1000px] px-8 text-center md:px-12">
          {headline ? (
            <h2 className="mb-6 text-3xl font-semibold leading-[1.15] tracking-tight md:text-5xl">
              {headline.words.map((word, index) => (
                <span
                  key={`${headline.id}-${index}-${word}`}
                  className="mr-[0.3em] inline-block"
                  style={{ color: litColor(headline.offset + index) }}
                >
                  {word}
                </span>
              ))}
            </h2>
          ) : null}

          <div className="mx-auto max-w-[900px] space-y-3 text-base font-light md:text-xl">
            {body.map((line) => {
              const words = line.words.map((word, index) => (
                <span
                  key={`${line.id}-${index}-${word}`}
                  className="mr-[0.3em] inline-block"
                  style={{ color: litColor(line.offset + index) }}
                >
                  {word}
                </span>
              ));

              return (
                <p
                  key={line.id}
                  className={
                    line.kind === "problem" ? undefined : "pt-3 md:pt-4"
                  }
                >
                  {line.href ? (
                    <a
                      href={line.href}
                      className="underline decoration-1 underline-offset-4 transition-all duration-200 hover:decoration-2"
                    >
                      {words}
                    </a>
                  ) : (
                    words
                  )}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
