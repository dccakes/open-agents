import { describe, expect, test } from "bun:test";
import type { WebAgentUIMessage } from "@/app/types";
import { applyAppSideEffectOutcome } from "@/lib/chat/app-side-effect-parts";

function messageWithPendingApproval(): WebAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "Done." },
      {
        type: "data-approval-request",
        id: "assistant-1:approval",
        data: {
          approvalId: "approval-1",
          tool: "app.git-automation",
          operation: "Commit and push this session's changes to acme/repo.",
          rule: "app.side-effect.git-push",
          posture: "strict",
          status: "pending",
        },
      },
    ],
  };
}

describe("applyAppSideEffectOutcome", () => {
  test("resolves the pending approval part in place", () => {
    const updated = applyAppSideEffectOutcome(messageWithPendingApproval(), {
      approvalId: "approval-1",
      status: "executed",
      detail: "Committed and pushed.",
    });

    const approvalParts = updated.parts.filter(
      (part) => part.type === "data-approval-request",
    );
    expect(approvalParts).toHaveLength(1);
    expect(approvalParts[0]).toMatchObject({
      data: { status: "executed", detail: "Committed and pushed." },
    });
  });

  test("keeps everything the run already said", () => {
    const updated = applyAppSideEffectOutcome(messageWithPendingApproval(), {
      approvalId: "approval-1",
      status: "executed",
    });

    expect(updated.parts[0]).toEqual({ type: "text", text: "Done." });
    expect(updated.id).toBe("assistant-1");
  });

  test("appends the commit and pull-request results the execution produced", () => {
    const updated = applyAppSideEffectOutcome(messageWithPendingApproval(), {
      approvalId: "approval-1",
      status: "executed",
      commit: { status: "success", committed: true, pushed: true },
      pr: { status: "success", created: true, prNumber: 7 },
    });

    expect(
      updated.parts.find((part) => part.type === "data-commit"),
    ).toMatchObject({
      id: "assistant-1:commit",
      data: { status: "success", committed: true, pushed: true },
    });
    expect(updated.parts.find((part) => part.type === "data-pr")).toMatchObject(
      {
        id: "assistant-1:pr",
        data: { status: "success", prNumber: 7 },
      },
    );
  });

  test("reports a refusal on the run as skipped by policy", () => {
    const updated = applyAppSideEffectOutcome(messageWithPendingApproval(), {
      approvalId: "approval-1",
      status: "skipped",
      detail: "Skipped by policy: the pending approval was not granted.",
      commit: {
        status: "skipped",
        committed: false,
        pushed: false,
        skipReason: "Skipped by policy: the pending approval was not granted.",
      },
    });

    expect(
      updated.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "skipped" } });
    expect(
      updated.parts.find((part) => part.type === "data-commit"),
    ).toMatchObject({
      data: { status: "skipped", committed: false, pushed: false },
    });
  });

  test("leaves an approval part belonging to a different approval alone", () => {
    const updated = applyAppSideEffectOutcome(messageWithPendingApproval(), {
      approvalId: "somebody-elses-approval",
      status: "executed",
    });

    expect(
      updated.parts.find((part) => part.type === "data-approval-request"),
    ).toMatchObject({ data: { status: "pending" } });
  });

  test("replaces an existing commit part rather than adding a second", () => {
    const message = messageWithPendingApproval();
    message.parts.push({
      type: "data-commit",
      id: "assistant-1:commit",
      data: { status: "pending" },
    });

    const updated = applyAppSideEffectOutcome(message, {
      approvalId: "approval-1",
      status: "executed",
      commit: { status: "success", committed: true, pushed: true },
    });

    expect(
      updated.parts.filter((part) => part.type === "data-commit"),
    ).toHaveLength(1);
  });
});
