import { getWorkflowMetadata, sleep } from "workflow";
import { getRun, start } from "workflow/api";
import {
  getPullRequestMergeReadiness,
  type PullRequestCheckRun,
} from "@/lib/github/client";
import {
  REMEDIATION_STATUS,
  checkSafetyPolicy,
  computeFailureFingerprint,
  type RemediationStatus,
  type SafetyDecision,
  type SafetyPolicyState,
} from "@/lib/pr-remediation/safety-controls";

const WATCHER_POLL_INTERVAL_MS = 60_000;
const RUN_STATUS_POLL_INTERVAL_MS = 1_000;

type RemediationRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

const TERMINAL_RUN_STATUSES = new Set<RemediationRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

type PrRemediationState = SafetyPolicyState & {
  sessionId: string;
  prNumber: number;
  headSha: string;
};

type PrRemediationDbModule = {
  claimWatcherLease: (
    sessionId: string,
    prNumber: number,
    runId: string,
  ) => Promise<boolean>;
  releaseWatcherLease: (
    sessionId: string,
    prNumber: number,
    runId: string,
  ) => Promise<void>;
  getRemediationState: (
    sessionId: string,
    prNumber: number,
    headSha: string,
  ) => Promise<PrRemediationState | undefined>;
  upsertRemediationState: (data: {
    id?: string;
    sessionId: string;
    prNumber: number;
    headSha: string;
    attemptCount?: number;
    lastAttemptAt?: Date | null;
    lastFingerprintHash?: string | null;
    status?: RemediationStatus;
    watcherRunId?: string | null;
  }) => Promise<PrRemediationState>;
  recordRemediationAttempt: (
    sessionId: string,
    prNumber: number,
    headSha: string,
    fingerprintHash: string,
  ) => Promise<void>;
};

type RemediationPackage = {
  prompt: string;
  snippets: Array<{ filename: string; content: string }>;
};

type PackagingModule = {
  packageFailingChecks: (params: {
    checkRuns: PullRequestCheckRun[];
    token: string;
    repoOwner: string;
    repoName: string;
  }) => Promise<RemediationPackage>;
};

type RemediationExecutorModule = {
  executeRemediation: (params: {
    sessionId: string;
    remediationPackage: RemediationPackage;
    messageId?: string;
  }) => Promise<string>;
};

type GitHubTokenModule = {
  getUserGitHubToken: (userId: string) => Promise<string | null>;
};

export type PrCheckWatcherParams = {
  sessionId: string;
  userId: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
};

type EvaluationResult = {
  allPassed: boolean;
  hasFailing: boolean;
  terminalState: boolean;
  checkRuns: PullRequestCheckRun[];
  headSha: string;
};

function makeRepoUrl(repoOwner: string, repoName: string): string {
  return `https://github.com/${repoOwner}/${repoName}`;
}

function makeDefaultFailingCheck(): PullRequestCheckRun {
  return {
    id: 0,
    name: "Required checks",
    state: "failed",
    status: "completed",
    conclusion: "failure",
    detailsUrl: null,
  };
}

async function loadPrRemediationDbModule(): Promise<PrRemediationDbModule> {
  return import("@/lib/db/pr-remediation");
}

async function loadPackagingModule(): Promise<PackagingModule> {
  return import("@/lib/pr-remediation/packaging");
}

async function loadRemediationExecutorModule(): Promise<RemediationExecutorModule> {
  return import("@/lib/pr-remediation/remediation-executor");
}

async function loadGitHubTokenModule(): Promise<GitHubTokenModule> {
  return import("@/lib/github/token");
}

async function claimWatcherLeaseStep(
  sessionId: string,
  prNumber: number,
  runId: string,
): Promise<boolean> {
  "use step";
  const dbModule = await loadPrRemediationDbModule();
  return dbModule.claimWatcherLease(sessionId, prNumber, runId);
}

async function releaseWatcherLeaseStep(
  sessionId: string,
  prNumber: number,
  runId: string,
): Promise<void> {
  "use step";
  const dbModule = await loadPrRemediationDbModule();
  await dbModule.releaseWatcherLease(sessionId, prNumber, runId);
}

async function resolveGitHubTokenStep(userId: string): Promise<string> {
  "use step";

  const tokenModule = await loadGitHubTokenModule();
  const token = await tokenModule.getUserGitHubToken(userId);

  if (!token) {
    throw new Error(`GitHub token not found for user: ${userId}`);
  }

  return token;
}

