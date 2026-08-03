import type { CommandPolicy, PolicyRule } from "./types";

/**
 * The shipped policy baseline.
 *
 * Rules are **code-defined this phase**: there is no database table and no
 * runtime editing surface for them. That is deliberate — it is what makes the
 * golden corpus (`golden-corpus.ts`) a meaningful regression test. Per-
 * organization rule editing is explicitly deferred to a later phase.
 *
 * Precedence is deny → ask → allow, first match within a class, so an allow
 * rule can never be written that accidentally overrides a hard denial.
 *
 * Honest limit: this is pattern matching over a static parse. `eval`,
 * base64 pipelines, and any embedded interpreter defeat it by construction.
 * Those families are gated (`ask`) rather than pretended away.
 */

// --------------------------------------------------------------- fragments --

const NETWORK_SINK = String.raw`(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|telnet|xh|httpie)`;
const SHELL_INTERPRETER = String.raw`(?:sh|bash|zsh|dash|ksh|ash)`;
const DEFAULT_BRANCH = String.raw`(?:main|master)`;

/** Places a credential or the whole environment can be read from. */
const CREDENTIAL_SOURCE = String.raw`(?:(?:^|[\s;&|(])(?:env|printenv)(?=\s|$)|\.env\b|\bid_rsa\b|\bid_ed25519\b|\.ssh\/|\.aws\/credentials|\.npmrc\b|\.netrc\b|proc\/self\/environ)`;

/** Targets whose recursive-force deletion is unrecoverable. */
const ROOT_TARGET = String.raw`(?:\/(?:usr|etc|var|bin|sbin|lib|lib64|boot|home|root|opt|dev|sys|proc)\/?\*?|\/\*|\/|~\/?\*?|\$\{?HOME\}?\/?\*?|\*)`;

const RM_ROOT_PATTERN = new RegExp(
  String.raw`(?:^|[\s;&|(])rm\s+(?=(?:-\S+\s+)*-\S*[rR])(?=(?:-\S+\s+)*-\S*f)(?:-\S+\s+)+${ROOT_TARGET}(?=\s|$)`,
);

const EXFILTRATION_PATTERN = new RegExp(
  String.raw`${CREDENTIAL_SOURCE}[^|]*\|[^|]*\b${NETWORK_SINK}\b`,
  "i",
);

const FORCE_PUSH_DEFAULT_BRANCH_PATTERN = new RegExp(
  String.raw`^(?=[^|;&\n]*\bgit\b)(?=[^|;&\n]*\bpush\b)(?=[^|;&\n]*(?:(?:^|\s)(?:-f|--force(?:-with-lease)?(?:=\S+)?)(?=\s|$)|\s\+${DEFAULT_BRANCH}(?=$|\s)))(?=[^|;&\n]*(?:^|[\s:/+])${DEFAULT_BRANCH}(?=$|\s))`,
);

const DOWNLOAD_INTO_SHELL_PATTERN = new RegExp(
  String.raw`\b(?:curl|wget|fetch)\b[^|]*\|[^|]*\b(?:sudo\s+)?(?:\S*\/)?(?:${SHELL_INTERPRETER}|python3?|node|perl|ruby)\b`,
);

const PIPE_INTO_SHELL_PATTERN = new RegExp(
  String.raw`\|\s*(?:sudo\s+)?(?:\S*\/)?${SHELL_INTERPRETER}(?=\s|$)`,
);

const READ_ONLY_COMMAND = String.raw`(?:ls|pwd|cat|head|tail|wc|file|stat|du|df|tree|which|type|whoami|id|uname|hostname|date|echo|printf|basename|dirname|realpath|readlink|sort|uniq|cut|nl|diff|comm|grep|rg|ag|ack|fd|find|jq|yq|column|hexdump|xxd|strings|true|false)`;

// ------------------------------------------------------------------- deny --

const DENY_RULES: PolicyRule[] = [
  {
    id: "bash.deny.filesystem-destruction",
    action: "deny",
    tool: "bash",
    pattern: RM_ROOT_PATTERN,
    capability: "destructive",
    reason:
      "Recursive, forced deletion of a root, system, or home directory destroys the workspace and is never recoverable.",
  },
  {
    id: "bash.deny.credential-exfiltration",
    action: "deny",
    tool: "bash",
    pattern: EXFILTRATION_PATTERN,
    scope: "command",
    capability: "credential",
    reason:
      "This pipes an environment dump or a credential file into a network command, which exfiltrates secrets.",
  },
  {
    id: "bash.deny.force-push-default-branch",
    action: "deny",
    tool: "bash",
    pattern: FORCE_PUSH_DEFAULT_BRANCH_PATTERN,
    capability: "network",
    reason:
      "Force-pushing to a default branch (main or master) discards other people's commits irreversibly.",
  },
];

