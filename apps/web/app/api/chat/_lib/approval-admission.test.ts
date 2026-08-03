import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Admitting — or refusing — the approval claims a resume request makes.
 *
 * The two things worth pinning are the two ways this can go wrong: it must
 * refuse a forged claim, and it must not break the approval flows that predate
 * approval records, which have no row to find and never will.
 */

const verifyCalls: unknown[] = [];
let refusals: Array<{
  toolCallId: string;
  toolName: string | null;
  code: string;
  message: string;
}> = [];

mock.module("@/lib/policy/approval-assertions", () => ({
  verifyAssertedApprovals: async (input: unknown) => {
    verifyCalls.push(input);
    return refusals;
  },
}));

const { checkApprovalAdmission, LEGACY_UNRECORDED_APPROVAL_TOOLS } =
  await import("./approval-admission");

function approvalPart(overrides: Record<string, unknown> = {}) {
  return {
    type: "tool-bash",
    toolCallId: "call-1",
    state: "approval-responded",
    approval: { approved: true },
    ...overrides,
  };
}

function claimedToolCallIds(): string[] {
  const input = verifyCalls.at(-1) as { messages?: unknown } | undefined;
  const messages = Array.isArray(input?.messages) ? input.messages : [];
  return messages.flatMap((message: unknown) => {
    const parts = (message as { parts?: unknown }).parts;
    return Array.isArray(parts)
      ? parts.map((part) => (part as { toolCallId: string }).toolCallId)
      : [];
  });
}

beforeEach(() => {
  verifyCalls.length = 0;
  refusals = [];
});

describe("what gets checked", () => {
  test("checks a claim that has not been executed yet", async () => {
    const result = await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [
        { role: "user", parts: [{ type: "text", text: "go" }] },
        { role: "assistant", parts: [approvalPart()] },
      ],
    });

    expect(result.ok).toBe(true);
    expect(claimedToolCallIds()).toEqual(["call-1"]);
  });

  test("ignores a claim whose tool call already produced output", async () => {
    await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          parts: [approvalPart({ state: "output-available" })],
        },
      ],
    });

    expect(verifyCalls).toHaveLength(0);
  });

  test("ignores approvals carried by earlier messages in the history", async () => {
    await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          parts: [approvalPart({ toolCallId: "old-call" })],
        },
        { role: "user", parts: [{ type: "text", text: "next" }] },
      ],
    });

    expect(verifyCalls).toHaveLength(0);
  });

  test("ignores a denial, which authorizes nothing", async () => {
    await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          parts: [approvalPart({ approval: { approved: false } })],
        },
      ],
    });

    expect(verifyCalls).toHaveLength(0);
  });
});

describe("legacy approval flows", () => {
  test("the exempt set is exactly the pre-record approval tools", () => {
    expect([...LEGACY_UNRECORDED_APPROVAL_TOOLS].sort()).toEqual([
      "ask_user_question",
      "web_fetch",
    ]);
  });

  for (const toolName of ["web_fetch", "ask_user_question"]) {
    test(`${toolName} is admitted without an approval record`, async () => {
      const result = await checkApprovalAdmission({
        sessionId: "session-1",
        messages: [
          {
            role: "assistant",
            parts: [approvalPart({ type: `tool-${toolName}` })],
          },
        ],
      });

      expect(result.ok).toBe(true);
      expect(verifyCalls).toHaveLength(0);
    });
  }

  test("a legacy claim alongside a policed one still checks the policed one", async () => {
    await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [
        {
          role: "assistant",
          parts: [
            approvalPart({ type: "tool-web_fetch", toolCallId: "call-fetch" }),
            approvalPart({ toolCallId: "call-bash" }),
          ],
        },
      ],
    });

    expect(claimedToolCallIds()).toEqual(["call-bash"]);
  });
});

describe("refusal", () => {
  test("an unbacked claim is refused with a structured 403", async () => {
    refusals = [
      {
        toolCallId: "call-1",
        toolName: "bash",
        code: "no_approval_record",
        message: "No approval was ever requested for this call.",
      },
    ];

    const result = await checkApprovalAdmission({
      sessionId: "session-1",
      messages: [{ role: "assistant", parts: [approvalPart()] }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected a refusal");
    }
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as {
      code: string;
      refusedApprovals: Array<{ toolCallId: string; code: string }>;
    };
    expect(body.code).toBe("approval_not_verified");
    expect(body.refusedApprovals).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        code: "no_approval_record",
      }),
    ]);
  });
});
