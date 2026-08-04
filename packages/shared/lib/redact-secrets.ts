/**
 * The one string-level credential scrubber.
 *
 * Two of these used to exist — one in `packages/agent/policy/redact.ts` for the
 * summaries the agent puts on a `PolicyEvent`, one in
 * `apps/web/lib/policy/redaction.ts` for the `jsonb` columns behind
 * `approval.input_summary` and `policy_event.input_summary` — and they ran in
 * series on the same string. Neither pattern set was a superset of the other, so
 * a credential class covered on one side leaked through the other path while
 * each file looked complete on its own. This module is their union; both sides
 * now import it and nothing else scrubs strings.
 *
 * It lives in `packages/shared` because it is the only place both the agent
 * package and the web app can reach without a cycle: `@open-agents/shared`
 * depends on nothing but React, and this file imports nothing at all. Import it
 * by subpath (`@open-agents/shared/lib/redact-secrets`) rather than from the
 * package root — the root barrel re-exports React hooks, which the agent package
 * must not pull in.
 *
 * This is pattern-based and therefore incomplete by construction; it is a
 * reduction in exposure, not a guarantee. It is deliberately eager: it prefers
 * redacting something harmless over leaking something that is not. Anything not
 * matched is still bounded in length, so a summary cannot become an unbounded
 * copy of the input.
 *
 * `redactSecrets` is idempotent — `f(f(x)) === f(x)` — which is what makes it
 * safe for a value to cross a boundary that redacts and then be handed to
 * another one. Every rule below is written so that its own output no longer
 * matches it, and `redact-secrets.test.ts` pins that.
 */

/** What a redacted value is replaced with. */
export const REDACTED = "[redacted]";

/**
 * Longest string kept verbatim.
 *
 * The two former implementations bounded at 500 and 2000, applied in that
 * order, so the 500 always won and the 2000 was dead. 2000 is the survivor: 500
 * cut a compound `bash -c '…'` off partway through, which loses exactly the
 * segment an auditor is reading the row to find, and both destinations are
 * `jsonb` columns where 2000 characters is still nowhere near a payload.
 */
export const MAX_REDACTED_TEXT_LENGTH = 2000;

/** Appended in place of the tail. Fixed-width so truncation has a fixed point. */
const TRUNCATION_MARKER = "… [truncated]";

/** Key names whose value is assumed to be a secret, in a flag or an assignment. */
const SECRET_KEY_NAME = String.raw`[A-Za-z0-9_.-]*(?:token|secret|key|password|passwd|pwd|credential|auth)[A-Za-z0-9_.-]*`;

/** Guards a rule against re-matching a placeholder it already wrote. */
const NOT_REDACTED = String.raw`(?!\[redacted\])`;

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

/**
 * Order matters.
 *
 * PEM blocks go first because their body would otherwise be eaten piecemeal by
 * the opaque-run rule; the opaque-run rule goes last because it is the catch-all
 * and would otherwise swallow the structure the named rules rely on.
 */
const REDACTION_RULES: RedactionRule[] = [
  {
    // A private key block, header through footer.
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: REDACTED,
  },
  {
    // A credential in a URL's userinfo: `https://user:pass@host`.
    pattern: /\/\/[^/\s:@]+:[^/\s@]+@/g,
    replacement: `//${REDACTED}@`,
  },
  {
    // Well-known issued-token shapes, longest prefix first so a specific vendor
    // pattern wins over the generic one it is a substring of.
    pattern: new RegExp(
      [
        String.raw`\bgithub_pat_[A-Za-z0-9_]{16,}`,
        String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}`,
        String.raw`\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}`,
        String.raw`\bxox[aboprs]-[A-Za-z0-9-]{10,}`,
        String.raw`\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{12,}`,
        String.raw`\bAIza[0-9A-Za-z_-]{20,}`,
        String.raw`\b(?:vercel|neon|dtn)_[A-Za-z0-9_]{16,}`,
        String.raw`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`,
      ].join("|"),
      "gi",
    ),
    replacement: REDACTED,
  },
  {
    // `SECRET=value`, `--token=value`, `SECRET="value"` — the name is kept so
    // the summary still says *what* was set.
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
    // `Authorization: <scheme> <value>`. The lookahead stops a second pass from
    // consuming whatever follows an already-redacted header.
    pattern: new RegExp(
      String.raw`((?:proxy-)?authorization:\s*)${NOT_REDACTED}\S+(?:\s+\S+)?`,
      "gi",
    ),
    replacement: `$1${REDACTED}`,
  },
  {
    // A bare scheme-prefixed credential outside a header.
    pattern: /\b(bearer|basic)\s+\S+/gi,
    replacement: `$1 ${REDACTED}`,
  },
  {
    // `Token <value>` needs a length and charset floor: unlike `Bearer`, the
    // word appears in ordinary prose.
    pattern: /\b(token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1 ${REDACTED}`,
  },
  {
    // Long opaque runs with no separator: an ordinary path or identifier is
    // broken up by `/`, `.`, or spaces well before this length.
    pattern: /\b[A-Za-z0-9_-]{40,}\b/g,
    replacement: REDACTED,
  },
];

/**
 * Bound the length, cutting on a whitespace boundary where there is one.
 *
 * Cutting mid-token would let a half-written `[redacted]` — or a bare `Bearer`
 * left dangling by the cut — match again on a later pass, which would make the
 * function non-idempotent. The result is always at most the bound, so a second
 * call returns it unchanged.
 */
function truncate(value: string): string {
  if (value.length <= MAX_REDACTED_TEXT_LENGTH) {
    return value;
  }

  const budget = MAX_REDACTED_TEXT_LENGTH - TRUNCATION_MARKER.length;
  const slice = value.slice(0, budget);
  const lastBoundary = slice.search(/\s\S*$/);
  const kept = lastBoundary > budget / 2 ? slice.slice(0, lastBoundary) : slice;

  return `${kept}${TRUNCATION_MARKER}`;
}

/**
 * Redact credential-shaped substrings, then bound the length.
 *
 * Redaction runs before truncation so a credential can never be split into a
 * surviving fragment.
 */
export function redactSecrets(value: string): string {
  let result = value;

  for (const rule of REDACTION_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }

  return truncate(result);
}
