"use client";

import { useCallback, useState } from "react";
import { AppMockup } from "@/components/landing/app-mockup";
import { LandingBento } from "@/components/landing/bento";
import { LandingFeatures } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { LandingFooter } from "@/components/landing/footer";
import { LandingHero } from "@/components/landing/hero";
import { LandingNav } from "@/components/landing/nav";
import { ProductIntro } from "@/components/landing/product-intro";
import { RunLifecycle } from "@/components/landing/run-lifecycle";
import { ScrollManifesto } from "@/components/landing/scroll-manifesto";
import { Stage } from "@/components/landing/stage";

export function SignedOutHero() {
  const [heroCtaVisible, setHeroCtaVisible] = useState(true);
  const handleCtaVisibilityChange = useCallback(
    (visible: boolean) => setHeroCtaVisible(visible),
    [],
  );

  return (
    <div
      id="top"
      className="landing relative isolate min-h-screen bg-(--l-bg) text-(--l-fg) selection:bg-(--pk-accent)/40"
    >
      <LandingNav showSignIn={!heroCtaVisible} />

      <main>
        <LandingHero onCtaVisibilityChange={handleCtaVisibilityChange} />
        <ScrollManifesto />
        <ProductIntro />
        <RunLifecycle />

        <section className="relative z-10 bg-(--l-bg) px-4 py-20 sm:px-6 md:py-28">
          <div className="mx-auto max-w-[1320px] overflow-hidden">
            <Stage tone="slate">
              <div className="mx-auto w-full max-w-[1160px]">
                <AppMockup />
              </div>
            </Stage>
          </div>
        </section>

        <LandingFeatures />
        <LandingBento />
        <FinalCta />
      </main>

      <LandingFooter />
    </div>
  );
}
