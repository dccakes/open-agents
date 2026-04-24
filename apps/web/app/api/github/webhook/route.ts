import { createHmac, timingSafeEqual } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import {
  deleteInstallationByInstallationId,
  getInstallationsByInstallationId,
  updateInstallationsByInstallationId,
  upsertInstallation,
} from "@/lib/db/installations";
import { recordWebhookDeliveryIfNew } from "@/lib/db/pr-remediation";
import { updateSession } from "@/lib/db/sessions";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { archiveSession } from "@/lib/sandbox/archive-session";

const installationWebhookSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    repository_selection: z.enum(["all", "selected"]).optional(),
    html_url: z.string().url().nullable().optional(),
    account: z
      .object({
        login: z.string(),
        type: z.string(),
      })
      .optional(),
  }),
});

const repositorySchema = z.object({
  name: z.string(),
  owner: z.object({
    login: z.string(),
  }),
});

const pullRequestReferenceSchema = z.object({
  number: z.number(),
});

const pullRequestWebhookSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  pull_request: z.object({
    number: z.number(),
    merged: z.boolean().optional(),
  }),
});

const checkRunWebhookSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  check_run: z.object({
    pull_requests: z.array(pullRequestReferenceSchema).default([]),
  }),
});

const checkSuiteWebhookSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  check_suite: z.object({
    pull_requests: z.array(pullRequestReferenceSchema).default([]),
  }),
});

const workflowRunWebhookSchema = z.object({
  action: z.string(),
  repository: repositorySchema,
  workflow_run: z.object({
    pull_requests: z.array(pullRequestReferenceSchema).default([]),
  }),
});

function normalizeAccountType(type: string): "User" | "Organization" {
  return type === "Organization" ? "Organization" : "User";
}

function verifySignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const provided = Buffer.from(signatureHeader);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

async function getOpenLinkedSessionIds(
  repoOwner: string,
  repoName: string,
  prNumber: number,
): Promise<string[]> {
  const linkedSessions = await db.query.sessions.findMany({
    columns: {
      id: true,
    },
    where: and(
      sql`lower(${sessions.repoOwner}) = ${repoOwner.toLowerCase()}`,
      sql`lower(${sessions.repoName}) = ${repoName.toLowerCase()}`,
      eq(sessions.prNumber, prNumber),
      eq(sessions.prStatus, "open"),
    ),
  });

  return linkedSessions.map((sessionRecord) => sessionRecord.id);
}

