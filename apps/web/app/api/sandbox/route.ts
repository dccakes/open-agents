import { checkBotId } from "botid/server";
import {
  connectSandbox,
  defaultRegistry,
  type SandboxProviderType,
  type SandboxState,
} from "@open-agents/sandbox";
import {
  requireAuthenticatedUser,
  requireOwnedSession,
  type SessionRecord,
} from "@/app/api/sessions/_lib/session-context";
import { botIdConfig } from "@/lib/botid";
import { getGitHubUserProfile, getUserGitHubToken } from "@/lib/github/token";
import { updateSession } from "@/lib/db/sessions";
import { parseGitHubUrl } from "@/lib/github/client";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "@/lib/sandbox/config";
import {
  buildActiveLifecycleUpdate,
  getNextLifecycleVersion,
} from "@/lib/sandbox/lifecycle";
import { kickSandboxLifecycleWorkflow } from "@/lib/sandbox/lifecycle-kick";
import { installGlobalSkills } from "@/lib/skills/global-skill-installer";
import {
  canOperateOnSandbox,
  clearSandboxState,
  getSessionSandboxName,
  hasResumableSandboxState,
} from "@/lib/sandbox/utils";
import { getEnvResolver } from "@/lib/sandbox/env-resolver";
import {
  getDbProvisioner,
  type DbTeardownMetadata,
} from "@/lib/sandbox/db-provisioner";
import { getServerSession } from "@/lib/session/get-server-session";
// import { buildDevelopmentDotenvFromVercelProject } from "@/lib/vercel/projects";
// import { getUserVercelToken } from "@/lib/vercel/token";

interface CreateSandboxRequest {
  repoUrl?: string;
  branch?: string;
  isNewBranch?: boolean;
  sessionId?: string;
  sandboxType?: SandboxProviderType | "cloud";
}

function isValidRequestSandboxType(
  type: unknown,
): type is SandboxProviderType | "cloud" {
  return (
    type === "vercel" ||
    type === "docker" ||
    type === "daytona" ||
    type === "cloud"
  );
}

function toProviderType(type: unknown): SandboxProviderType {
  if (type === "docker" || type === "daytona" || type === "vercel") {
    return type;
  }

  // Backward compatibility for legacy persisted states.
  if (type === "cloud") {
    return "vercel";
  }

  return "vercel";
}

function extractDbTeardownMetadata(
  sessionRecord: SessionRecord,
): DbTeardownMetadata | null {
  const rawMetadata = sessionRecord.dbTeardownMetadata;
  if (!rawMetadata) {
    return null;
  }

  if (!rawMetadata.identifier) {
    return null;
  }

  return rawMetadata;
}

// async function syncVercelProjectEnvVarsToSandbox(params: {
//   userId: string;
//   sessionRecord: SessionRecord;
//   sandbox: Awaited<ReturnType<typeof connectSandbox>>;
// }): Promise<void> {
//   if (!params.sessionRecord.vercelProjectId) {
//     return;
//   }
//
//   const token = await getUserVercelToken(params.userId);
//   if (!token) {
//     return;
//   }
//
//   const dotenvContent = await buildDevelopmentDotenvFromVercelProject({
//     token,
//     projectIdOrName: params.sessionRecord.vercelProjectId,
//     teamId: params.sessionRecord.vercelTeamId,
//   });
//   if (!dotenvContent) {
//     return;
//   }
//
//   await params.sandbox.writeFile(
//     `${params.sandbox.workingDirectory}/.env.local`,
//     dotenvContent,
//     "utf-8",
//   );
// }

async function installSessionGlobalSkills(params: {
  sessionRecord: SessionRecord;
  sandbox: Awaited<ReturnType<typeof connectSandbox>>;
}): Promise<void> {
  const globalSkillRefs = params.sessionRecord.globalSkillRefs ?? [];
  if (globalSkillRefs.length === 0) {
    return;
  }

  await installGlobalSkills({
    sandbox: params.sandbox,
    globalSkillRefs,
  });
}

