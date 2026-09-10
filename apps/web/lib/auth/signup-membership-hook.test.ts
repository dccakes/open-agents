import { beforeEach, describe, expect, mock, test } from "bun:test";

interface GrantCall {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

let grantCalls: GrantCall[] = [];
let grantError: Error | null = null;

mock.module("@/lib/org/grant-signup-membership", () => ({
  grantSignupMembership: async (user: GrantCall) => {
    grantCalls.push(user);
    if (grantError) {
      throw grantError;
    }
    return null;
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => "org-1",
  setSeededOrganizationId: () => undefined,
  resetSeededOrganizationCache: () => undefined,
}));

const hookModulePromise = import("@/lib/auth/signup-membership-hook");
const configModulePromise = import("@/lib/auth/config");

type UserCreateAfterHook = (user: Record<string, unknown>) => Promise<void>;

beforeEach(() => {
  grantCalls = [];
  grantError = null;
});

describe("applySignupMembership", () => {
  test("passes the created user's email identity to the allowlist", async () => {
    const { applySignupMembership } = await hookModulePromise;

    await applySignupMembership({
      id: "u1",
      email: "grace@nextdegree.org",
      emailVerified: true,
    });

    expect(grantCalls).toEqual([
      { id: "u1", email: "grace@nextdegree.org", emailVerified: true },
    ]);
  });

  test("normalizes a missing email to null and a missing flag to false", async () => {
    const { applySignupMembership } = await hookModulePromise;

    await applySignupMembership({ id: "u1" });

    expect(grantCalls).toEqual([
      { id: "u1", email: null, emailVerified: false },
    ]);
  });

  test("leaves the user pending rather than failing sign-in when the grant errors", async () => {
    grantError = new Error("database unavailable");
    const { applySignupMembership } = await hookModulePromise;

    expect(applySignupMembership({ id: "u1" })).resolves.toBeUndefined();
  });
});

describe("membership hook wiring", () => {
  test("the allowlist runs on user creation", async () => {
    const { auth } = await configModulePromise;
    const hook = auth.options.databaseHooks?.user?.create
      ?.after as unknown as UserCreateAfterHook;

    await hook({
      id: "u1",
      email: "grace@nextdegree.org",
      emailVerified: true,
    });

    expect(grantCalls).toEqual([
      { id: "u1", email: "grace@nextdegree.org", emailVerified: true },
    ]);
  });

  // Linking a second provider account writes an `account` row, never a `user`
  // row. A hook on account creation would re-run the allowlist against the
  // linked address and let a pending user in through the back door.
  test("no database hook runs on account creation", async () => {
    const { auth } = await configModulePromise;
    const databaseHooks = auth.options.databaseHooks as
      | Record<string, unknown>
      | undefined;

    expect(databaseHooks?.account).toBeUndefined();
  });

  test("account linking across differing emails stays enabled", async () => {
    const { auth } = await configModulePromise;

    // Documented deliberately: linking is allowed *because* the membership
    // decision is made once, from the user record, and never re-evaluated.
    expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(
      true,
    );
  });
});