async function startWatcherForSession(sessionId: string): Promise<void> {
  try {
    const [
      { getSessionById },
      { getUserGitHubToken },
      { startPrCheckWatcher },
    ] = await Promise.all([
      import("@/lib/db/sessions"),
      import("@/lib/github/token"),
      import("@/app/workflows/pr-check-watcher"),
    ]);

    const session = await getSessionById(sessionId);
    if (!session) {
      console.warn(
        JSON.stringify({
          event: "watcher-trigger-skipped",
          sessionId,
          reason: "session_not_found",
        }),
      );
      return;
    }

    if (
      session.prStatus !== "open" ||
      typeof session.prNumber !== "number" ||
      !session.repoOwner ||
      !session.repoName
    ) {
      console.warn(
        JSON.stringify({
          event: "watcher-trigger-skipped",
          sessionId: session.id,
          reason: "session_not_eligible",
        }),
      );
      return;
    }

    const token = await getUserGitHubToken(session.userId);
    if (!token) {
      console.warn(
        JSON.stringify({
          event: "watcher-trigger-skipped",
          sessionId: session.id,
          reason: "missing_github_token",
        }),
      );
      return;
    }

    await startPrCheckWatcher({
      sessionId: session.id,
      userId: session.userId,
      prNumber: session.prNumber,
      repoOwner: session.repoOwner,
      repoName: session.repoName,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "watcher-trigger-error",
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function triggerWatcherEvaluation(sessionId: string): void {
  after(async () => {
    await startWatcherForSession(sessionId);
  });
}

async function triggerWatcherForPullRequests(
  repoOwner: string,
  repoName: string,
  pullRequestNumbers: number[],
): Promise<{
  matchedSessions: number;
  triggeredSessions: number;
}> {
  const uniquePrNumbers = [...new Set(pullRequestNumbers)];
  const sessionIds = new Set<string>();
  let matchedSessions = 0;

  for (const prNumber of uniquePrNumbers) {
    const linkedSessionIds = await getOpenLinkedSessionIds(
      repoOwner,
      repoName,
      prNumber,
    );

    matchedSessions += linkedSessionIds.length;

    for (const sessionId of linkedSessionIds) {
      sessionIds.add(sessionId);
    }
  }

  for (const sessionId of sessionIds) {
    triggerWatcherEvaluation(sessionId);
  }

  return {
    matchedSessions,
    triggeredSessions: sessionIds.size,
  };
}

async function handleCheckCompletedWebhook(params: {
  event: "check_run" | "check_suite" | "workflow_run";
  action: string;
  repoOwner: string;
  repoName: string;
  pullRequestNumbers: number[];
}): Promise<Response> {
  if (params.action !== "completed") {
    return Response.json({
      ok: true,
      ignored: true,
      event: params.event,
      action: params.action,
    });
  }

  const { matchedSessions, triggeredSessions } =
    await triggerWatcherForPullRequests(
      params.repoOwner,
      params.repoName,
      params.pullRequestNumbers,
    );

  return Response.json({
    ok: true,
    event: params.event,
    matchedSessions,
    triggeredSessions,
  });
}

async function handlePullRequestWebhook(
  payload: z.infer<typeof pullRequestWebhookSchema>,
): Promise<Response> {
  const action = payload.action;
  if (
    action !== "closed" &&
    action !== "reopened" &&
    action !== "synchronize"
  ) {
    return Response.json({ ok: true, ignored: true, action });
  }

  const repoOwner = payload.repository.owner.login;
  const repoName = payload.repository.name;
  const prNumber = payload.pull_request.number;

  if (action === "synchronize") {
    const { matchedSessions, triggeredSessions } =
      await triggerWatcherForPullRequests(repoOwner, repoName, [prNumber]);

    return Response.json({
      ok: true,
      event: "pull_request",
      action,
      matchedSessions,
      triggeredSessions,
    });
  }

  const prStatus =
    action === "closed"
      ? payload.pull_request.merged
        ? "merged"
        : "closed"
      : "open";

  const linkedSessions = await db.query.sessions.findMany({
    where: and(
      sql`lower(${sessions.repoOwner}) = ${repoOwner.toLowerCase()}`,
      sql`lower(${sessions.repoName}) = ${repoName.toLowerCase()}`,
      eq(sessions.prNumber, prNumber),
    ),
  });

  if (linkedSessions.length === 0) {
    return Response.json({
      ok: true,
      event: "pull_request",
      action,
      matchedSessions: 0,
      updatedSessions: 0,
      archivedSessions: 0,
    });
  }

  let updatedSessions = 0;
  let archivedSessions = 0;

  for (const sessionRecord of linkedSessions) {
    const shouldArchive =
      action === "closed" && sessionRecord.status !== "archived";

    const updatePayload: Parameters<typeof updateSession>[1] = {};

    if (sessionRecord.prStatus !== prStatus) {
      updatePayload.prStatus = prStatus;
    }

    if (shouldArchive) {
      const archived = await archiveSession(sessionRecord.id, {
        currentSession: sessionRecord,
        update: updatePayload,
        logPrefix: "[GitHub webhook]",
        scheduleBackgroundWork: after,
      });

      if (archived.session) {
        updatedSessions += 1;
      }
      if (archived.archiveTriggered) {
        archivedSessions += 1;
      }
      continue;
    }

    if (Object.keys(updatePayload).length > 0) {
      const updated = await updateSession(sessionRecord.id, updatePayload);
      if (updated) {
        updatedSessions += 1;
      }
    }
  }

  return Response.json({
    ok: true,
    event: "pull_request",
    action,
    prStatus,
    matchedSessions: linkedSessions.length,
    updatedSessions,
    archivedSessions,
  });
}

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: "GITHUB_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const event = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256");

  if (!event || !signature) {
    return Response.json({ error: "Missing webhook headers" }, { status: 400 });
  }

  const payloadText = await req.text();
  if (!verifySignature(payloadText, signature, webhookSecret)) {
    return Response.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  }

  if (event === "ping") {
    return Response.json({ ok: true });
  }

  const deliveryId = req.headers.get("x-github-delivery");
  if (deliveryId) {
    const isNewDelivery = await recordWebhookDeliveryIfNew(deliveryId);
    if (!isNewDelivery) {
      return Response.json({ ok: true, duplicate: true, deliveryId });
    }
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (event === "pull_request") {
    const parsed = pullRequestWebhookSchema.safeParse(parsedPayload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return handlePullRequestWebhook(parsed.data);
  }

  if (event === "check_run") {
    const parsed = checkRunWebhookSchema.safeParse(parsedPayload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return handleCheckCompletedWebhook({
      event: "check_run",
      action: parsed.data.action,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      pullRequestNumbers: parsed.data.check_run.pull_requests.map(
        (pullRequest) => pullRequest.number,
      ),
    });
  }

  if (event === "check_suite") {
    const parsed = checkSuiteWebhookSchema.safeParse(parsedPayload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return handleCheckCompletedWebhook({
      event: "check_suite",
      action: parsed.data.action,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      pullRequestNumbers: parsed.data.check_suite.pull_requests.map(
        (pullRequest) => pullRequest.number,
      ),
    });
  }

  if (event === "workflow_run") {
    const parsed = workflowRunWebhookSchema.safeParse(parsedPayload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return handleCheckCompletedWebhook({
      event: "workflow_run",
      action: parsed.data.action,
      repoOwner: parsed.data.repository.owner.login,
      repoName: parsed.data.repository.name,
      pullRequestNumbers: parsed.data.workflow_run.pull_requests.map(
        (pullRequest) => pullRequest.number,
      ),
    });
  }

  if (event !== "installation" && event !== "installation_repositories") {
    return Response.json({ ok: true, ignored: true, event });
  }

  const parsed = installationWebhookSchema.safeParse(parsedPayload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const installationId = parsed.data.installation.id;
  const repositorySelection = parsed.data.installation.repository_selection;
  const account = parsed.data.installation.account;
  const installationUrl = parsed.data.installation.html_url ?? null;

  if (event === "installation" && parsed.data.action === "deleted") {
    const deleted = await deleteInstallationByInstallationId(installationId);
    return Response.json({ ok: true, deleted });
  }

  if (!repositorySelection && !account) {
    return Response.json({ ok: true, ignored: true, reason: "no-updates" });
  }

  const existing = await getInstallationsByInstallationId(installationId);

  if (
    existing.length > 0 &&
    account &&
    repositorySelection &&
    (event === "installation" || event === "installation_repositories")
  ) {
    for (const row of existing) {
      await upsertInstallation({
        userId: row.userId,
        installationId,
        accountLogin: account.login,
        accountType: normalizeAccountType(account.type),
        repositorySelection,
        installationUrl,
      });
    }

    return Response.json({ ok: true, updatedUsers: existing.length });
  }

  const updated = await updateInstallationsByInstallationId(installationId, {
    ...(repositorySelection ? { repositorySelection } : {}),
    ...(installationUrl ? { installationUrl } : {}),
  });

  return Response.json({ ok: true, updatedUsers: updated });
}
