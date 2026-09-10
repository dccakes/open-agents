/**
 * Redaction for policy records — the agent package's outbound boundary.
 *
 * A denied command is written to an append-only audit log, and denied commands
 * are exactly the commands most likely to contain a credential. Everything that
 * leaves the agent package for that log goes through here first: the summaries
 * on a `PolicyEvent` (see `execution-context.ts`) and the summary on an
 * `ApprovalGateRequest` (see `tools/policy-enforcement.ts`).
 *
 * **This is where the guarantee lives for anything the agent emits.** The
 * package ships a no-op recorder and an optional gate, so the host on the other
 * side is not necessarily this repo's web app; a `PolicyEvent` must already be
 * redacted when it crosses the boundary, whoever catches it. A host that
 * redacts again is welcome to — `redactSecrets` is idempotent — but it is not
 * required to, and `apps/web` no longer does for values that came from here.
 *
 * The patterns themselves live in `@open-agents/shared/lib/redact-secrets`,
 * shared with `apps/web/lib/policy/redaction.ts`. They used to be a second,
 * separate set here, which meant each side missed credential classes the other
 * caught. Add a pattern there, not here.
 */

import {
  MAX_REDACTED_TEXT_LENGTH,
  redactSecrets,
} from "@open-agents/shared/lib/redact-secrets";

/** Long enough to identify the command, short enough not to store a payload. */
export const MAX_POLICY_INPUT_LENGTH = MAX_REDACTED_TEXT_LENGTH;

/**
 * Produce a redacted, length-bounded summary of a tool input for the policy
 * event log. Redaction runs before truncation so a credential can never be
 * split into a surviving fragment.
 */
export function redactPolicyInput(input: string | undefined): string {
  if (!input) {
    return "";
  }

  return redactSecrets(input);
}
