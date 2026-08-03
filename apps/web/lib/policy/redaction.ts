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
 * This is pattern-based and therefore incomplete by construction; it is a
 * reduction in exposure, not a guarantee. Anything not matched is still bounded
 * in length so a summary cannot become an unbounded copy of the input.
 */

/** What a redacted value is replaced with. */
export const REDACTED = "[redacted]";

/** Longest string kept verbatim in a summary. */
export const MAX_SUMMARY_STRING_LENGTH = 2000;

/** Deepest nesting walked before the rest is collapsed. */
const MAX_DEPTH = 6;

/** Object keys whose value is a credential regardless of its shape. */
const SECRET_KEY_PATTERN =
  /(?:secret|token|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|authorization|auth[-_]?header|session[-_]?id|cookie)/i;

/**
 * Values that are credential-shaped wherever they appear.
 *
 * Ordered longest-prefix first so a more specific vendor pattern wins over the
 * generic one it is a substring of.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  // PEM private key blocks, header through footer.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub fine-grained PATs and classic tokens.
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  // OpenAI / Anthropic style prefixed keys.
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,
  // Slack bot / user / app tokens.
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  // AWS access key ids.
  /\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{12,}/g,
  // JSON Web Tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Vercel, Neon, and similar prefixed keys.
  /\b(?:vercel|neon|dtn)_[A-Za-z0-9_]{16,}/gi,
];

/**
 * `NAME=value` where the name is credential-shaped. The name is kept so the
 * summary still says *what* was set; only the value is dropped.
 */
const SECRET_ASSIGNMENT_PATTERN =
  /\b([A-Za-z_][\w-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[-_]?KEY|ACCESS[-_]?KEY|PRIVATE[-_]?KEY)[\w-]*)\s*=\s*("[^"]*"|'[^']*'|\S+)/gi;

/** `Authorization: Bearer <value>` and friends, in a header or a flag. */
const BEARER_PATTERN = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** A credential embedded in a URL's userinfo. */
const URL_USERINFO_PATTERN = /\/\/[^/\s:@]+:[^/\s@]+@/g;

function truncate(value: string): string {
  if (value.length <= MAX_SUMMARY_STRING_LENGTH) {
    return value;
  }

  const dropped = value.length - MAX_SUMMARY_STRING_LENGTH;
  return `${value.slice(0, MAX_SUMMARY_STRING_LENGTH)}… (${dropped} chars truncated)`;
}

/** Redact credential-shaped substrings, then bound the length. */
export function redactText(value: string): string {
  let result = value;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }

  result = result.replace(
    SECRET_ASSIGNMENT_PATTERN,
    (_match, name: string) => `${name}=${REDACTED}`,
  );
  result = result.replace(
    BEARER_PATTERN,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  );
  result = result.replace(URL_USERINFO_PATTERN, `//${REDACTED}@`);

  return truncate(result);
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
): unknown {
  if (typeof value === "string") {
    return redactText(value);
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
      return value.map((entry) => redactValue(entry, depth + 1, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(entry, depth + 1, seen);
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
export function redactInputSummary(input: unknown): Record<string, unknown> {
  const seen = new WeakSet<object>();

  if (isPlainRecord(input)) {
    const result = redactValue(input, 0, seen);
    return isPlainRecord(result) ? result : { value: result };
  }

  return { value: redactValue(input, 1, seen) };
}