export async function POST(req: Request) {
  let body: CreateSandboxRequest;
  try {
    body = (await req.json()) as CreateSandboxRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    body.sandboxType !== undefined &&
    !isValidRequestSandboxType(body.sandboxType)
  ) {
    return Response.json({ error: "Invalid sandbox type" }, { status: 400 });
  }

  const { repoUrl, branch = "main", isNewBranch = false, sessionId } = body;

  // Get session for auth
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const botVerification = await checkBotId(botIdConfig);
  if (botVerification.isBot) {
    return Response.json({ error: "Access denied" }, { status: 403 });
  }

  if (repoUrl) {
    const parsedRepo = parseGitHubUrl(repoUrl);
    if (!parsedRepo) {
      return Response.json(
        { error: "Invalid GitHub repository URL" },
        { status: 400 },
      );
    }
  }

  // Validate session ownership
  let sessionRecord: SessionRecord | undefined;
  if (sessionId) {
    const sessionContext = await requireOwnedSession({
      userId: session.user.id,
      sessionId,
    });
    if (!sessionContext.ok) {
      return sessionContext.response;
    }

    sessionRecord = sessionContext.sessionRecord;
  }

  const requestedType = toProviderType(
    body.sandboxType ?? sessionRecord?.sandboxState?.type,
  );
  const githubToken = await getUserGitHubToken(session.user.id);

  if (repoUrl && requestedType !== "vercel") {
    return Response.json(
      {
        error:
          "Repository bootstrap is currently only supported for the vercel sandbox provider for secure auth reasons. Set sandboxType to 'vercel' or omit repoUrl.",
      },
      { status: 400 },
    );
  }

  if (repoUrl && !githubToken) {
    return Response.json(
      { error: "Connect GitHub to access repositories" },
      { status: 403 },
    );
  }

  const providerDef = defaultRegistry.get(requestedType);
  if (!providerDef?.isAvailable()) {
    const reason =
      providerDef?.reasonUnavailable() ??
      (providerDef
        ? `Provider '${requestedType}' is currently unavailable`
        : `Provider '${requestedType}' is not registered`);
    return Response.json(
      { error: `Sandbox provider unavailable: ${reason}` },
      { status: 400 },
    );
  }

  const sandboxName = sessionId ? getSessionSandboxName(sessionId) : undefined;
  const ghProfile = await getGitHubUserProfile(session.user.id);
  const githubNoreplyEmail =
    ghProfile?.externalUserId && ghProfile.username
      ? `${ghProfile.externalUserId}+${ghProfile.username}@users.noreply.github.com`
      : undefined;

  const gitUser = {
    name: session.user.name ?? ghProfile?.username ?? session.user.username,
    email:
      githubNoreplyEmail ??
      session.user.email ??
      `${session.user.username}@users.noreply.github.com`,
  };

  // ============================================
  // CREATE OR RESUME: Create a named persistent sandbox for this session.
  // ============================================
  const startTime = Date.now();

  const source = repoUrl
    ? {
        repo: repoUrl,
        branch: isNewBranch ? undefined : branch,
        newBranch: isNewBranch ? branch : undefined,
      }
    : undefined;

  let resolvedEnv: Record<string, string> | undefined;
  try {
    const envResolver = getEnvResolver();
    if (envResolver) {
      resolvedEnv = await envResolver.resolve({
        projectId: sessionRecord?.vercelProjectId ?? undefined,
        environment: "production",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to resolve sandbox environment variables:", error);
    return Response.json(
      {
        error: `Failed to resolve sandbox environment variables. Verify SANDBOX_ENV_RESOLVER configuration and provider credentials. ${message}`,
      },
      { status: 500 },
    );
  }

  let dbTeardownMetadata: DbTeardownMetadata | undefined;
  const shouldProvisionDb = sessionRecord?.provisionDb === true;

  if (shouldProvisionDb && sessionId) {
    const provisioner = await getDbProvisioner(requestedType);
    if (provisioner) {
      try {
        const dbResult = await provisioner.provision(sessionId);
        resolvedEnv = {
          ...resolvedEnv,
          POSTGRES_URL: dbResult.postgresUrl,
        };
        dbTeardownMetadata = dbResult.teardownMetadata;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `DB provisioning failed for session ${sessionId}:`,
          error,
        );
        return Response.json(
          { error: `Database provisioning failed: ${message}` },
          { status: 500 },
        );
      }
    }
  }

  const requestedState: SandboxState =
    requestedType === "vercel"
      ? {
          ...(sessionRecord?.sandboxState &&
          (sessionRecord.sandboxState.type === "vercel" ||
            sessionRecord.sandboxState.type === "cloud")
            ? sessionRecord.sandboxState
            : {}),
          type: "vercel",
          ...(sandboxName ? { sandboxName } : {}),
          ...(source ? { source } : {}),
        }
      : requestedType === "docker"
        ? {
            ...(sessionRecord?.sandboxState?.type === "docker"
              ? sessionRecord.sandboxState
              : {}),
            type: "docker",
          }
        : {
            ...(sessionRecord?.sandboxState?.type === "daytona"
              ? sessionRecord.sandboxState
              : {}),
            type: "daytona",
          };

  let sandbox: Awaited<ReturnType<typeof connectSandbox>>;
  try {
    sandbox = await connectSandbox({
      state: requestedState,
      options: {
        ...(requestedType === "vercel" && githubToken ? { githubToken } : {}),
        gitUser,
        timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
        ports: DEFAULT_SANDBOX_PORTS,
        baseSnapshotId: DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
        persistent: requestedType === "vercel" && !!sandboxName,
        resume: requestedType === "vercel" && !!sandboxName,
        createIfMissing: requestedType === "vercel" && !!sandboxName,
        ...(resolvedEnv !== undefined ? { env: resolvedEnv } : {}),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sandbox error";
    console.error(`[sandbox] Failed to connect/create sandbox:`, error);
    return Response.json({ error: message }, { status: 500 });
  }

  if (sessionId && sandbox.getState) {
    const nextState = sandbox.getState() as SandboxState;
    await updateSession(sessionId, {
      sandboxState: nextState,
      snapshotUrl: null,
      snapshotCreatedAt: null,
      lifecycleVersion: getNextLifecycleVersion(
        sessionRecord?.lifecycleVersion,
      ),
      ...buildActiveLifecycleUpdate(nextState),
    });

    if (dbTeardownMetadata) {
      try {
        await updateSession(sessionId, {
          dbTeardownMetadata,
        });
      } catch (error) {
        console.error(
          `Failed to persist DB teardown metadata for session ${sessionId}:`,
          error,
        );
      }
    }

    if (sessionRecord) {
      // TODO: Re-enable this once we have a solid exfiltration defense strategy.
      // try {
      //   await syncVercelProjectEnvVarsToSandbox({
      //     userId: session.user.id,
      //     sessionRecord,
      //     sandbox,
      //   });
      // } catch (error) {
      //   console.error(
      //     `Failed to sync Vercel env vars for session ${sessionRecord.id}:`,
      //     error,
      //   );
      // }

      try {
        await installSessionGlobalSkills({
          sessionRecord,
          sandbox,
        });
      } catch (error) {
        console.error(
          `Failed to install global skills for session ${sessionRecord.id}:`,
          error,
        );
      }
    }

    kickSandboxLifecycleWorkflow({
      sessionId,
      reason: "sandbox-created",
    });
  }

  const readyMs = Date.now() - startTime;

  return Response.json({
    createdAt: Date.now(),
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    currentBranch: repoUrl ? branch : undefined,
    mode: requestedType,
    timing: { readyMs },
  });
}

export async function DELETE(req: Request) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("sessionId" in body) ||
    typeof (body as Record<string, unknown>).sessionId !== "string"
  ) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const { sessionId } = body as { sessionId: string };

  const sessionContext = await requireOwnedSession({
    userId: authResult.userId,
    sessionId,
  });
  if (!sessionContext.ok) {
    return sessionContext.response;
  }

  const { sessionRecord } = sessionContext;

  // If there's no sandbox to stop, return success (idempotent)
  if (!canOperateOnSandbox(sessionRecord.sandboxState)) {
    return Response.json({ success: true, alreadyStopped: true });
  }

  // Connect and stop using unified API
  const sandbox = await connectSandbox(sessionRecord.sandboxState);
  await sandbox.stop();

  const dbTeardownMetadata = extractDbTeardownMetadata(sessionRecord);
  if (dbTeardownMetadata) {
    const providerType = toProviderType(sessionRecord.sandboxState?.type);
    const provisioner = await getDbProvisioner(providerType);
    if (provisioner) {
      try {
        await provisioner.teardown(dbTeardownMetadata);
      } catch (error) {
        console.error(`DB teardown failed for session ${sessionId}:`, error);
        // Best-effort teardown should not block sandbox termination.
      }
    }
  }

  const clearedState = clearSandboxState(sessionRecord.sandboxState);
  await updateSession(sessionId, {
    sandboxState: clearedState,
    snapshotUrl: null,
    snapshotCreatedAt: null,
    lifecycleState:
      hasResumableSandboxState(clearedState) || !!sessionRecord.snapshotUrl
        ? "hibernated"
        : "provisioning",
    sandboxExpiresAt: null,
    hibernateAfter: null,
    lifecycleRunId: null,
    lifecycleError: null,
  });

  return Response.json({ success: true });
}
