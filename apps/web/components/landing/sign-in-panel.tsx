import { SignInButton } from "@/components/auth/sign-in-button";
import { brandButton } from "./brand-button";
import { Eyebrow } from "./eyebrow";
import { GitHubLink } from "./github-link";
import { InternalAccessNote } from "./internal-access-note";
import { RotatingCube } from "./rotating-cube";
import { RunSteps } from "./run-steps";

/**
 * The whole signed-out surface: say what QuackOps is, who it's for, and let
 * people in. QuackOps is an internal tool, so there is nothing to sell here.
 */
export function SignInPanel() {
  return (
    <div className="flex w-full max-w-xl flex-col items-center text-center">
      <RotatingCube className="mb-8 size-40" size="7rem" />

      <Eyebrow pulse>Internal · Pickle Engineering</Eyebrow>

      <h1 className="mt-6 text-4xl font-semibold tracking-tight text-(--pk-accent) sm:text-5xl">
        QuackOps
      </h1>

      <p className="mt-4 text-balance text-lg leading-relaxed text-white/80">
        Coding agents that run in cloud sandboxes — hand one a repo and a task,
        get back a branch and a pull request.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <SignInButton
          callbackUrl="/sessions"
          className={brandButton({ tone: "accent", scale: "lg" })}
          variant="ghost"
        />
        <GitHubLink
          className={brandButton({ tone: "outlineDark", scale: "lg" })}
        >
          Repo
        </GitHubLink>
      </div>

      <InternalAccessNote className="mt-6 max-w-md justify-center text-center" />

      <div className="mt-12 w-full border-t border-white/10 pt-6">
        <RunSteps />
      </div>
    </div>
  );
}
