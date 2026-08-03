/**
 * Redaction for policy records.
 *
 * A denied command is written to an append-only audit log, and denied commands
 * are exactly the commands most likely to contain a credential. Everything that
 * leaves the agent for that log goes through here first.
 *
 * This is deliberately eager: it prefers redacting something harmless over
 * leaking something that is not. The summary exists to identify what was
 * refused, not to reproduce it.
 */

const REDACTED = "[redacted]";

/** Long enough to identify the command, short enough not to store a payload. */
export const MAX_POLICY_INPUT_LENGTH = 500;

/** Key names whose value is assumed to be a secret. */
const SECRET_KEY_NAME = String.raw`[A-Za-z0-9_.-]*(?:token|secret|key|password|passwd|pwd|credential|auth)[A-Za-z0-9_.-]*`;

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    // PEM blocks first: their body would otherwise be caught piecemeal.
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  {
    // `SECRET=value`, `--token=value`, `SECRET="value"` — keep the name.
    pattern: new RegExp(
      String.raw`(${SECRET_KEY_NAME})(\s*=\s*)(?:"[^"]*"|'[^']*'|\S+)`,
      "gi",
    ),
    replacement: `$1$2${REDACTED}`,
  },
  {
    // `--token value`, `-p value`.
    pattern: new RegExp(
      String.raw`(--?${SECRET_KEY_NAME}\s+)(?:"[^"]*"|'[^']*'|\S+)`,
      "gi",
    ),
    replacement: `$1${REDACTED}`,
  },
  {
    pattern: /((?:authorization|proxy-authorization):\s*)\S+(?:\s+\S+)?/gi,
    replacement: `$1${REDACTED}`,
  },
  {
    pattern: /\b(bearer|basic)\s+\S+/gi,
    replacement: `$1 ${REDACTED}`,
  },
  {
    // Well-known issued-token shapes.
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    replacement: REDACTED,
  },
  {
    // Long opaque runs with no separator: an ordinary path or identifier is
    // broken up by `/`, `.`, or spaces well before this length.
    pattern: /\b[A-Za-z0-9_-]{40,}\b/g,
    replacement: REDACTED,
  },
];

function truncate(value: string): string {
  if (value.length <= MAX_POLICY_INPUT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_POLICY_INPUT_LENGTH)}...`;
}

/**
 * Produce a redacted, length-bounded summary of a tool input for the policy
 * event log. Redaction runs before truncation so a credential can never be
 * split into a surviving fragment.
 */
export function redactPolicyInput(input: string | undefined): string {
  if (!input) {
    return "";
  }

  let summary = input;
  for (const rule of REDACTION_RULES) {
    summary = summary.replace(rule.pattern, rule.replacement);
  }

  return truncate(summary);
}
