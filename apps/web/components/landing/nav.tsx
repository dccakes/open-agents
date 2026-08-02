import { GitHubLink } from "./github-link";
import { Logo } from "./logo";

/** Top bar for the signed-out page: identity on the left, the repo on the right. */
export function LandingNav() {
  return (
    <header className="flex items-center justify-between px-6 py-5 md:px-10">
      <Logo tone="dark" />
      <GitHubLink
        className="rounded-full text-white/60 hover:bg-white/10 hover:text-(--pk-accent)"
        size="icon"
        variant="ghost"
      />
    </header>
  );
}
