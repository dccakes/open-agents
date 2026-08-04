/**
 * What to tell someone in Linear when their delegation was refused.
 *
 * Colocated with the resolution rules it switches on, so a new refusal reason
 * cannot be added without the compiler pointing here.
 *
 * Each message names the actual obstacle. Before actor mappings existed there
 * was one "you aren't connected" message covering every failure, which is
 * actively misleading for the two cases this change makes ordinary: a member
 * whose Linear address differs from their sign-in address, and one whose
 * address is real but unverified. Both of those people *are* connected, and
 * telling them to sign up gives them nothing to act on.
 */

export type LinearActorRefusalReason =
  | "not-connected"
  | "unverified-email"
  | "pending";

export interface RefusalMessageInput {
  reason: LinearActorRefusalReason;
  /** `@name` where the payload carried one, else the address. */
  handle: string | undefined;
  actorEmail: string | undefined;
  appUrl: string;
}

export function refusalMessage(input: RefusalMessageInput): string {
  const who = input.handle ?? "there";
  const address = input.actorEmail ?? "that address";

  switch (input.reason) {
    case "pending":
      return `Hey ${who}, ${address} is signed in but still waiting on an administrator to approve access. Once approved you can run sessions from Linear.`;
    case "unverified-email":
      return `Hey ${who}, ${address} matches an account whose email address has not been verified, so I can't act on it. Verify the address, or ask an administrator to link your Linear account directly.`;
    case "not-connected":
      return `Hey ${who}, ${address} isn't connected to QuackOps yet. Sign in at ${appUrlOrFallback(input.appUrl)} — or, if you're already a member under a different address, ask an administrator to link your Linear account.`;
  }
}

function appUrlOrFallback(appUrl: string): string {
  return appUrl.trim() === "" ? "the QuackOps app" : appUrl;
}
