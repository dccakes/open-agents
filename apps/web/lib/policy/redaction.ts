/**
 * Redaction for everything the policy layer persists.
 *
 * Both `approval.input_summary` and `policy_event.input_summary` hold a
 * *summary* of what the agent asked to do, and the agent's inputs routinely
 * contain credentials — a `git push` URL with an embedded token, a `curl` with
 * an `Authorization` header, an environment assignment. Those rows outlive the
 * run and are read by humans, so the credential must not reach the column in
 * the first place.
 *
 * Two concerns live here, and only one of them is local:
 *
 * - **String scrubbing** is *not* local. It is
 *   `@open-agents/shared/lib/redact-secrets`, shared with the agent package's
 *   `policy/redact.ts`. There used to be a second, independent pattern set in
 *   this file, and because neither set was a superset of the other, each path
 *   leaked the credential classes the other caught. Add a pattern there.
 * - **The structural walk** below is local: turning an arbitrary `unknown` into
 *   a bounded, cycle-free, JSON-serializable record for a `jsonb` column, with
 *   secret-*named* keys dropped whatever their value looks like. Nothing in the
 *   agent package needs that.
 *
 * **Where the guarantee lives.** For values the agent produced, the scrub
 * already happened at the agent package's boundary (`policy/redact.ts`) — that
 * boundary has to hold for any host, not just this one. Callers handing over
 * such a value pass `stringsAlreadyRedacted` so it is not scrubbed a second
 * time. For every other caller — anything assembling a summary out of raw
 * request data — the scrub happens *here*, on the way into the column, which is
 * the last point at which no caller can forget it. That is the default.
 */

import {
  MAX_REDACTED_TEXT_LENGTH,
  REDACTED as SHARED_REDACTED,
  redactSecrets,
} from "@open-agents/shared/lib/redact-secrets";

/** What a redacted value is replaced with. */
export const REDACTED = SHARED_REDACTED;

/** Longest string kept verbatim in a summary. */
export const MAX_SUMMARY_STRING_LENGTH = MAX_REDACTED_TEXT_LENGTH;

/** Redact credential-shaped substrings, then bound the length. */
export const redactText = redactSecrets;

/** Deepest nesting walked before the rest is collapsed. */
const MAX_DEPTH = 6;

/** Object keys whose value is a credential regardless of its shape. */
const SECRET_KEY_PATTERN =
  /(?:secret|token|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth[-_]?header|session[-_]?id|cookie)/i;

export interface RedactInputSummaryOptions {
  /**
   * The caller already ran `redactSecrets` over every string in this value, so
   * do not scrub them again — see the boundary note at the top of this file.
   *
   * Only the string scrub is skipped. Depth, cycle, non-JSON-value and
   * secret-named-key handling always run, because those are properties of the
   * column and not of the caller. A caller that sets this owns both the scrub
   * and the length bound for the strings it passes.
   *
   * Defaults to `false`: forgetting it costs a redundant (idempotent) pass,
   * whereas setting it wrongly would write a credential to the column.
   */
  stringsAlreadyRedacted?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  scrubStrings: boolean,
): unknown {
  if (typeof value === "string") {
    return scrubStrings ? redactSecrets(value) : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    if (depth >= MAX_DEPTH) {
      return "[truncated]";
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((entry) =>
        redactValue(entry, depth + 1, seen, scrubStrings),
      );
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, depth + 1, seen, scrubStrings);
    }
    return output;
  }

  return String(value);
}

/**
 * A redacted, JSON-serializable record suitable for a `jsonb` column.
 *
 * A non-object input is wrapped as `{ value }` rather than dropped, so a caller
 * that hands over a bare command string still gets a usable summary.
 */
export function redactInputSummary(
  input: unknown,
  options: RedactInputSummaryOptions = {},
): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const scrubStrings = options.stringsAlreadyRedacted !== true;

  if (isPlainRecord(input)) {
    const result = redactValue(input, 0, seen, scrubStrings);
    return isPlainRecord(result) ? result : { value: result };
  }

  return { value: redactValue(input, 1, seen, scrubStrings) };
}
