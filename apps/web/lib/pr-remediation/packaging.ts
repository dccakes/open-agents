import type { PullRequestCheckRun } from "@/lib/github/client";
import { Octokit } from "@octokit/rest";
import { gateway, generateText } from "ai";

type CheckAnnotation = {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: string;
  message: string;
  title?: string;
};

type FixCheckSnippet = {
  filename: string;
  content: string;
};

type FixChecksResponse = {
  prompt: string;
  snippets: FixCheckSnippet[];
};

type PackageFailingChecksParams = {
  checkRuns: PullRequestCheckRun[];
  token: string;
  repoOwner: string;
  repoName: string;
};

export const MAX_CHECK_RUNS = 10;
export const UNABLE_TO_FETCH_LOGS = "(Unable to fetch logs)";
const REDACTED_SECRET = "***REDACTED***";

/**
 * Max characters of raw log to feed into the summarization LLM.
 * Haiku's context window is large enough for this, and we want to give it
 * as much as possible so it can find the real errors.
 */
export const MAX_RAW_LOG_INPUT = 180_000;

const SECRET_PATTERNS = [
  /(ghp|ghs|github_pat)_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(authorization|x-api-key|bearer)\s*[:=]\s*\S+/gi,
  /(password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

const LOG_SUMMARIZATION_PROMPT = `You are a CI log analyst. Your only job is to take raw GitHub Actions job logs and extract the useful information, cutting out all the noise.

Given the full log output of a failing CI job, return a compacted version that includes:

1. **Setup context** — a few lines identifying the job name, runner, and environment (keep it very short)
2. **The actual errors** — the complete error messages, stack traces, failing test names, type errors, lint violations, etc. Preserve these EXACTLY as they appear — do not summarize or paraphrase error messages. Include enough surrounding context (a few lines before/after) to understand what step or command produced the error.
3. **Exit summary** — the final few lines showing exit codes, timing, and overall pass/fail status

Cut out ONLY if the step/operation succeeded:
- Dependency installation logs (npm install, apt-get, etc.) — but KEEP if installation failed
- Cache restore/save operations — but KEEP if caching failed
- Downloading/uploading artifacts — but KEEP if the transfer failed
- Git checkout/fetch steps — but KEEP if checkout/fetch failed
- Verbose build output — but KEEP if the build failed
- Repeated/redundant timestamp prefixes (but keep one instance so the reader knows the format)

If a step failed, include its FULL output — the failure details are exactly what the developer needs.

Return ONLY the compacted log content. Do not add commentary, explanations, or markdown formatting around it. Preserve the original log format and line structure for the parts you keep. Use "..." on its own line to indicate where you've cut content.`;

function formatSnippetFilename(
  run: PullRequestCheckRun,
  index: number,
): string {
  const slug = run.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${String(index + 1).padStart(2, "0")}-${slug || "failing-check"}.log`;
}

function formatAnnotations(annotations: CheckAnnotation[]): string {
  if (annotations.length === 0) {
    return "";
  }

  const lines = ["## Annotations", ""];
  for (const ann of annotations) {
    const location =
      ann.start_line === ann.end_line
        ? `${ann.path}:${ann.start_line}`
        : `${ann.path}:${ann.start_line}-${ann.end_line}`;
    const level = ann.annotation_level.toUpperCase();
    const title = ann.title ? ` ${ann.title}:` : "";
    lines.push(`- **${level}** \`${location}\`${title} ${ann.message}`);
  }

  return lines.join("\n");
}

function formatSnippetContent(
  run: PullRequestCheckRun,
  compactedLog: string | undefined,
  annotations: CheckAnnotation[] | undefined,
): string {
  const lines = [`Check: ${run.name}`];

  if (run.detailsUrl) {
    lines.push(`Details: ${run.detailsUrl}`);
  }

  if (annotations && annotations.length > 0) {
    lines.push("");
    lines.push(formatAnnotations(annotations));
  }

  if (compactedLog) {
    lines.push("");
    lines.push(compactedLog);
  }

  return lines.join("\n");
}

