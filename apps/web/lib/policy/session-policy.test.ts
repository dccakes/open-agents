import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PolicyEventInput } from "@/lib/policy/policy-events";

let sessionRow: { id: string; userId: string; posture: string } | null = null;
let policyEventCalls: PolicyEventInput[] = [];

mock.module("@/lib/db/sessions", () => ({
  getSessionById: () => Promise.resolve(sessionRow),
}));

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvent: (input: PolicyEventInput) => {
    policyEventCalls.push(input);
    return Promise.resolve();
  },
}));

const modulePromise = import("@/lib/policy/session-policy");

beforeEach(() => {
  sessionRow = { id: "session-1", userId: "user-1", posture: "auto" };
  policyEventCalls = [];
});

describe("resolveSessionPolicy", () => {
  test("returns the session's posture and the baseline profile", async () => {
    sessionRow = { id: "session-1", userId: "user-1", posture: "strict" };
    const { resolveSessionPolicy } = await modulePromise;

    const resolution = await resolveSessionPolicy({ sessionId: "session-1" });

    expect(resolution).toMatchObject({
      sessionId: "session-1",
      posture: "strict",
      profile: "default",
      postureDowngraded: false,
    });
  });

  test("defaults to auto for a session that predates the column", async () => {
    sessionRow = { id: "session-1", userId: "user-1", posture: "" };
    const { resolveSessionPolicy } = await modulePromise;

    expect(
      (await resolveSessionPolicy({ sessionId: "session-1" })).posture,
    ).toBe("auto");
  });

  test("assumes an interactive trigger when none is named", async () => {
    sessionRow = { id: "session-1", userId: "user-1", posture: "dangerous" };
    const { resolveSessionPolicy } = await modulePromise;

    expect(
      (await resolveSessionPolicy({ sessionId: "session-1" })).posture,
    ).toBe("dangerous");
  });

  /**
   * The WS-1.3 constraint, enforced at resolution so it holds for any future
   * non-interactive trigger rather than only for webhooks.
   */
  test("refuses dangerous for a non-interactive trigger and falls back to auto", async () => {
    sessionRow = { id: "session-1", userId: "user-1", posture: "dangerous" };
    const { resolveSessionPolicy } = await modulePromise;

    const resolution = await resolveSessionPolicy({
      sessionId: "session-1",
      trigger: "webhook",
    });

    expect(resolution.posture).toBe("auto");
    expect(resolution.requestedPosture).toBe("dangerous");
    expect(resolution.postureDowngraded).toBe(true);
  });

  test("records the downgrade as a policy event", async () => {
    sessionRow = { id: "session-1", userId: "user-1", posture: "dangerous" };
    const { resolveSessionPolicy } = await modulePromise;

    await resolveSessionPolicy({
      sessionId: "session-1",
      trigger: "webhook",
      workflowRunId: "run-1",
    });

    expect(policyEventCalls).toHaveLength(1);
    expect(policyEventCalls[0]).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      decision: "downgraded",
      // The posture recorded is the one the run actually gets.
      posture: "auto",
    });
  });

  test("records nothing when there is nothing to downgrade", async () => {
    const { resolveSessionPolicy } = await modulePromise;

    await resolveSessionPolicy({ sessionId: "session-1", trigger: "webhook" });

    expect(policyEventCalls).toEqual([]);
  });

  test("carries the read-only profile through when one is requested", async () => {
    const { resolveSessionPolicy } = await modulePromise;

    const resolution = await resolveSessionPolicy({
      sessionId: "session-1",
      profile: "read-only",
    });

    expect(resolution.profile).toBe("read-only");
  });

  test("raises rather than guessing when the session does not exist", async () => {
    sessionRow = null;
    const { resolveSessionPolicy } = await modulePromise;

    await expect(
      resolveSessionPolicy({ sessionId: "gone" }),
    ).rejects.toMatchObject({ name: "ApprovalError", kind: "not-found" });
  });
});