async function evaluateChecksStep(params: {
  token: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
}): Promise<EvaluationResult> {
  "use step";

  const readiness = await getPullRequestMergeReadiness({
    repoUrl: makeRepoUrl(params.repoOwner, params.repoName),
    prNumber: params.prNumber,
    token: params.token,
  });

  const terminalState =
    readiness.pr?.state === "closed" ||
    readiness.error === "Pull request not found";

  return {
    allPassed: readiness.canMerge,
    hasFailing: readiness.checks.failed > 0,
    terminalState,
    checkRuns: readiness.checkRuns ?? [],
    headSha: readiness.pr?.headSha ?? "unknown",
  };
}

async function getOrCreateRemediationStateStep(params: {
  sessionId: string;
  prNumber: number;
  headSha: string;
  watcherRunId: string;
}): Promise<PrRemediationState> {
  "use step";

  const dbModule = await loadPrRemediationDbModule();
  const existing = await dbModule.getRemediationState(
    params.sessionId,
    params.prNumber,
    params.headSha,
  );
  if (existing) {
    return existing;
  }

  return dbModule.upsertRemediationState({
    sessionId: params.sessionId,
    prNumber: params.prNumber,
    headSha: params.headSha,
    status: REMEDIATION_STATUS.watching,
    watcherRunId: params.watcherRunId,
  });
}

function statusForSafetyDecision(decision: SafetyDecision): RemediationStatus {
  if (decision.allowed) {
    return REMEDIATION_STATUS.watching;
  }

  switch (decision.reason) {
    case "budget_exhausted":
      return REMEDIATION_STATUS.exhausted;
    case "terminal_pr":
      return REMEDIATION_STATUS.terminal;
    case "cooldown":
      return REMEDIATION_STATUS.cooldown;
    case "fingerprint_dedup":
      return REMEDIATION_STATUS.fingerprintDedup;
  }
}

async function updateRemediationStateStatusStep(params: {
  sessionId: string;
  prNumber: number;
  headSha: string;
  status: RemediationStatus;
  watcherRunId: string;
  lastFingerprintHash?: string;
}): Promise<void> {
  "use step";

  const dbModule = await loadPrRemediationDbModule();
  await dbModule.upsertRemediationState({
    sessionId: params.sessionId,
    prNumber: params.prNumber,
    headSha: params.headSha,
    status: params.status,
    watcherRunId: params.watcherRunId,
    ...(params.lastFingerprintHash
      ? { lastFingerprintHash: params.lastFingerprintHash }
      : {}),
  });
}

async function packageFailingChecksStep(params: {
  checkRuns: PullRequestCheckRun[];
  token: string;
  repoOwner: string;
  repoName: string;
}): Promise<RemediationPackage> {
  "use step";

  const packagingModule = await loadPackagingModule();
  return packagingModule.packageFailingChecks({
    checkRuns: params.checkRuns,
    token: params.token,
    repoOwner: params.repoOwner,
    repoName: params.repoName,
  });
}

async function executeRemediationStep(params: {
  sessionId: string;
  remediationPackage: RemediationPackage;
  messageId: string;
}): Promise<string> {
  "use step";

  const remediationExecutor = await loadRemediationExecutorModule();
  return remediationExecutor.executeRemediation({
    sessionId: params.sessionId,
    remediationPackage: params.remediationPackage,
    messageId: params.messageId,
  });
}

async function recordRemediationAttemptStep(params: {
  sessionId: string;
  prNumber: number;
  headSha: string;
  fingerprintHash: string;
}): Promise<void> {
  "use step";

  const dbModule = await loadPrRemediationDbModule();
  await dbModule.recordRemediationAttempt(
    params.sessionId,
    params.prNumber,
    params.headSha,
    params.fingerprintHash,
  );
}

async function waitForRunCompletion(
  runId: string,
): Promise<RemediationRunStatus> {
  while (true) {
    let runStatus: RemediationRunStatus;

    try {
      runStatus = await getRun(runId).status;
    } catch {
      await sleep(new Date(Date.now() + RUN_STATUS_POLL_INTERVAL_MS));
      continue;
    }

    if (TERMINAL_RUN_STATUSES.has(runStatus)) {
      return runStatus;
    }

    await sleep(new Date(Date.now() + RUN_STATUS_POLL_INTERVAL_MS));
  }
}

export async function startPrCheckWatcher(
  params: PrCheckWatcherParams,
): Promise<{ started: true; runId: string }> {
  const run = await start(prCheckWatcherWorkflow, [params]);
  return { started: true, runId: run.runId };
}