// -------------------------------------------------------------------- ask --

/**
 * The patterns `commandNeedsApproval()` enforced before this change
 * (`packages/agent/tools/bash.ts:32-47`), absorbed verbatim so that no command
 * that required approval before requires less approval now.
 *
 * Kept as their own exported list because `commandNeedsApproval` is still
 * exported for compatibility and must reproduce exactly this behaviour — no
 * more, no less.
 */
export const LEGACY_APPROVAL_RULES: PolicyRule[] = [
  {
    id: "bash.ask.legacy.curl",
    action: "ask",
    tool: "bash",
    pattern: /\bcurl\b/,
    capability: "network",
    reason: "curl reaches the network from inside the workspace.",
  },
  {
    id: "bash.ask.legacy.recursive-force-delete",
    action: "ask",
    tool: "bash",
    pattern:
      /\brm\s+(?:[^\n;&|]*\s)?(?:-[A-Za-z]*r[A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*r|-r\s+-f|-f\s+-r|-{1,2}recursive\b.*-{1,2}force\b|-{1,2}force\b.*-{1,2}recursive\b)/,
    capability: "destructive",
    reason: "Recursive, forced deletion cannot be undone.",
  },
  {
    id: "bash.ask.legacy.find-delete",
    action: "ask",
    tool: "bash",
    pattern: /\bfind\b[^\n;&|]*(?:-delete|-exec\s+rm\b)/,
    capability: "destructive",
    reason: "find with -delete or -exec rm removes files in bulk.",
  },
  {
    id: "bash.ask.legacy.disk-tools",
    action: "ask",
    tool: "bash",
    pattern: /\b(?:shred|mkfs|dd)\b/,
    capability: "destructive",
    reason: "shred, mkfs, and dd overwrite data at the block level.",
  },
  {
    id: "bash.ask.legacy.fork-bomb",
    action: "ask",
    tool: "bash",
    // Scoped to the whole command: the classic fork bomb is written across
    // several separators, so no single segment contains the pattern.
    pattern: /:\(\)\s*\{\s*:\|:/,
    scope: "command",
    capability: "destructive",
    reason: "This is a fork bomb and will exhaust the sandbox.",
  },
  {
    id: "bash.ask.legacy.dotenv",
    action: "ask",
    tool: "bash",
    pattern: /\.\s*env/i,
    capability: "credential",
    reason: "This references a dotenv file, which holds secrets.",
  },
  {
    id: "bash.ask.legacy.dotenv-obfuscated",
    action: "ask",
    tool: "bash",
    pattern: /\.e(?:['"]{2}|\\|\$\{[^}]*\}|\$\([^)]*\))?nv/i,
    capability: "credential",
    reason:
      "This references a dotenv file through quoting or expansion that hides the name.",
  },
  {
    id: "bash.ask.legacy.dotenv-substitution",
    action: "ask",
    tool: "bash",
    pattern: /\.e\$\([^)]*nv[^)]*\)/i,
    capability: "credential",
    reason:
      "This builds a dotenv filename from a command substitution, which hides the name.",
  },
  {
    id: "bash.ask.legacy.env-substitution",
    action: "ask",
    tool: "bash",
    pattern: /\$\([^)]*env[^)]*\)/i,
    capability: "credential",
    reason: "This substitutes the output of a command that reads environment.",
  },
  {
    id: "bash.ask.legacy.env-backticks",
    action: "ask",
    tool: "bash",
    pattern: /`[^`]*env[^`]*`/i,
    capability: "credential",
    reason:
      "This substitutes, via backticks, the output of a command that reads environment.",
  },
  {
    id: "bash.ask.legacy.credential-paths",
    action: "ask",
    tool: "bash",
    pattern:
      /\b(?:aws\/credentials|id_rsa|id_ed25519|\.ssh|proc\/self\/environ)\b/i,
    capability: "credential",
    reason:
      "This references SSH keys, cloud credentials, or the process environment.",
  },
];

