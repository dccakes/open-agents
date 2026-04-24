import { beforeEach, describe, expect, mock, test } from "bun:test";

type ReadinessResult = {
  success: boolean;
  canMerge: boolean;
  reasons: string[];
  allowedMethods: Array<"merge" | "squash" | "rebase">;
  defaultMethod: "merge" | "squash" | "rebase";
  checks: {
    requiredTotal: number;
    passed: number;
    pending: number;
    failed: number;
  };
  checkRuns: Array<{
    id: number;
    name: string;
    state: "passed" | "pending" | "failed";
    status: string | null;
    conclusion: string | null;
    detailsUrl: string | null;
  }>;
  pr?: {
    number: number;
    state: "open" | "closed";
    isDraft: boolean;
    title: string;
    body: string | null;
    baseBranch: string;
    headBranch: string;
    headSha: string;
    headOwner: string | null;
    mergeable: boolean | null;
    mergeableState: string | null;
    additions: number;
    deletions: number;
    changedFiles: number;
    commits: number;
  };
  error?: string;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  return { promise, resolve, reject };
}

function makeReadiness(overrides?: Partial<ReadinessResult>): ReadinessResult {
  return {
    success: true,
    canMerge: false,
    reasons: [],
    allowedMethods: ["squash"],
    defaultMethod: "squash",
    checks: {
      requiredTotal: 1,
      passed: 0,
      pending: 0,
      failed: 1,
    },
    checkRuns: [],
    pr: {
      number: 123,
      state: "open",
      isDraft: false,
      title: "PR",
      body: null,
      baseBranch: "main",
      headBranch: "feature",
      headSha: "abc123",
      headOwner: null,
      mergeable: false,
      mergeableState: "blocked",
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      commits: 1,
    },
    ...overrides,
  };
}

const workflowRunIds: string[] = [];
let leaseOwner: string | null = null;
let readinessResult: ReadinessResult = makeReadiness();

const spies = {
  getWorkflowMetadata: mock(() => ({
    workflowRunId: workflowRunIds.shift() ?? "watcher-default",
  })),
  sleep: mock(() => Promise.resolve()),
  start: mock(() => Promise.resolve({ runId: "watcher-started" })),
  getRun: mock(() => ({
    status: Promise.resolve("completed" as const),
  })),
  claimWatcherLease: mock(
    async (_sessionId: string, _prNumber: number, runId: string) => {
      if (leaseOwner === null || leaseOwner === runId) {
        leaseOwner = runId;
        return true;
      }

      return false;
    },
  ),
  releaseWatcherLease: mock(
    async (_sessionId: string, _prNumber: number, runId: string) => {
      if (leaseOwner === runId) {
        leaseOwner = null;
      }
    },
  ),
  getRemediationState: mock(() => Promise.resolve(null)),
  upsertRemediationState: mock(() =>
    Promise.resolve({
      sessionId: "session-1",
      prNumber: 123,
      headSha: "abc123",
      attemptCount: 0,
      lastAttemptAt: null,
      lastFingerprintHash: null,
    }),
  ),
  recordRemediationAttempt: mock(() => Promise.resolve()),
  getPullRequestMergeReadiness: mock(
    () => Promise.resolve(readinessResult) as Promise<ReadinessResult>,
  ),
  getUserGitHubToken: mock(async () => "gh-token"),
};

mock.module("workflow", () => ({
  getWorkflowMetadata: spies.getWorkflowMetadata,
  sleep: spies.sleep,
}));

mock.module("workflow/api", () => ({
  start: spies.start,
  getRun: spies.getRun,
}));

mock.module("@/lib/db/pr-remediation", () => ({
  claimWatcherLease: spies.claimWatcherLease,
  releaseWatcherLease: spies.releaseWatcherLease,
  getRemediationState: spies.getRemediationState,
  upsertRemediationState: spies.upsertRemediationState,
  recordRemediationAttempt: spies.recordRemediationAttempt,
}));

mock.module("@/lib/github/client", () => ({
  getPullRequestMergeReadiness: spies.getPullRequestMergeReadiness,
}));

mock.module("@/lib/github/token", () => ({
  getUserGitHubToken: spies.getUserGitHubToken,
}));

const { prCheckWatcherWorkflow } = await import("./pr-check-watcher");

const baseParams = {
  sessionId: "session-1",
  userId: "user-1",
  prNumber: 123,
  repoOwner: "octo",
  repoName: "repo",
};

beforeEach(() => {
  workflowRunIds.length = 0;
  leaseOwner = null;
  readinessResult = makeReadiness();

  Object.values(spies).forEach((spy) => {
    spy.mockClear();
  });
});

describe("prCheckWatcherWorkflow lease behavior", () => {
  test("only one watcher lease wins when started concurrently", async () => {
    workflowRunIds.push("run-a", "run-b");
    const basePr = makeReadiness().pr as NonNullable<ReadinessResult["pr"]>;

    const evaluationDeferred = createDeferred<ReadinessResult>();
    spies.getPullRequestMergeReadiness.mockImplementationOnce(
      () => evaluationDeferred.promise,
    );

    const first = prCheckWatcherWorkflow(baseParams);
    const second = prCheckWatcherWorkflow(baseParams);

    await Promise.resolve();

    evaluationDeferred.resolve(
      makeReadiness({
        pr: {
          ...basePr,
          state: "closed",
        } as NonNullable<ReadinessResult["pr"]>,
      }),
    );

    await Promise.all([first, second]);

    expect(spies.claimWatcherLease).toHaveBeenCalledTimes(2);
    expect(spies.getPullRequestMergeReadiness).toHaveBeenCalledTimes(1);
    expect(spies.releaseWatcherLease).toHaveBeenCalledTimes(1);
  });

  test("second start attempt is a no-op when lease is already held", async () => {
    workflowRunIds.push("run-b");
    leaseOwner = "run-a";

    await prCheckWatcherWorkflow(baseParams);

    expect(spies.claimWatcherLease).toHaveBeenCalledTimes(1);
    expect(spies.getPullRequestMergeReadiness).not.toHaveBeenCalled();
    expect(spies.releaseWatcherLease).not.toHaveBeenCalled();
  });

  test("releases lease on terminal PR state", async () => {
    workflowRunIds.push("run-terminal");
    const basePr = makeReadiness().pr as NonNullable<ReadinessResult["pr"]>;
    readinessResult = makeReadiness({
      pr: {
        ...basePr,
        state: "closed",
      } as NonNullable<ReadinessResult["pr"]>,
    });

    await prCheckWatcherWorkflow(baseParams);

    expect(spies.releaseWatcherLease).toHaveBeenCalledTimes(1);
    expect(spies.releaseWatcherLease).toHaveBeenCalledWith(
      "session-1",
      123,
      "run-terminal",
    );
  });
});
