import { createHmac, timingSafeEqual } from "crypto";
import { desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { getLinearConfig } from "@/lib/config/linear";
import { getPublicConfig } from "@/lib/config/public";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { createSessionWithInitialChat } from "@/lib/db/sessions";
import {
  postLinearComment,
  postLinearThoughtActivity,
} from "@/lib/linear/activities";
import { buildIssueContextBlock, getLinearIssue } from "@/lib/linear/issues";
import { resolveApprovedLinearActor } from "@/lib/linear/resolve-actor";
import { getLinearWorkspaceToken } from "@/lib/linear/token";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import { checkAgentRunStartAllowed } from "@/lib/org/agent-runs-gate";
import { nanoid } from "nanoid";

const agentSessionEventSchema = z.object({
  type: z.string(),
  action: z.string(),
  data: z.object({
    id: z.string(),
    issue: z
      .object({
        id: z.string(),
        url: z.string(),
      })
      .optional(),
    actor: z
      .object({
        email: z.string().optional(),
        name: z.string().optional(),
      })
      .optional(),
  }),
});

function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  const expected = Buffer.from(digest);
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function POST(req: Request): Promise<Response> {
  const { webhookSecret } = getLinearConfig();
  if (!webhookSecret) {
    return Response.json(
      { error: "LINEAR_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const signature = req.headers.get("linear-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 401 });
  }

  const payloadText = await req.text();
  if (!verifySignature(payloadText, signature, webhookSecret)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = agentSessionEventSchema.safeParse(parsedPayload);
  if (!parsed.success || parsed.data.type !== "AgentSession") {
    return Response.json({ ok: true, ignored: true });
  }

  const { data } = parsed.data;
  if (!data.issue) {
    return Response.json({ ok: true, ignored: true });
  }

  const agentSessionId = data.id;
  const issueId = data.issue.id;
  const issueUrl = data.issue.url;
  const actorEmail = data.actor?.email;
  const actorName = data.actor?.name;

  after(async () => {
    try {
      await handleAgentSession({
        agentSessionId,
        issueId,
        issueUrl,
        actorEmail,
        actorName,
      });
    } catch (err) {
      console.error(
        "[Linear webhook] Unhandled error in deferred handler:",
        err,
      );
    }
  });

  return Response.json({ ok: true });
}

async function handleAgentSession({
  agentSessionId,
  issueId,
  issueUrl,
  actorEmail,
  actorName,
}: {
  agentSessionId: string;
  issueId: string;
  issueUrl: string;
  actorEmail?: string;
  actorName?: string;
}): Promise<void> {
  const token = await getLinearWorkspaceToken();
  if (!token) {
    console.error("[Linear webhook] No workspace token available");
    return;
  }

  try {
    await postLinearThoughtActivity(
      token,
      agentSessionId,
      "Starting on this, spinning up a session...",
    );
  } catch (err) {
    console.error("[Linear webhook] Failed to post thought activity:", err);
  }

  // Kill switch. This is a run-start path with no browser session, so it
  // checks the switch itself; the refusal is reported back into the Linear
  // thread rather than only logged, because a log line is invisible to whoever
  // delegated the issue.
  const runStart = await checkAgentRunStartAllowed();
  if (!runStart.allowed) {
    await postLinearComment(token, issueId, runStart.message).catch((err) =>
      console.error("[Linear webhook] Failed to post paused comment:", err),
    );
    return;
  }

  // This path has no browser session, so the membership chokepoint in
  // `lib/session/` never runs here. The matched user's membership is therefore
  // checked explicitly, before anything is created.
  const actor = await resolveApprovedLinearActor(actorEmail);

  if (!actor.ok) {
    if (actor.reason === "no-email") {
      console.warn("[Linear webhook] No actor email in payload");
      return;
    }

    const appUrl = getPublicConfig().appUrl ?? "";
    const handle = actorName ? `@${actorName}` : actorEmail;
    const message =
      actor.reason === "pending"
        ? `Hey ${handle}, ${actorEmail} is signed in but still waiting on an administrator to approve access. Once approved you can run sessions from Linear.`
        : `Hey ${handle}, ${actorEmail} isn't connected to Open Agents yet. Sign in at ${appUrl} to run sessions from Linear.`;

    await postLinearComment(token, issueId, message).catch((err) =>
      console.error("[Linear webhook] Failed to post refusal comment:", err),
    );
    return;
  }

  const user = { id: actor.userId };

  const [existingSession] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.linearAgentSessionId, agentSessionId))
    .limit(1);

  if (existingSession) {
    return;
  }

  const [lastSession] = await db
    .select({
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      branch: sessions.branch,
      cloneUrl: sessions.cloneUrl,
    })
    .from(sessions)
    .where(eq(sessions.userId, user.id))
    .orderBy(desc(sessions.createdAt))
    .limit(1);

  let issueContextBlock = "";
  try {
    const issue = await getLinearIssue(token, issueId);
    if (issue) {
      issueContextBlock = buildIssueContextBlock(issue);
    }
  } catch (err) {
    console.error("[Linear webhook] Failed to fetch issue content:", err);
  }

  const hasRepo = Boolean(lastSession?.repoOwner && lastSession?.repoName);
  const repoPrompt = hasRepo ? "" : "\n\nWhich repository should I work in?";
  const initialMessage = `Starting session from Linear issue.${repoPrompt}${issueContextBlock}`;

  await createSessionWithInitialChat({
    session: {
      id: nanoid(),
      userId: user.id,
      title: "Linear session",
      status: "running",
      repoOwner: lastSession?.repoOwner ?? null,
      repoName: lastSession?.repoName ?? null,
      branch: lastSession?.branch ?? null,
      cloneUrl: lastSession?.cloneUrl ?? null,
      isNewBranch: false,
      globalSkillRefs: [],
      provisionDb: false,
      sandboxState: { type: "vercel" },
      lifecycleState: "provisioning",
      lifecycleVersion: 0,
      linearIssueId: issueId,
      linearIssueUrl: issueUrl,
      linearAgentSessionId: agentSessionId,
    },
    initialChat: {
      id: nanoid(),
      title: initialMessage,
      modelId: APP_DEFAULT_MODEL_ID,
    },
  });
}