const ASK_RULES: PolicyRule[] = [
  {
    id: "bash.ask.download-into-shell",
    action: "ask",
    tool: "bash",
    pattern: DOWNLOAD_INTO_SHELL_PATTERN,
    scope: "command",
    capability: "network",
    reason:
      "Piping a network download straight into an interpreter executes code nobody has read.",
  },
  {
    id: "bash.ask.pipe-into-shell",
    action: "ask",
    tool: "bash",
    pattern: PIPE_INTO_SHELL_PATTERN,
    scope: "command",
    capability: "other",
    reason:
      "Piping generated or decoded output into a shell executes code the policy cannot inspect.",
  },
  {
    id: "bash.ask.dynamic-evaluation",
    action: "ask",
    tool: "bash",
    pattern: /^eval\b/,
    capability: "other",
    reason:
      "eval builds its command at runtime, so static analysis cannot see what will run.",
  },
  {
    id: "bash.ask.base64-pipeline",
    action: "ask",
    tool: "bash",
    pattern: /\bbase64\b[^|]*(?:\s-d\b|\s--decode\b|\s-D\b)[^|]*\|/,
    scope: "command",
    capability: "other",
    reason:
      "Decoding base64 into another command hides the command from the policy.",
  },
  {
    id: "bash.ask.package-publish",
    action: "ask",
    tool: "bash",
    pattern:
      /^(?:npm|pnpm|yarn|bun|deno)\s+publish\b|^(?:cargo|poetry|gem|twine|mvn)\s+(?:publish|push|upload|deploy)\b/,
    capability: "network",
    reason: "Publishing a package is a public, irreversible release.",
  },
  {
    id: "bash.ask.package-install",
    action: "ask",
    tool: "bash",
    pattern:
      /^(?:npm|pnpm|yarn|bun)\s+(?:i|install|ci|add)\b|^(?:pip3?|pipx)\s+install\b|^(?:cargo\s+(?:install|add)|go\s+(?:get|install)|gem\s+install|brew\s+install|apk\s+add|apt(?:-get)?\s+install)\b/,
    capability: "network",
    reason:
      "Installing a package downloads and runs third-party lifecycle scripts.",
  },
  {
    id: "bash.ask.git-push",
    action: "ask",
    tool: "bash",
    pattern: /^git\b[^|;&\n]*\bpush\b/,
    capability: "network",
    reason: "Pushing publishes commits outside the sandbox.",
  },
  ...LEGACY_APPROVAL_RULES,
];

// ------------------------------------------------------------------ allow --

const ALLOW_RULES: PolicyRule[] = [
  {
    id: "bash.allow.read-only-inspection",
    action: "allow",
    tool: "bash",
    pattern: new RegExp(String.raw`^${READ_ONLY_COMMAND}(?=\s|$)`),
    capability: "read",
    reason: "Read-only inspection of the workspace.",
  },
  {
    id: "bash.allow.git-read-only",
    action: "allow",
    tool: "bash",
    pattern:
      /^git\s+(?:status|log|diff|show|blame|shortlog|describe|rev-parse|rev-list|ls-files|cat-file|reflog|grep|stash\s+list|worktree\s+list|config\s+--get|branch(?:\s+(?:-a|-r|-v|-vv|--all|--list|--show-current))*|remote(?:\s+-v)?|tag)(?=\s|$)/,
    capability: "read",
    reason: "Read-only git inspection.",
  },
  {
    id: "bash.allow.build-and-test",
    action: "allow",
    tool: "bash",
    pattern:
      /^(?:npm|pnpm|yarn|bun|turbo|nx|deno)\s+(?:run\s+)?(?:build|test|lint|typecheck|check|format|fmt|ci)(?::[\w.:-]+)?(?=\s|$)/,
    capability: "other",
    reason: "Ordinary build, test, lint, or typecheck script.",
  },
  {
    id: "bash.allow.build-and-test-binaries",
    action: "allow",
    tool: "bash",
    pattern:
      /^(?:tsc|eslint|oxlint|oxfmt|biome|prettier|ultracite|vitest|jest|mocha|pytest|playwright)(?=\s|$)/,
    capability: "other",
    reason: "Ordinary build, test, lint, or typecheck tool.",
  },
  {
    id: "bash.allow.build-and-test-toolchains",
    action: "allow",
    tool: "bash",
    pattern:
      /^(?:cargo|go)\s+(?:test|build|vet|check|clippy|fmt)(?=\s|$)|^make\s+(?:test|build|lint|check|typecheck)(?=\s|$)/,
    capability: "other",
    reason: "Ordinary build or test invocation for a non-JS toolchain.",
  },
];

/**
 * The baseline policy. Unmatched commands are allowed: this policy is a
 * denylist plus an explicit allowlist for the commands that must never be
 * gated, which preserves the behaviour the agent had before it existed.
 * Restricted profiles (see `read-only-policy.ts`) invert that default.
 */
export const defaultCommandPolicy: CommandPolicy = {
  id: "default",
  description:
    "QuackOps shipped baseline: deny unrecoverable destruction, credential exfiltration, and force-pushes to a default branch; ask for pushes, publishes, installs, and code piped into a shell; allow read-only inspection and build/test commands.",
  deny: DENY_RULES,
  ask: ASK_RULES,
  allow: ALLOW_RULES,
  defaultAction: "allow",
  defaultReason: "No policy rule matched this command.",
};