export async function prCheckWatcherWorkflow(
  params: PrCheckWatcherParams,
): Promise<void> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();

  const leaseClaimed = await claimWatcherLeaseStep(
    params.sessionId,
    params.prNumber,
    workflowRunId,
  );
  if (!leaseClaimed) {
    console.log(
      JSON.stringify({
        event: "watcher-noop-lease-held",
        sessionId: params.sessionId,
        prNumber: params.prNumber,
        runId: workflowRunId,
      }),
    );
    return;
  }

  const token = await resolveGitHubTokenStep(params.userId);

  console.log(
    JSON.stringify({
      event: "watcher-started",
      sessionId: params.sessionId,
      prNumber: params.prNumber,
      runId: workflowRunId,
    }),
  );

  try {
    while (true) {
      const evaluation = await evaluateChecksStep({
        token,
        prNumber: params.prNumber,
        repoOwner: params.repoOwner,
        repoName: params.repoName,
      });

      console.log(
        JSON.stringify({
          event: "evaluation-result",
          sessionId: params.sessionId,
          prNumber: params.prNumber,
          runId: workflowRunId,
          headSha: evaluation.headSha,
          allPassed: evaluation.allPassed,
          hasFailing: evaluation.hasFailing,
          terminalState: evaluation.terminalState,
        }),
      );

      if (evaluation.terminalState) {
        if (evaluation.headSha !== "unknown") {
          await updateRemediationStateStatusStep({
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            headSha: evaluation.headSha,
            status: REMEDIATION_STATUS.terminal,
            watcherRunId: workflowRunId,
          });
        }

        console.log(
          JSON.stringify({
            event: "watcher-stopped",
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            runId: workflowRunId,
            reason: "terminal_pr",
          }),
        );
        return;
      }

      if (!evaluation.hasFailing) {
        await sleep(new Date(Date.now() + WATCHER_POLL_INTERVAL_MS));
        continue;
      }

      const fingerprintHash = computeFailureFingerprint(evaluation.checkRuns);
      const remediationState = await getOrCreateRemediationStateStep({
        sessionId: params.sessionId,
        prNumber: params.prNumber,
        headSha: evaluation.headSha,
        watcherRunId: workflowRunId,
      });

      const safetyDecision = checkSafetyPolicy({
        state: remediationState,
        fingerprintHash,
        prTerminal: evaluation.terminalState,
        now: new Date(),
      });

      if (!safetyDecision.allowed) {
        await updateRemediationStateStatusStep({
          sessionId: params.sessionId,
          prNumber: params.prNumber,
          headSha: evaluation.headSha,
          status: statusForSafetyDecision(safetyDecision),
          watcherRunId: workflowRunId,
          lastFingerprintHash: fingerprintHash,
        });

        console.log(
          JSON.stringify({
            event: "safety-stop",
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            runId: workflowRunId,
            headSha: evaluation.headSha,
            reason: safetyDecision.reason,
          }),
        );
        await sleep(new Date(Date.now() + WATCHER_POLL_INTERVAL_MS));
        continue;
      }

      const failingCheckRuns = evaluation.checkRuns.filter(
        (checkRun) => checkRun.state === "failed",
      );
      const checksToPackage =
        failingCheckRuns.length > 0
          ? failingCheckRuns
          : [makeDefaultFailingCheck()];

      try {
        const remediationPackage = await packageFailingChecksStep({
          checkRuns: checksToPackage,
          token,
          repoOwner: params.repoOwner,
          repoName: params.repoName,
        });

        const remediationRunId = await executeRemediationStep({
          sessionId: params.sessionId,
          remediationPackage,
          messageId: crypto.randomUUID(),
        });

        await recordRemediationAttemptStep({
          sessionId: params.sessionId,
          prNumber: params.prNumber,
          headSha: evaluation.headSha,
          fingerprintHash,
        });

        console.log(
          JSON.stringify({
            event: "remediation-triggered",
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            runId: workflowRunId,
            remediationRunId,
            headSha: evaluation.headSha,
            attemptCount: remediationState.attemptCount + 1,
          }),
        );

        const remediationStatus = await waitForRunCompletion(remediationRunId);

        await updateRemediationStateStatusStep({
          sessionId: params.sessionId,
          prNumber: params.prNumber,
          headSha: evaluation.headSha,
          status: REMEDIATION_STATUS.remediated,
          watcherRunId: workflowRunId,
          lastFingerprintHash: fingerprintHash,
        });

        console.log(
          JSON.stringify({
            event: "remediation-finished",
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            runId: workflowRunId,
            remediationRunId,
            status: remediationStatus,
          }),
        );

        continue;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "remediation-error",
            sessionId: params.sessionId,
            prNumber: params.prNumber,
            runId: workflowRunId,
            headSha: evaluation.headSha,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        await sleep(new Date(Date.now() + WATCHER_POLL_INTERVAL_MS));
      }
    }
  } finally {
    await releaseWatcherLeaseStep(
      params.sessionId,
      params.prNumber,
      workflowRunId,
    );
  }
}
