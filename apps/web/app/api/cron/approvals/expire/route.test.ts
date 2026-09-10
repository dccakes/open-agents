import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

let permitted = true;
let environment = "production";
let sweepCalls = 0;

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () => {
    if (!permitted) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve({
      userId: "user-1",
      organizationId: "org-1",
      role: "admin",
    });
  },
  requirePermission: () => {
    if (!permitted) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve();
  },
}));

mock.module("@/lib/policy/approval-sweeper", () => ({
  sweepExpiredApprovals: () => {
    sweepCalls += 1;
    if (environment !== "production") {
      return Promise.resolve({
        skipped: true,
        reason: "only writes on a production deployment",
        expired: 0,
      });
    }
    return Promise.resolve({ skipped: false, expired: 2 });
  },
}));

const routeModulePromise = import("./route");

beforeEach(() => {
  permitted = true;
  environment = "production";
  sweepCalls = 0;
});

describe("POST /api/cron/approvals/expire", () => {
  test("reports how many approvals it expired in production", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST();
    const body = (await response.json()) as {
      skipped: boolean;
      expired: number;
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({ skipped: false, expired: 2 });
  });

  test("reports that it was skipped outside production", async () => {
    environment = "preview";
    const { POST } = await routeModulePromise;

    const body = (await (await POST()).json()) as {
      skipped: boolean;
      expired: number;
      reason: string;
    };

    expect(body.skipped).toBe(true);
    expect(body.expired).toBe(0);
    expect(body.reason).toContain("production");
  });

  test("refuses a caller without the permission, before sweeping", async () => {
    permitted = false;
    const { POST } = await routeModulePromise;

    const response = await POST();

    expect(response.status).toBe(403);
    expect(sweepCalls).toBe(0);
  });
});
