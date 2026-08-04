import type { RuleCapability } from "./types";

/**
 * The bash commands that write, delete, or reach the network.
 *
 * The baseline has no reason to mention them: for the main agent under `auto`
 * they are ordinary work, and its `defaultAction` is `allow`. Two derived
 * profiles do have to name them, and they name the *same* families for
 * different actions:
 *
 * - the read-only profile denies them (`read-only.deny.<key>`)
 * - the strict profile gates them (`strict.ask.<key>`)
 *
 * They live here once so that adding a family — or fixing a pattern — reaches
 * both profiles in one edit, which is the same reason the profiles derive their
 * inherited rules from the baseline rather than restating them.
 */
export interface WriteClassCommand {
  /** Suffix of the rule id each profile builds. Stable; it appears in audits. */
  key: string;
  pattern: RegExp;
  capability: RuleCapability;
  /** What the command does, as a clause each profile frames in its own words. */
  description: string;
}

export const WRITE_CLASS_COMMANDS: readonly WriteClassCommand[] = [
  {
    key: "redirection",
    // `2>&1` and `&>` duplicate descriptors rather than writing a new file.
    pattern: /(?<![0-9<&])>{1,2}(?!&)/,
    capability: "write",
    description: "redirecting output to a file writes to the workspace.",
  },
  {
    key: "in-place-edit",
    pattern: /^(?:sed|perl|ruby|awk)\b[^|;&]*\s-i(?:\.\S*)?(?=\s|$)/,
    capability: "write",
    description: "in-place editing rewrites files.",
  },
  {
    key: "file-mutation",
    pattern:
      /^(?:mv|cp|rm|rmdir|mkdir|touch|tee|truncate|chmod|chown|chgrp|ln|unlink|patch|install|dd|shred)(?=\s|$)/,
    capability: "write",
    description: "this command mutates the filesystem.",
  },
  {
    key: "find-side-effects",
    pattern: /^find\b[^|;&]*\s-(?:exec|execdir|delete|ok|okdir)\b/,
    capability: "write",
    description:
      "find with -exec, -delete, or -ok acts on the files it matches rather than only listing them.",
  },
  {
    key: "git-write",
    pattern:
      /^git\s+(?:add|commit|push|pull|fetch|clone|checkout|switch|restore|reset|revert|merge|rebase|stash|clean|apply|am|cherry-pick|init|rm|mv|submodule|worktree\s+(?:add|remove)|tag\s+-|config(?!\s+--get))/,
    capability: "write",
    description:
      "this git subcommand changes the repository, the working tree, or a remote.",
  },
  {
    key: "network",
    pattern:
      /^(?:curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|telnet|ftp|xh|httpie|http)(?=\s|$)/,
    capability: "network",
    description: "this command reaches the network.",
  },
];
