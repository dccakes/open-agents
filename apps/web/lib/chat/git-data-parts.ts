/**
 * Turning an auto-commit / auto-PR result into the data part the chat renders.
 *
 * Extracted from `app/workflows/chat.ts` because there are now two places that
 * perform the same automation and must report it identically: the workflow, at
 * the end of a turn, and the approval-execution route, when a `strict` session's
 * pending approval is granted after the fact. A second copy of this mapping
 * would let the two drift, and the drift would be invisible until a user
 * compared a gated commit against an ungated one.
 *
 * Pure: no database, no sandbox, no network.
 */

import type { WebAgentCommitData, WebAgentPrData } from "@/app/types";
import type { AutoCommitResult } from "@/lib/chat/auto-commit-direct";
import type { AutoCreatePrResult } from "@/lib/chat/auto-pr-direct";

export function buildGitHubCommitUrl(
  repoOwner: string,
  repoName: string,
  commitSha: string,
): string {
  return `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/commit/${encodeURIComponent(commitSha)}`;
}

export function buildCommitData(
  result: AutoCommitResult,
  repoOwner: string,
  repoName: string,
): WebAgentCommitData {
  if (result.error) {
    return {
      status: "error",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
      error: result.error,
    };
  }

  if (result.committed) {
    return {
      status: "success",
      committed: result.committed,
      pushed: result.pushed,
      commitMessage: result.commitMessage,
      commitSha: result.commitSha,
      url:
        result.pushed && result.commitSha
          ? buildGitHubCommitUrl(repoOwner, repoName, result.commitSha)
          : undefined,
    };
  }

  return {
    status: "skipped",
    committed: false,
    pushed: false,
  };
}

export function buildPrData(result: AutoCreatePrResult): WebAgentPrData {
  if (result.error) {
    return {
      status: "error",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      error: result.error,
    };
  }

  if (result.skipped) {
    return {
      status: "skipped",
      created: result.created,
      syncedExisting: result.syncedExisting,
      prNumber: result.prNumber,
      url: result.prUrl,
      skipReason: result.skipReason,
    };
  }

  return {
    status: "success",
    created: result.created,
    syncedExisting: result.syncedExisting,
    prNumber: result.prNumber,
    url: result.prUrl,
  };
}

/**
 * Whether a pull request should follow the commit that just ran.
 *
 * The condition the workflow has always used: the commit did not fail, and
 * either it pushed something or it had nothing to commit (in which case the
 * branch is already where the remote is, and the PR is about existing commits).
 */
export function shouldCreatePrAfterCommit(
  result: AutoCommitResult | null,
): boolean {
  return (
    result != null && !result.error && (result.pushed || !result.committed)
  );
}
