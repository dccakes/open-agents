import { beforeEach, describe, expect, mock, test } from "bun:test";

let rows: Record<string, unknown>[] = [];
let lastProjection: Record<string, unknown> | undefined;

mock.module("@/lib/db/client", () => ({
  db: {
    select: (projection: Record<string, unknown>) => {
      lastProjection = projection;
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      };
    },
  },
}));

const modulePromise = import("./users");

beforeEach(() => {
  rows = [];
  lastProjection = undefined;
});

describe("isUserAdmin", () => {
  test("reads the platform role rather than the legacy boolean", async () => {
    rows = [{ role: "admin" }];
    const { isUserAdmin } = await modulePromise;

    expect(await isUserAdmin("u1")).toBe(true);
    expect(Object.keys(lastProjection ?? {})).toEqual(["role"]);
  });

  test("returns false for a plain user", async () => {
    rows = [{ role: "user" }];
    const { isUserAdmin } = await modulePromise;

    expect(await isUserAdmin("u1")).toBe(false);
  });

  test("returns false when the user does not exist", async () => {
    rows = [];
    const { isUserAdmin } = await modulePromise;

    expect(await isUserAdmin("nobody")).toBe(false);
  });

  test("keeps its boolean signature so call sites are unchanged", async () => {
    rows = [{ role: "admin" }];
    const { isUserAdmin } = await modulePromise;

    const result = await isUserAdmin("u1");

    expect(typeof result).toBe("boolean");
  });
});
