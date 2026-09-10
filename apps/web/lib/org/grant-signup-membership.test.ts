import { beforeEach, describe, expect, mock, test } from "bun:test";
import { orgMembers, users } from "@/lib/db/schema";

interface InsertCall {
  table: unknown;
  values: Record<string, unknown>[];
  conflictTarget: unknown;
}

interface UpdateCall {
  table: unknown;
  values: Record<string, unknown>;
}

let insertCalls: InsertCall[] = [];
let updateCalls: UpdateCall[] = [];
let seededOrganizationId: string | null = "org-1";

mock.module("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(values) ? values : [values];
        return {
          onConflictDoNothing: (options?: { target?: unknown }) => ({
            returning: () => {
              insertCalls.push({
                table,
                values: rows,
                conflictTarget: options?.target,
              });
              return Promise.resolve([{ id: "m1" }]);
            },
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updateCalls.push({ table, values });
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
}));

const modulePromise = import("@/lib/org/grant-signup-membership");

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(() => {
  insertCalls = [];
  updateCalls = [];
  seededOrganizationId = "org-1";
  setEnv("ALLOWED_EMAIL_DOMAINS", "nextdegree.org");
  setEnv("ADMIN_EMAILS", "ada@nextdegree.org");
});

describe("grantSignupMembership", () => {
  test("grants member to a verified allowlisted domain", async () => {
    const { grantSignupMembership } = await modulePromise;

    const result = await grantSignupMembership({
      id: "u1",
      email: "grace@nextdegree.org",
      emailVerified: true,
    });

    expect(result).toEqual({
      organizationRole: "member",
      platformAdmin: false,
    });
    const memberInsert = insertCalls.find((call) => call.table === orgMembers);
    expect(memberInsert?.values[0]).toMatchObject({
      organizationId: "org-1",
      userId: "u1",
      role: "member",
    });
    expect(updateCalls.some((call) => call.table === users)).toBe(false);
  });

  test("grants owner and the platform admin role to an ADMIN_EMAILS match", async () => {
    const { grantSignupMembership } = await modulePromise;

    const result = await grantSignupMembership({
      id: "u1",
      email: "ada@nextdegree.org",
      emailVerified: true,
    });

    expect(result).toEqual({ organizationRole: "owner", platformAdmin: true });
    expect(insertCalls[0]?.values[0]).toMatchObject({ role: "owner" });
    expect(
      updateCalls.some(
        (call) => call.table === users && call.values.role === "admin",
      ),
    ).toBe(true);
  });

  test("writes nothing for a user who is not auto-approved", async () => {
    const { grantSignupMembership } = await modulePromise;

    const result = await grantSignupMembership({
      id: "u1",
      email: "stranger@example.com",
      emailVerified: true,
    });

    expect(result).toBeNull();
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("writes nothing when the email is unverified", async () => {
    const { grantSignupMembership } = await modulePromise;

    await grantSignupMembership({
      id: "u1",
      email: "ada@nextdegree.org",
      emailVerified: false,
    });

    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("is idempotent through an insert-with-conflict, not check-then-insert", async () => {
    const { grantSignupMembership } = await modulePromise;

    await grantSignupMembership({
      id: "u1",
      email: "grace@nextdegree.org",
      emailVerified: true,
    });

    expect(insertCalls[0]?.conflictTarget).toEqual([
      orgMembers.organizationId,
      orgMembers.userId,
    ]);
  });

  test("grants nothing when the organization has not been seeded yet", async () => {
    seededOrganizationId = null;
    const { grantSignupMembership } = await modulePromise;

    const result = await grantSignupMembership({
      id: "u1",
      email: "grace@nextdegree.org",
      emailVerified: true,
    });

    expect(result).toBeNull();
    expect(insertCalls).toHaveLength(0);
  });
});
