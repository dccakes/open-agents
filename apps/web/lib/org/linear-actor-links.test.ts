import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

let permitted = true;
let organizationId: string | null = "org-1";
let targetIsMember = true;

const upserts: Record<string, unknown>[] = [];
const deletes: string[] = [];

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () =>
    Promise.resolve({
      userId: "user-admin",
      organizationId: organizationId ?? "org-1",
      role: "admin",
    }),
  requirePermission: () => {
    if (!permitted) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve();
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => organizationId,
}));

mock.module("@/lib/org/membership", () => ({
  isApprovedMember: async () => targetIsMember,
}));

mock.module("@/lib/db/linear-actor-links", () => ({
  listLinearActorLinks: async () => [],
  upsertLinearActorLink: async (p: Record<string, unknown>) => {
    upserts.push(p);
    return { id: "link-1", ...p };
  },
  deleteLinearActorLink: async (_org: string, linearUserId: string) => {
    deletes.push(linearUserId);
    return true;
  },
}));

const modulePromise = import("@/lib/org/linear-actor-links");

beforeEach(() => {
  permitted = true;
  organizationId = "org-1";
  targetIsMember = true;
  upserts.length = 0;
  deletes.length = 0;
});

describe("linkLinearActor", () => {
  test("refuses a caller without integration.connect and writes nothing", async () => {
    permitted = false;
    const { linkLinearActor } = await modulePromise;

    await expect(
      linkLinearActor({ linearUserId: "lin_1", userId: "u1" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(upserts).toEqual([]);
  });

  test("records a mapping for an approved member", async () => {
    const { linkLinearActor } = await modulePromise;

    await linkLinearActor({ linearUserId: "lin_1", userId: "u1" });

    expect(upserts[0]).toMatchObject({
      organizationId: "org-1",
      linearUserId: "lin_1",
      userId: "u1",
      createdByUserId: "user-admin",
    });
  });

  // A mapping to a pending user would be a way to hand out access from a
  // screen that is not the membership screen.
  test("refuses to map a user who is not an approved member", async () => {
    targetIsMember = false;
    const { linkLinearActor } = await modulePromise;

    await expect(
      linkLinearActor({ linearUserId: "lin_1", userId: "pending-user" }),
    ).rejects.toMatchObject({ name: "OrgSettingsError", kind: "invalid" });
    expect(upserts).toEqual([]);
  });

  test("refuses empty input", async () => {
    const { linkLinearActor } = await modulePromise;

    await expect(
      linkLinearActor({ linearUserId: "   ", userId: "u1" }),
    ).rejects.toMatchObject({ name: "OrgSettingsError", kind: "invalid" });
    expect(upserts).toEqual([]);
  });
});

describe("unlinkLinearActor", () => {
  test("refuses a caller without integration.connect", async () => {
    permitted = false;
    const { unlinkLinearActor } = await modulePromise;

    await expect(unlinkLinearActor("lin_1")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(deletes).toEqual([]);
  });

  test("removes a mapping for a permitted caller", async () => {
    const { unlinkLinearActor } = await modulePromise;

    expect(await unlinkLinearActor("lin_1")).toBe(true);
    expect(deletes).toEqual(["lin_1"]);
  });
});

describe("readLinearActorLinks", () => {
  test("is open to an approved member without integration.connect", async () => {
    permitted = false;
    const { readLinearActorLinks } = await modulePromise;

    await expect(readLinearActorLinks()).resolves.toEqual([]);
  });
});
