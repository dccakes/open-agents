/**
 * The posture vocabulary, as the web app sees it.
 *
 * The same three values are declared in `packages/agent/policy/types.ts` (where
 * the agent evaluates them) and on the `sessions.posture` column (where they are
 * stored). This module is the web app's copy, and `posture.test.ts` pins it
 * against the column so the two cannot drift apart silently. Once the agent
 * package re-exports its policy module from its package root, this should
 * re-export `postureSchema` from there instead of redeclaring it.
 */

import { z } from "zod";

/** Declaration order is least to most permissive. */
export const POSTURES = ["strict", "auto", "dangerous"] as const;

export const postureSchema = z.enum(POSTURES);
export type Posture = z.infer<typeof postureSchema>;

/**
 * The posture a session has unless someone chooses otherwise.
 *
 * `auto` and not `strict`: it is exactly what every session did before the
 * column existed, so adding the column changed no behaviour. A default of
 * `strict` would have paused every existing session on its next push.
 */
export const DEFAULT_POSTURE: Posture = "auto";

export function isPosture(value: unknown): value is Posture {
  return postureSchema.safeParse(value).success;
}
