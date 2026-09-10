import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApprovalRequestCard,
  describeApprovalRequest,
} from "./approval-request-card";
import type {
  AppSideEffectApprovalControls,
  AppSideEffectApprovalState,
} from "./hooks/use-app-side-effect-approval";

/**
 * What the approval prompt has to say. The requirement is about the text: the
 * tool, the exact operation, the rule that matched, and the posture that caused
 * the pause — and, because the sandbox may be rebuilt before the operation
 * runs, no promise that in-sandbox state survived.
 */
const pending = {
  approvalId: "approval-1",
  tool: "app.git-automation",
  operation: "Commit and push this session's changes to acme/repo.",
  rule: "app.side-effect.git-push",
  posture: "strict",
  status: "pending" as const,
};

describe("describeApprovalRequest", () => {
  test("names the tool, the operation, the rule and the posture", () => {
    const described = describeApprovalRequest(pending);

    expect(described.tool).toBe("app.git-automation");
    expect(described.operation).toBe(
      "Commit and push this session's changes to acme/repo.",
    );
    expect(described.rule).toBe("app.side-effect.git-push");
    expect(described.posture).toBe("strict");
    expect(described.title.toLowerCase()).toContain("approval");
  });

  test("offers the decision only while the request is pending", () => {
    expect(describeApprovalRequest(pending).awaitingDecision).toBe(true);
    expect(
      describeApprovalRequest({ ...pending, status: "executed" })
        .awaitingDecision,
    ).toBe(false);
    expect(
      describeApprovalRequest({ ...pending, status: "skipped" })
        .awaitingDecision,
    ).toBe(false);
  });

  test("warns that the workspace may be rebuilt before the operation runs", () => {
    expect(describeApprovalRequest(pending).resumeNote.toLowerCase()).toContain(
      "rebuilt",
    );
  });

  test("says plainly when the operation was skipped by policy", () => {
    const described = describeApprovalRequest({
      ...pending,
      status: "skipped",
      detail: "Skipped by policy: the pending approval was not granted.",
    });

    expect(described.title.toLowerCase()).toContain("skipped");
    expect(described.detail).toContain("Skipped by policy");
  });

  test("says when the operation ran", () => {
    const described = describeApprovalRequest({
      ...pending,
      status: "executed",
      detail: "Committed and pushed.",
    });

    expect(described.title.toLowerCase()).toContain("approved");
    expect(described.detail).toBe("Committed and pushed.");
  });

  test("reports an expiry as a timeout rather than a fresh prompt", () => {
    const described = describeApprovalRequest({
      ...pending,
      status: "expired",
    });

    expect(described.title.toLowerCase()).toContain("timed out");
    expect(described.awaitingDecision).toBe(false);
  });

  test("reports a failure to record the approval as an error", () => {
    const described = describeApprovalRequest({
      ...pending,
      approvalId: "",
      status: "error",
      detail: "The approval could not be recorded.",
    });

    expect(described.tone).toBe("error");
    expect(described.awaitingDecision).toBe(false);
  });
});

/**
 * Once an answer given in this view has been acted on, the card reports the
 * outcome from the same status-to-copy map a reloaded transcript uses — the
 * hook carries a status, not a title, so the wording exists in one place.
 */
describe("ApprovalRequestCard once the answer has been acted on", () => {
  function controls(
    state: AppSideEffectApprovalState,
  ): AppSideEffectApprovalControls {
    return {
      stateFor: () => state,
      approve: () => undefined,
      deny: () => undefined,
    };
  }

  test("reports a performed operation with the executed copy and tone", () => {
    const html = renderToStaticMarkup(
      <ApprovalRequestCard
        data={pending}
        approvals={controls({
          phase: "resolved",
          status: "executed",
          detail: "Committed and pushed.",
        })}
      />,
    );

    expect(html).toContain(
      describeApprovalRequest({
        ...pending,
        status: "executed",
      }).title,
    );
    expect(html).toContain("Committed and pushed.");
    expect(html).toContain("border-emerald-500/30");
    // The decision has been made; it must not be offered again.
    expect(html).not.toContain("rebuilt");
  });

  test("reports a policy skip with the skipped copy", () => {
    const html = renderToStaticMarkup(
      <ApprovalRequestCard
        data={pending}
        approvals={controls({ phase: "resolved", status: "skipped" })}
      />,
    );

    expect(html).toContain(
      describeApprovalRequest({
        ...pending,
        status: "skipped",
      }).title,
    );
  });

  test("still offers the decision while the answer is in flight", () => {
    const html = renderToStaticMarkup(
      <ApprovalRequestCard
        data={pending}
        approvals={controls({ phase: "deciding" })}
      />,
    );

    expect(html).toContain("Recording");
  });
});
