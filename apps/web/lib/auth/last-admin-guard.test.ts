import { beforeEach, describe, expect, mock, test } from "bun:test";

interface InvariantCall {
  kind: "platform" | "organization";
  input: Record<string, unknown>;
}

let calls: InvariantCall[] = [];
let platformError: Error | null = null;
let organizationError: Error | null = null;
let seededOrganizationId: string | null = "org-1";

mock.module("@/lib/org/admin-invariants", () => ({
  ensureNotLastPlatformAdmin: async (input: Record<string, unknown>) => {
    calls.push({ kind: "platform", input });
    if (platformError) {
      throw platformError;
    }
  },
  ensureNotLastOrganizationAdmin: async (input: Record<string, unknown>) => {
    calls.push({ kind: "organization", input });
    if (organizationError) {
      throw organizationError;
    }
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
}));

const modulePromise = import("@/lib/auth/last-admin-guard");

type Guard = (ctx: { path: string; body?: unknown }) => Promise<unknown>;

async function run(path: string, body?: unknown): Promise<void> {
  const { lastAdminGuard } = await modulePromise;
  await (lastAdminGuard as unknown as Guard)({ path, body });
}

beforeEach(() => {
  calls = [];
  platformError = null;
  organizationError = null;
  seededOrganizationId = "org-1";
});

describe("lastAdminGuard", () => {
  test("ignores unrelated endpoints", async () => {
    await run("/organization/list", { userId: "u1" });

    expect(calls).toEqual([]);
  });

  test("checks the platform invariant on a role change", async () => {
    await run("/admin/set-role", { userId: "u1", role: "user" });

    expect(calls).toEqual([
      { kind: "platform", input: { userId: "u1", nextRole: "user" } },
    ]);
  });

  test("normalizes an array of roles", async () => {
    await run("/admin/set-role", { userId: "u1", role: ["admin", "user"] });

    expect(calls[0]?.input).toEqual({ userId: "u1", nextRole: "admin,user" });
  });

  test("checks both invariants on a ban", async () => {
    await run("/admin/ban-user", { userId: "u1" });

    expect(calls).toEqual([
      { kind: "platform", input: { userId: "u1", nextRole: undefined } },
      {
        kind: "organization",
        input: { organizationId: "org-1", userId: "u1" },
      },
    ]);
  });

  test("checks both invariants on a user removal", async () => {
    await run("/admin/remove-user", { userId: "u1" });

    expect(calls.map((call) => call.kind)).toEqual([
      "platform",
      "organization",
    ]);
  });

  test("refuses banning the last platform admin", async () => {
    platformError = new Error("This is the last platform admin.");

    expect(run("/admin/ban-user", { userId: "u1" })).rejects.toThrow(
      /last platform admin/,
    );
  });

  test("refuses banning the last organization admin", async () => {
    organizationError = new Error("This is the last organization owner");

    expect(run("/admin/ban-user", { userId: "u1" })).rejects.toThrow(
      /last organization owner/,
    );
  });

  test("does nothing without a target user id", async () => {
    await run("/admin/ban-user", {});

    expect(calls).toEqual([]);
  });

  test("skips the organization check before seeding has run", async () => {
    seededOrganizationId = null;

    await run("/admin/ban-user", { userId: "u1" });

    expect(calls.map((call) => call.kind)).toEqual(["platform"]);
  });
});
