import type { OpenAgentCallOptions } from "@open-agents/agent";
import { getRun, start } from "workflow/api";
import { runAgentWorkflow } from "@/app/workflows/chat";
import type { WebAgentUIMessage } from "@/app/types";
import { assistantFileLinkPrompt } from "@/lib/assistant-file-links";
import {
  claimChatActiveStreamId,
  createChatMessageIfNotExists,
  getChatsBySessionId,
  getSessionById,
  touchChat,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { getAllVariants } from "@/lib/model-variants";
import { APP_DEFAULT_MODEL_ID } from "@/lib/models";
import {
  createChatRuntime,
  resolveChatModelSelection,
  type SessionRecord,
} from "@/lib/chat/runtime-setup";

export type RemediationPackage = {
  prompt: string;
  snippets: Array<{ filename: string; content: string }>;
};

type ResolvedRemediationContext = {
  chatId: string;
  userId: string;
  selectedModelId: string;
  modelId: string;
  agentOptions: OpenAgentCallOptions;
};

export async function resolveChatAndModelForSession(
  sessionId: string,
): Promise<ResolvedRemediationContext> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (!session.sandboxState) {
    throw new Error(`Session sandbox is not active: ${sessionId}`);
  }

  const chats = await getChatsBySessionId(sessionId);
  const targetChat = chats[0];
  if (!targetChat) {
    throw new Error(`No chat found for session: ${sessionId}`);
  }

  const preferences = await getUserPreferences(session.userId).catch(
    () => null,
  );
  const modelVariants = getAllVariants(preferences?.modelVariants ?? []);
  const selectedModelId =
    targetChat.modelId ?? preferences?.defaultModelId ?? APP_DEFAULT_MODEL_ID;

  const modelSelection = resolveChatModelSelection({
    selectedModelId,
    modelVariants,
    missingVariantLabel: "Watcher model variant",
  });

  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Watcher subagent model variant",
      })
    : undefined;

  const { sandbox, skills } = await createChatRuntime({
    userId: session.userId,
    sessionId,
    sessionRecord: session as SessionRecord,
  });

  return {
    chatId: targetChat.id,
    userId: session.userId,
    selectedModelId,
    modelId: modelSelection.id,
    agentOptions: {
      sandbox: {
        state: session.sandboxState,
        workingDirectory: sandbox.workingDirectory,
        currentBranch: sandbox.currentBranch,
        environmentDetails: sandbox.environmentDetails,
      },
      model: modelSelection,
      ...(subagentModelSelection
        ? { subagentModel: subagentModelSelection }
        : {}),
      ...(skills.length > 0 ? { skills } : {}),
      customInstructions: assistantFileLinkPrompt,
    },
  };
}

export function buildRemediationMessage(
  pkg: RemediationPackage,
  messageId: string,
): WebAgentUIMessage {
  return {
    id: messageId,
    role: "user",
    parts: [
      { type: "text", text: pkg.prompt },
      ...pkg.snippets.map((snippet, index) => ({
        type: "data-snippet" as const,
        id: `${messageId}:snippet:${index + 1}`,
        data: {
          filename: snippet.filename,
          content: snippet.content,
        },
      })),
    ],
  };
}

export async function executeRemediation(params: {
  sessionId: string;
  remediationPackage: RemediationPackage;
  messageId?: string;
}): Promise<string> {
  const { sessionId, remediationPackage } = params;
  const messageId = params.messageId ?? crypto.randomUUID();
  const message = buildRemediationMessage(remediationPackage, messageId);

  const context = await resolveChatAndModelForSession(sessionId);

  const created = await createChatMessageIfNotExists({
    id: message.id,
    chatId: context.chatId,
    role: "user",
    parts: message,
  });

  if (created) {
    await touchChat(context.chatId);
  }

  const run = await start(runAgentWorkflow, [
    {
      messages: [message],
      chatId: context.chatId,
      sessionId,
      userId: context.userId,
      selectedModelId: context.selectedModelId,
      modelId: context.modelId,
      maxSteps: 500,
      agentOptions: context.agentOptions,
    },
  ]);

  const claimed = await claimChatActiveStreamId(context.chatId, run.runId);
  if (!claimed) {
    try {
      getRun(run.runId).cancel();
    } catch {
      // Best-effort cancellation.
    }

    throw new Error(
      `Failed to claim active stream for remediation run: ${run.runId}`,
    );
  }

  return run.runId;
}
