import type {
  DynamicToolUIPart,
  FinishReason,
  InferUITools,
  LanguageModelUsage,
  ToolUIPart,
  UIMessage,
} from "ai";
import type { webAgent } from "./config";

export type WebAgent = typeof webAgent;
export type WebAgentCallOptions = Parameters<
  WebAgent["generate"]
>["0"]["options"];

export type WebAgentStepFinishMetadata = {
  finishReason: FinishReason;
  rawFinishReason?: string;
};

export type WebAgentMessageMetadata = {
  selectedModelId?: string;
  modelId?: string;
  lastStepUsage?: LanguageModelUsage;
  totalMessageUsage?: LanguageModelUsage;
  /** Gateway-reported cost of the most recent step, in USD. */
  lastStepCost?: number;
  /** Cumulative gateway-reported cost across every step of the message, in USD. */
  totalMessageCost?: number;
  lastStepFinishReason?: FinishReason;
  lastStepRawFinishReason?: string;
  stepFinishReasons?: WebAgentStepFinishMetadata[];
};

export type WebAgentGitDataStatus = "pending" | "success" | "error" | "skipped";

export type WebAgentCommitData = {
  status: WebAgentGitDataStatus;
  committed?: boolean;
  pushed?: boolean;
  commitMessage?: string;
  commitSha?: string;
  url?: string;
  error?: string;
  /** Why nothing was committed — including a policy refusal. */
  skipReason?: string;
};

export type WebAgentPrData = {
  status: WebAgentGitDataStatus;
  created?: boolean;
  syncedExisting?: boolean;
  prNumber?: number;
  url?: string;
  error?: string;
  skipReason?: string;
  requiresManualCreation?: boolean;
};

export type WebAgentSnippetData = {
  content: string;
  filename: string;
};

export type WebAgentWorkspaceStatusData = {
  status: "setting-up";
  message: string;
};

/** Which ceiling stopped the run. Mirrors `BudgetKind` in `lib/budget/`. */
export type WebAgentBudgetKind =
  | "run-tokens"
  | "run-steps"
  | "org-daily-tokens";

/**
 * Only the figures. The card composes its own title, detail and day-boundary
 * note from them, so a prose `message` sent alongside would be a third copy of
 * a sentence the run record already carries as its halt reason.
 */
export type WebAgentBudgetHaltData = {
  budget: WebAgentBudgetKind;
  limit: number;
  used: number;
};

/**
 * Where a run's application-level side effect stands.
 *
 * `pending` is a state the *run* carries rather than a tool part, because the
 * agent loop has already finished by the time auto-commit is gated — there is
 * no tool call to attach an approval to.
 */
export type WebAgentApprovalStatus =
  | "pending"
  | "executed"
  | "skipped"
  | "expired"
  | "error";

export type WebAgentApprovalRequestData = {
  approvalId: string;
  /** What is being gated — a tool name, or the application operation. */
  tool: string;
  /** The exact operation, in words. */
  operation: string;
  /** The policy rule that matched. */
  rule: string;
  /** The posture that caused the pause. */
  posture: string;
  status: WebAgentApprovalStatus;
  /** Why it paused, and once answered, what happened. */
  detail?: string;
};

export type WebAgentDataParts = {
  commit: WebAgentCommitData;
  pr: WebAgentPrData;
  snippet: WebAgentSnippetData;
  "workspace-status": WebAgentWorkspaceStatusData;
  "budget-halt": WebAgentBudgetHaltData;
  "approval-request": WebAgentApprovalRequestData;
};

// All types derived from the agent
export type WebAgentTools = WebAgent["tools"];
export type WebAgentUITools = InferUITools<WebAgentTools>;
export type WebAgentUIMessage = UIMessage<
  WebAgentMessageMetadata,
  WebAgentDataParts,
  WebAgentUITools
>;
export type WebAgentUIMessagePart = WebAgentUIMessage["parts"][number];
export type WebAgentCommitDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-commit" }
>;
export type WebAgentPrDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-pr" }
>;
export type WebAgentSnippetDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-snippet" }
>;
export type WebAgentBudgetHaltDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-budget-halt" }
>;
export type WebAgentApprovalRequestDataPart = Extract<
  WebAgentUIMessagePart,
  { type: "data-approval-request" }
>;
export type WebAgentUIToolPart =
  | DynamicToolUIPart
  | ToolUIPart<WebAgentUITools>;
