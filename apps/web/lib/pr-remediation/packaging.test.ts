import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { PullRequestCheckRun } from "@/lib/github/client";

type CheckAnnotation = {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  message: string;
  title?: string;
};

let annotationsResult: CheckAnnotation[] | Error = [];
let logsResult: string | Error = "build failed";

const listAnnotationsMock = mock(
  async (): Promise<{ data: CheckAnnotation[] }> => {
    if (annotationsResult instanceof Error) {
      throw annotationsResult;
    }

    return { data: annotationsResult };
  },
);

const downloadJobLogsMock = mock(async (): Promise<{ data: string }> => {
  if (logsResult instanceof Error) {
    throw logsResult;
  }

  return { data: logsResult };
});

const generateTextMock = mock(async () => ({ text: "compacted log output" }));

mock.module("ai", () => ({
  generateText: generateTextMock,
  gateway: (model: string) => model,
}));

class MockOctokit {
  rest = {
    checks: {
      listAnnotations: listAnnotationsMock,
    },
    actions: {
      downloadJobLogsForWorkflowRun: downloadJobLogsMock,
    },
  };

  constructor(_: { auth: string }) {}
}

mock.module("@octokit/rest", () => ({
  Octokit: MockOctokit,
}));

const packagingModulePromise = import("./packaging");

const checkRuns: PullRequestCheckRun[] = [
  {
    id: 12,
    name: "Build / Lint",
    state: "failed",
    status: "completed",
    conclusion: "failure",
    detailsUrl: "https://github.com/acme/repo/actions/runs/12",
  },
];

describe("packageFailingChecks", () => {
  beforeEach(() => {
    annotationsResult = [];
    logsResult = "build failed";

    listAnnotationsMock.mockClear();
    downloadJobLogsMock.mockClear();
    generateTextMock.mockClear();
  });

  test("returns fallback prompt when logs are unavailable", async () => {
    annotationsResult = [
      {
        path: "src/index.ts",
        start_line: 10,
        end_line: 10,
        annotation_level: "failure",
        message: "Type error",
      },
    ];
    logsResult = new Error("403 forbidden");

    const { packageFailingChecks } = await packagingModulePromise;
    const result = await packageFailingChecks({
      checkRuns,
      token: "ghp_token",
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(result.prompt).toContain("# Fix Failing Checks");
    expect(result.prompt).toContain("Build / Lint");
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0]?.content).toContain("(Unable to fetch logs)");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  test("returns fallback prompt when annotations are unavailable", async () => {
    annotationsResult = new Error("annotations forbidden");
    logsResult = "short log output with failure";

    const { packageFailingChecks } = await packagingModulePromise;
    const result = await packageFailingChecks({
      checkRuns,
      token: "ghp_token",
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(result.prompt).toContain("# Fix Failing Checks");
    expect(result.prompt).toContain("Build / Lint");
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0]?.content).toContain(
      "short log output with failure",
    );
    expect(result.snippets[0]?.content).not.toContain("## Annotations");
  });

  test("redacts known secret patterns", async () => {
    const { redactSecrets } = await packagingModulePromise;
    const input = [
      "ghp_1234567890abcdefghij",
      "ghs_1234567890abcdefghij",
      "github_pat_1234567890abcdefghij",
      "sk-1234567890-abcdefghij",
      "AKIA1234567890ABCDEF",
      "Authorization: very-secret-header",
      "x-api-key=top-secret-key",
      "bearer:top-secret-bearer",
      "password:super-secret-password",
      "secret=super-secret-value",
      "token=super-secret-token",
      "api_key=super-secret-api-key",
    ].join("\n");

    const output = redactSecrets(input);

    expect(output).toContain("***REDACTED***");
    expect(output).not.toContain("ghp_1234567890abcdefghij");
    expect(output).not.toContain("ghs_1234567890abcdefghij");
    expect(output).not.toContain("github_pat_1234567890abcdefghij");
    expect(output).not.toContain("sk-1234567890-abcdefghij");
    expect(output).not.toContain("AKIA1234567890ABCDEF");
    expect(output).not.toContain("Authorization: very-secret-header");
    expect(output).not.toContain("x-api-key=top-secret-key");
    expect(output).not.toContain("bearer:top-secret-bearer");
    expect(output).not.toContain("password:super-secret-password");
    expect(output).not.toContain("secret=super-secret-value");
    expect(output).not.toContain("token=super-secret-token");
    expect(output).not.toContain("api_key=super-secret-api-key");
  });

  test("redacts secrets in long logs before summarization", async () => {
    const secret = "sk-1234567890-abcdefghijklmnopqrstuvwxyz";
    logsResult = `${"x".repeat(5000)}\n${secret}`;

    const { packageFailingChecks } = await packagingModulePromise;
    await packageFailingChecks({
      checkRuns,
      token: "ghp_token",
      repoOwner: "acme",
      repoName: "repo",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const calls = generateTextMock.mock.calls as unknown as Array<
      [{ prompt: string }]
    >;
    const params = calls[0]?.[0];
    expect(params).toBeDefined();
    expect(params?.prompt).toContain("***REDACTED***");
    expect(params?.prompt).not.toContain(secret);
  });
});
