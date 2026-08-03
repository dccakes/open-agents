import { beforeEach, describe, expect, mock, test } from "bun:test";
import { orgMembers } from "@/lib/db/schema";

type MemberRow = { id: string; userId: string; role: string };
type UserRow = { id: string; role: string };

let members: MemberRow[] = [];
let platformUsers: UserRow[] = [];

/**
 * There is no live database in this environment, so the query builder is
 * mocked at the module boundary. Each `select` chain resolves to whichever
 * fixture matches the table the query names.
 */
mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          table === orgMembers
            ? Promise.resolve(members.map((row) => ({ ...row })))
            : Promise.resolve(platformUsers.map((row) => ({ ...row }))),
      }),
    }),
  },
}));

const modulePromise = import("@/lib/org/admin-invariants");

describe("ensureNotLastOrganizationAdmin", () => {
  beforeEach(() => {
    members = [];
    platformUsers = [];
  });

  test("refuses to demote the only remaining admin", async () => {
    members = [{ id: "m1", userId: "u1", role: "owner" }];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "m1",
        nextRole: "member",
      }),
    ).rejects.toThrow(/last/i);
  });

  test("refuses to remove the only remaining admin", async () => {
    members = [
      { id: "m1", userId: "u1", role: "admin" },
      { id: "m2", userId: "u2", role: "member" },
    ];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "m1",
      }),
    ).rejects.toThrow(/last/i);
  });

  test("allows demotion while another admin remains", async () => {
    members = [
      { id: "m1", userId: "u1", role: "owner" },
      { id: "m2", userId: "u2", role: "admin" },
    ];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "m1",
        nextRole: "member",
      }),
    ).resolves.toBeUndefined();
  });

  test("allows removing a plain member", async () => {
    members = [
      { id: "m1", userId: "u1", role: "owner" },
      { id: "m2", userId: "u2", role: "member" },
    ];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "m2",
      }),
    ).resolves.toBeUndefined();
  });

  test("allows a role change that keeps the member an admin", async () => {
    members = [{ id: "m1", userId: "u1", role: "owner" }];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "m1",
        nextRole: "admin",
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses to ban the last admin, identified by user id", async () => {
    members = [
      { id: "m1", userId: "u1", role: "owner" },
      { id: "m2", userId: "u2", role: "member" },
    ];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        userId: "u1",
      }),
    ).rejects.toThrow(/last/i);
  });

  test("allows banning a non-admin, identified by user id", async () => {
    members = [
      { id: "m1", userId: "u1", role: "owner" },
      { id: "m2", userId: "u2", role: "member" },
    ];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        userId: "u2",
      }),
    ).resolves.toBeUndefined();
  });

  test("is a no-op for a member id that no longer exists", async () => {
    members = [{ id: "m1", userId: "u1", role: "owner" }];
    const { ensureNotLastOrganizationAdmin } = await modulePromise;

    expect(
      ensureNotLastOrganizationAdmin({
        organizationId: "org-1",
        memberId: "gone",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("ensureNotLastPlatformAdmin", () => {
  beforeEach(() => {
    members = [];
    platformUsers = [];
  });

  test("refuses to demote the only platform admin", async () => {
    platformUsers = [{ id: "u1", role: "admin" }];
    const { ensureNotLastPlatformAdmin } = await modulePromise;

    expect(ensureNotLastPlatformAdmin({ userId: "u1" })).rejects.toThrow(
      /last/i,
    );
  });

  test("allows demotion while another platform admin remains", async () => {
    platformUsers = [
      { id: "u1", role: "admin" },
      { id: "u2", role: "admin" },
    ];
    const { ensureNotLastPlatformAdmin } = await modulePromise;

    expect(
      ensureNotLastPlatformAdmin({ userId: "u1" }),
    ).resolves.toBeUndefined();
  });

  test("allows demoting a user who is not a platform admin", async () => {
    platformUsers = [{ id: "u1", role: "admin" }];
    const { ensureNotLastPlatformAdmin } = await modulePromise;

    expect(
      ensureNotLastPlatformAdmin({ userId: "u2" }),
    ).resolves.toBeUndefined();
  });

  test("keeps the platform admin role when it is being granted", async () => {
    platformUsers = [{ id: "u1", role: "admin" }];
    const { ensureNotLastPlatformAdmin } = await modulePromise;

    expect(
      ensureNotLastPlatformAdmin({ userId: "u1", nextRole: "admin" }),
    ).resolves.toBeUndefined();
  });
});
