import { describe, expect, test } from "bun:test";
import {
  checkAccountPromotable,
  type GitHubAccountCandidate,
  type InstallationRecord,
  planInstallationPromotion,
} from "@/lib/org/github-account-plan";

function account(
  overrides: Partial<GitHubAccountCandidate> = {},
): GitHubAccountCandidate {
  return {
    accountId: 4242,
    accountLogin: "next-degree",
    accountType: "Organization",
    ...overrides,
  };
}

function record(
  overrides: Partial<InstallationRecord> = {},
): InstallationRecord {
  return {
    id: "rec-1",
    userId: "u1",
    installationId: 100,
    organizationId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("checkAccountPromotable", () => {
  test("accepts an organization account with a numeric id", () => {
    expect(checkAccountPromotable(account())).toEqual({ ok: true });
  });

  test("refuses a personal user account", () => {
    expect(checkAccountPromotable(account({ accountType: "User" }))).toEqual({
      ok: false,
      reason: "personal-account",
    });
  });

  test("refuses an account with no usable numeric id", () => {
    expect(checkAccountPromotable(account({ accountId: 0 }))).toEqual({
      ok: false,
      reason: "missing-account-id",
    });
  });
});

describe("planInstallationPromotion", () => {
  test("collapses duplicate records to one, keeping the earliest", () => {
    const plan = planInstallationPromotion([
      record({
        id: "b",
        userId: "u2",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      }),
      record({
        id: "a",
        userId: "u1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      record({
        id: "c",
        userId: "u3",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      }),
    ]);

    expect(plan).toHaveLength(1);
    expect(plan[0]?.keepId).toBe("a");
    expect(plan[0]?.provenanceUserId).toBe("u1");
    expect(plan[0]?.deleteIds.sort()).toEqual(["b", "c"]);
    expect(plan[0]?.needsOwnershipWrite).toBe(true);
  });

  test("groups independently per installation", () => {
    const plan = planInstallationPromotion([
      record({ id: "a", installationId: 100 }),
      record({ id: "b", installationId: 100, userId: "u2" }),
      record({ id: "c", installationId: 200, userId: "u3" }),
    ]);

    expect(plan.map((entry) => entry.installationId)).toEqual([100, 200]);
    expect(plan[0]?.deleteIds).toEqual(["b"]);
    expect(plan[1]?.deleteIds).toEqual([]);
  });

  test("re-running against an already-promoted record changes nothing", () => {
    const promoted = record({
      id: "a",
      organizationId: "org-1",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const plan = planInstallationPromotion([promoted]);

    expect(plan[0]?.keepId).toBe("a");
    expect(plan[0]?.deleteIds).toEqual([]);
    expect(plan[0]?.needsOwnershipWrite).toBe(false);
  });

  test("an already-owned record survives even when a personal row is older", () => {
    const plan = planInstallationPromotion([
      record({
        id: "older-personal",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      }),
      record({
        id: "owned",
        organizationId: "org-1",
        userId: "u9",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);

    expect(plan[0]?.keepId).toBe("owned");
    expect(plan[0]?.provenanceUserId).toBe("u9");
    expect(plan[0]?.deleteIds).toEqual(["older-personal"]);
    expect(plan[0]?.needsOwnershipWrite).toBe(false);
  });

  test("breaks timestamp ties deterministically on record id", () => {
    const sameInstant = new Date("2026-01-01T00:00:00Z");
    const forward = planInstallationPromotion([
      record({ id: "b", createdAt: sameInstant }),
      record({ id: "a", createdAt: sameInstant, userId: "u2" }),
    ]);
    const reversed = planInstallationPromotion([
      record({ id: "a", createdAt: sameInstant, userId: "u2" }),
      record({ id: "b", createdAt: sameInstant }),
    ]);

    expect(forward[0]?.keepId).toBe("a");
    expect(reversed[0]?.keepId).toBe("a");
  });

  test("plans nothing when there are no records", () => {
    expect(planInstallationPromotion([])).toEqual([]);
  });
});
