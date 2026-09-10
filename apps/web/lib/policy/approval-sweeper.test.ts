import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PolicyEventInput } from "@/lib/policy/policy-events";

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-03T12:00:00Z");

let environment = "production";
let expiringRows: Row[] = [];
let updateSets: Row[] = [];
let policyEventBatches: PolicyEventInput[][] = [];

mock.module("@/lib/config/deployment", () => ({
  getDeploymentConfig: () => ({ environment }),
  isProductionDeployment: () => environment === "production",
}));

mock.module("@/lib/policy/policy-events", () => ({
  recordPolicyEvents: (inputs: PolicyEventInput[]) => {
    policyEventBatches.push(inputs);
    return Promise.resolve();
  },
}));

mock.module("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (values: Row) => ({
        where: () => ({
          returning: () => {
            updateSets.push(values);
            return Promise.resolve(expiringRows);
          },
        }),
      }),
    }),
  },
}));

const modulePromise = import("@/lib/policy/approval-sweeper");

function pendingRow(overrides: Row = {}): Row {
  return {
    id: "approval-1",
    sessionId: "session-1",
    workflowRunId: "run-1",
    toolName: "bash",
    inputSummary: { command: "git push origin main" },
    decision: "expired",
    expiresAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  environment = "production";
  expiringRows = [pendingRow()];
  updateSets = [];
  policyEventBatches = [];
});

describe("sweepExpiredApprovals outside production", () => {
  /**
   * Preview databases are Neon forks of production, so a cron that writes in
   * preview writes against forked rows pointing at real resources. The timeout
   * itself still holds everywhere, because expiry is computed on read.
   */
  test("returns immediately and writes nothing in preview", async () => {
    environment = "preview";
    const { sweepExpiredApprovals } = await modulePromise;

    const result = await sweepExpiredApprovals(NOW);

    expect(result.skipped).toBe(true);
    expect(result.expired).toBe(0);
    expect(updateSets).toEqual([]);
    expect(policyEventBatches).toEqual([]);
  });

  test("returns immediately and writes nothing in development", async () => {
    environment = "development";
    const { sweepExpiredApprovals } = await modulePromise;

    const result = await sweepExpiredApprovals(NOW);

    expect(result.skipped).toBe(true);
    expect(updateSets).toEqual([]);
  });

  test("reports that it was skipped, rather than reporting success", async () => {
    environment = "preview";
    const { sweepExpiredApprovals } = await modulePromise;

    const result = await sweepExpiredApprovals(NOW);

    expect(result.reason).toContain("production");
  });
});

describe("sweepExpiredApprovals in production", () => {
  test("materializes pending approvals past their expiry as expired", async () => {
    const { sweepExpiredApprovals } = await modulePromise;

    const result = await sweepExpiredApprovals(NOW);

    expect(result.skipped).toBe(false);
    expect(result.expired).toBe(1);
    expect(updateSets[0]).toMatchObject({ decision: "expired" });
  });

  test("records one policy event per approval it expired", async () => {
    expiringRows = [
      pendingRow({ id: "a1" }),
      pendingRow({ id: "a2", sessionId: "session-2", toolName: null }),
    ];
    const { sweepExpiredApprovals } = await modulePromise;

    await sweepExpiredApprovals(NOW);

    expect(policyEventBatches).toHaveLength(1);
    expect(policyEventBatches[0]).toHaveLength(2);
    expect(policyEventBatches[0]?.[0]).toMatchObject({
      sessionId: "session-1",
      workflowRunId: "run-1",
      toolName: "bash",
      decision: "expired",
    });
  });

  test("writes no events when nothing had expired", async () => {
    expiringRows = [];
    const { sweepExpiredApprovals } = await modulePromise;

    const result = await sweepExpiredApprovals(NOW);

    expect(result.expired).toBe(0);
    expect(policyEventBatches).toEqual([]);
  });

  test("only ever moves rows to expired — it never approves or denies", async () => {
    const { sweepExpiredApprovals } = await modulePromise;

    await sweepExpiredApprovals(NOW);

    for (const values of updateSets) {
      expect(values.decision).toBe("expired");
      expect(values.decidedBy).toBeUndefined();
      expect(values.consumedAt).toBeUndefined();
    }
  });
});
