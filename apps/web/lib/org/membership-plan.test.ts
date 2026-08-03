import { describe, expect, test } from "bun:test";
import {
  isBootstrapAdmin,
  planPlatformAdminIds,
  planSeedMemberships,
  type SeedCandidateUser,
} from "@/lib/org/membership-plan";

const ADMIN_EMAILS = ["ada@nextdegree.org"] as const;

function user(overrides: Partial<SeedCandidateUser> = {}): SeedCandidateUser {
  return {
    id: "u1",
    email: "ada@nextdegree.org",
    emailVerified: true,
    ...overrides,
  };
}

describe("isBootstrapAdmin", () => {
  test("matches a verified configured email, case-insensitively", () => {
    expect(
      isBootstrapAdmin(user({ email: "Ada@NextDegree.org" }), ADMIN_EMAILS),
    ).toBe(true);
  });

  test("refuses an unverified email", () => {
    expect(isBootstrapAdmin(user({ emailVerified: false }), ADMIN_EMAILS)).toBe(
      false,
    );
  });

  test("refuses a null email", () => {
    expect(isBootstrapAdmin(user({ email: null }), ADMIN_EMAILS)).toBe(false);
  });

  test("refuses an email that is not configured", () => {
    expect(
      isBootstrapAdmin(user({ email: "eve@elsewhere.com" }), ADMIN_EMAILS),
    ).toBe(false);
  });

  test("matches nobody when the allowlist is empty", () => {
    expect(isBootstrapAdmin(user(), [])).toBe(false);
  });
});

describe("planSeedMemberships", () => {
  test("grants every existing user membership so nobody is locked out", () => {
    const plan = planSeedMemberships(
      [
        user({ id: "u1" }),
        user({ id: "u2", email: "grace@nextdegree.org" }),
        user({ id: "u3", email: null }),
      ],
      ADMIN_EMAILS,
    );

    expect(plan).toEqual([
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "member" },
      { userId: "u3", role: "member" },
    ]);
  });

  test("is empty for an empty deployment", () => {
    expect(planSeedMemberships([], ADMIN_EMAILS)).toEqual([]);
  });
});

describe("planPlatformAdminIds", () => {
  test("returns only the verified configured admins", () => {
    expect(
      planPlatformAdminIds(
        [
          user({ id: "u1" }),
          user({ id: "u2", emailVerified: false }),
          user({ id: "u3", email: "grace@nextdegree.org" }),
        ],
        ADMIN_EMAILS,
      ),
    ).toEqual(["u1"]);
  });
});