function formatFixResponse(
  checkRuns: PullRequestCheckRun[],
  compactedLogs: Record<string, string>,
  annotationsByRunId: Record<string, CheckAnnotation[]>,
): FixChecksResponse {
  const noun = checkRuns.length === 1 ? "check is" : "checks are";
  const names = checkRuns.map((run) => run.name).join(", ");

  return {
    prompt: `# Fix Failing Checks\n\nThe following ${noun} failing on this pull request: ${names}. Review the attached snippets, identify the root cause, and push a fix.`,
    snippets: checkRuns.map((run, index) => ({
      filename: formatSnippetFilename(run, index),
      content: formatSnippetContent(
        run,
        run.id > 0 ? compactedLogs[String(run.id)] : undefined,
        run.id > 0 ? annotationsByRunId[String(run.id)] : undefined,
      ),
    })),
  };
}

export function buildFailingChecksFallback(
  checkRuns: PullRequestCheckRun[],
): FixChecksResponse {
  return formatFixResponse(checkRuns, {}, {});
}

async function compactLog(rawLog: string): Promise<string> {
  const redactedLog = redactSecrets(rawLog);
  if (redactedLog.length <= 4000) {
    return redactedLog;
  }

  let logInput = redactedLog;
  if (redactedLog.length > MAX_RAW_LOG_INPUT) {
    const half = Math.floor(MAX_RAW_LOG_INPUT / 2);
    const omitted = redactedLog.length - MAX_RAW_LOG_INPUT;
    logInput = `${redactedLog.slice(0, half)}\n\n... (${omitted} characters omitted) ...\n\n${redactedLog.slice(-half)}`;
  }

  const result = await generateText({
    model: gateway("anthropic/claude-haiku-4.5"),
    system: LOG_SUMMARIZATION_PROMPT,
    prompt: logInput,
  });

  return result.text;
}

export function redactSecrets(log: string): string {
  return SECRET_PATTERNS.reduce(
    (redactedLog, pattern) => redactedLog.replace(pattern, REDACTED_SECRET),
    log,
  );
}

export async function packageFailingChecks(
  params: PackageFailingChecksParams,
): Promise<FixChecksResponse> {
  const { checkRuns, token, repoOwner, repoName } = params;
  if (checkRuns.length > MAX_CHECK_RUNS) {
    throw new Error(`Too many check runs (max ${MAX_CHECK_RUNS})`);
  }

  const runsWithIds = checkRuns.filter((run) => run.id > 0);
  const compactedLogs: Record<string, string> = {};
  const allAnnotations: Record<string, CheckAnnotation[]> = {};

  if (runsWithIds.length > 0) {
    const octokit = new Octokit({ auth: token });

    await Promise.all(
      runsWithIds.map(async (run) => {
        const runId = String(run.id);
        const [annotations, rawLog] = await Promise.all([
          octokit.rest.checks
            .listAnnotations({
              owner: repoOwner,
              repo: repoName,
              check_run_id: run.id,
              per_page: 50,
            })
            .then((res) => res.data as CheckAnnotation[])
            .catch(() => [] as CheckAnnotation[]),
          octokit.rest.actions
            .downloadJobLogsForWorkflowRun({
              owner: repoOwner,
              repo: repoName,
              job_id: run.id,
            })
            .then((res) =>
              typeof res.data === "string" ? res.data : String(res.data),
            )
            .catch(() => UNABLE_TO_FETCH_LOGS),
        ]);

        allAnnotations[runId] = annotations;

        if (rawLog === UNABLE_TO_FETCH_LOGS) {
          compactedLogs[runId] = rawLog;
          return;
        }

        try {
          compactedLogs[runId] = await compactLog(rawLog);
        } catch {
          compactedLogs[runId] =
            rawLog.length > 16_000
              ? `${rawLog.slice(0, 8000)}\n\n... (${rawLog.length - 16_000} characters omitted) ...\n\n${rawLog.slice(-8000)}`
              : rawLog;
        }
      }),
    );
  }

  return formatFixResponse(checkRuns, compactedLogs, allAnnotations);
}
