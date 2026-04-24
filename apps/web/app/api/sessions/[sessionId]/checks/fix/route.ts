import {
  requireAuthenticatedUser,
  requireOwnedSession,
} from "@/app/api/sessions/_lib/session-context";
import type { PullRequestCheckRun } from "@/lib/github/client";
import { getUserGitHubToken } from "@/lib/github/token";
import {
  buildFailingChecksFallback,
  MAX_CHECK_RUNS,
  packageFailingChecks,
} from "@/lib/pr-remediation/packaging";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

type FixChecksRequest = {
  checkRuns: PullRequestCheckRun[];
};

/**
 * Builds a "fix failing checks" prompt plus native snippet attachments.
 *
 * For each failing check we fetch:
 *   1. **Annotations** via `checks.listAnnotationsForCheckRun` — structured
 *      error data with file paths and line numbers (highest signal).
 *   2. **Raw job logs** via `actions.downloadJobLogsForWorkflowRun` — then
 *      compacted by a lightweight LLM call that strips CI noise and preserves
 *      the actual errors, stack traces, and exit status.
 *
 * Requires the user's GitHub token with `actions: read` and `checks: read` permissions.
 *
 * Request body:
 *   { checkRuns: PullRequestCheckRun[] } — the failing check runs
 *
 * Returns:
 *   { prompt: string, snippets: { filename: string, content: string }[] }
 */
export async function POST(req: Request, context: RouteContext) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { sessionId } = await context.params;
  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  if (!sessionRecord.repoOwner || !sessionRecord.repoName) {
    return Response.json(
      { error: "Session is not linked to a GitHub repository" },
      { status: 400 },
    );
  }

  let body: FixChecksRequest;
  try {
    body = (await req.json()) as FixChecksRequest;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { checkRuns } = body;
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return Response.json({ error: "No check runs provided" }, { status: 400 });
  }

  if (checkRuns.length > MAX_CHECK_RUNS) {
    return Response.json(
      { error: `Too many check runs (max ${MAX_CHECK_RUNS})` },
      { status: 400 },
    );
  }

  const token = await getUserGitHubToken(authResult.userId);
  if (!token) {
    return Response.json(buildFailingChecksFallback(checkRuns));
  }

  return Response.json(
    await packageFailingChecks({
      checkRuns,
      token,
      repoOwner: sessionRecord.repoOwner,
      repoName: sessionRecord.repoName,
    }),
  );
}
