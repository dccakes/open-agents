import { beforeEach, describe, expect, mock, test } from "bun:test";

let seededOrganizationId: string | null = "org-1";

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
  setSeededOrganizationId: () => undefined,
  resetSeededOrganizationCache: () => undefined,
}));

const modulePromise = import("@/lib/auth/config");

type SessionCreateHook = (
  session: Record<string, unknown>,
) => Promise<{ data: Record<string, unknown> } | undefined>;

beforeEach(() => {
  seededOrganizationId = "org-1";
});

describe("session configuration", () => {
  // Every permission check in this codebase is a per-request database lookup.
  // Better Auth's session cookie cache would serve a demoted admin their old
  // role for the cache TTL and nothing would flag it, so the option is
  // prohibited while that remains true.
  test("cookie caching is not enabled", async () => {
    const { auth } = await modulePromise;
    const sessionOptions = auth.options.session as
      | Record<string, unknown>
      | undefined;

    expect(sessionOptions?.cookieCache).toBeUndefined();
  });

  test("sessions are stored in auth_sessions", async () => {
    const { auth } = await modulePromise;

    expect(auth.options.session?.modelName).toBe("auth_sessions");
  });
});

describe("session creation", () => {
  test("scopes a new session to the seeded organization", async () => {
    const { auth } = await modulePromise;
    const hook = auth.options.databaseHooks?.session?.create
      ?.before as SessionCreateHook;

    const result = await hook({ id: "s1", userId: "u1" });

    // Better Auth merges the returned delta onto the row it is about to
    // insert, so only the changed field is returned.
    expect(result?.data).toEqual({ activeOrganizationId: "org-1" });
  });

  test("leaves the session untouched before the organization is seeded", async () => {
    seededOrganizationId = null;
    const { auth } = await modulePromise;
    const hook = auth.options.databaseHooks?.session?.create
      ?.before as SessionCreateHook;

    expect(await hook({ id: "s1", userId: "u1" })).toBeUndefined();
  });
});

describe("plugin configuration", () => {
  test("mounts the organization and admin plugins", async () => {
    const { auth } = await modulePromise;
    const ids = (auth.options.plugins ?? []).map((plugin) => plugin.id);

    expect(ids).toContain("organization");
    expect(ids).toContain("admin");
  });

  test("exposes the organization and admin plugin APIs", async () => {
    const { auth } = await modulePromise;

    expect(typeof auth.api.hasPermission).toBe("function");
    expect(typeof auth.api.setRole).toBe("function");
    expect(typeof auth.api.removeMember).toBe("function");
    expect(typeof auth.api.updateMemberRole).toBe("function");
    expect(typeof auth.api.revokeUserSessions).toBe("function");
  });

  test("registers the last-admin guard as a request hook", async () => {
    const { auth } = await modulePromise;

    expect(typeof auth.options.hooks?.before).toBe("function");
  });
});
