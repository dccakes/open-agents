import { beforeEach, describe, expect, mock, test } from "bun:test";

let userRows: Array<{ id: string }> = [{ id: "u1" }];
let approved = true;

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

const modulePromise = import("@/lib/linear/resolve-actor");

beforeEach(() => {
  userRows = [{ id: "u1" }];
  approved = true;
});

describe("resolveApprovedLinearActor", () => {
  test("resolves an approved member", async () => {
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor("grace@nextdegree.org")).toEqual({
      ok: true,
      userId: "u1",
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

  test("refuses a payload with no actor email", async () => {
    const { resolveApprovedLinearActor } = await modulePromise;

    expect(await resolveApprovedLinearActor(undefined)).toEqual({
      ok: false,
      reason: "no-email",
    });
  });
});
