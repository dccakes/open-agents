import { beforeEach, describe, expect, mock, test } from "bun:test";

let userRows: Array<{ id: string; emailVerified: boolean }> = [
  { id: "u1", emailVerified: true },
];
let approved = true;
let mappedLink: { userId: string } | undefined;
let organizationId: string | null = "org-1";

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => userRows }),
      }),
    }),
  },
}));

mock.module("@/lib/org/membership", () => ({
  isApprovedMember: async () => approved,
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => organizationId,
}));

mock.module("@/lib/db/linear-actor-links", () => ({
  getLinearActorLink: async () => mappedLink,
}));

const modulePromise = import("@/lib/linear/resolve-actor");

beforeEach(() => {
  userRows = [{ id: "u1", emailVerified: true }];
  approved = true;
  mappedLink = undefined;
  organizationId = "org-1";
});

describe("resolveApprovedLinearActor", () => {
  test("resolves an approved member by verified email", async () => {
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor("grace@nextdegree.org")).toEqual({
      ok: true,
      userId: "u1",
      via: "verified-email",
    });
  });

  // The webhook has no cookie, so the session chokepoint never sees it. This
  // is the only thing standing between a pending user's Linear delegation and
  // an agent run created in their name.
  test("refuses a matched user who holds no membership row", async () => {
    approved = false;
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor("stranger@example.com")).toEqual({
      ok: false,
      reason: "pending",
      userId: "u1",
    });
  });

  test("refuses an address that matches no user", async () => {
    userRows = [];
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor("nobody@example.com")).toEqual({
      ok: false,
      reason: "not-connected",
    });
  });

  test("refuses a payload with no actor identity", async () => {
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor(undefined)).toEqual({
      ok: false,
      reason: "no-identity",
    });
  });

  // An unverified address is an unproven claim about who someone is, and the
  // webhook carries nothing else to check it against.
  test("refuses a match on an unverified address", async () => {
    userRows = [{ id: "u1", emailVerified: false }];
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor("spoofed@nextdegree.org")).toEqual({
      ok: false,
      reason: "unverified-email",
      userId: "u1",
    });
  });

  test("resolves an explicitly mapped Linear identity whose address matches nobody", async () => {
    userRows = [];
    mappedLink = { userId: "u7" };
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(
      await resolveApprovedLinearActor("contractor@elsewhere.com", "lin_1"),
    ).toEqual({ ok: true, userId: "u7", via: "mapping" });
  });

  test("the mapping wins over a conflicting email match", async () => {
    mappedLink = { userId: "u7" };
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(
      await resolveApprovedLinearActor("grace@nextdegree.org", "lin_1"),
    ).toEqual({ ok: true, userId: "u7", via: "mapping" });
  });

  test("a mapped user removed from the organization starts no run", async () => {
    approved = false;
    mappedLink = { userId: "u7" };
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(
      await resolveApprovedLinearActor("grace@nextdegree.org", "lin_1"),
    ).toEqual({ ok: false, reason: "pending", userId: "u7" });
  });

  test("refuses an actor with a Linear id but no mapping and no email", async () => {
    userRows = [];
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor(undefined, "lin_unknown")).toEqual({
      ok: false,
      reason: "not-connected",
    });
  });
});
