import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { SignInPanel } from "@/components/landing/sign-in-panel";

export function SignedOutHero() {
  return (
    <div className="landing flex min-h-screen flex-col bg-(--pk-dark-teal) text-white selection:bg-(--pk-accent)/40">
      <LandingNav />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <SignInPanel />
      </main>
      <LandingFooter />
    </div>
  );
}
