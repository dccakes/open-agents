import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  authSessions,
  orgMembers,
  orgSettings,
  organizations,
  users,
} from "@/lib/db/schema";

interface InsertCall {
  table: unknown;
  values: Record<string, unknown>[];
  conflictTarget: unknown;
}

interface UpdateCall {
  table: unknown;
  values: Record<string, unknown>;
}

/** Rows each table's SELECT resolves to. */
const selectRows = new Map<unknown, Record<string, unknown>[]>();
/** Rows each table's INSERT ... RETURNING resolves to. */
const insertReturns = new Map<unknown, Record<string, unknown>[]>();
/** Rows each table's UPDATE ... RETURNING resolves to. */
const updateReturns = new Map<unknown, Record<string, unknown>[]>();

let insertCalls: InsertCall[] = [];
let updateCalls: UpdateCall[] = [];

type SelectChain = Promise<Record<string, unknown>[]> & {
  where: () => SelectChain;
  limit: () => Promise<Record<string, unknown>[]>;
};

/**
 * A real Promise carrying the builder methods, so a query can be awaited
 * directly (`select().from(users)`) or narrowed first (`.where().limit()`),
 * exactly as Drizzle allows.
 */
function selectChain(table: unknown): SelectChain {
  const rows = () => Promise.resolve(selectRows.get(table) ?? []);
  return Object.assign(rows(), {
    where: () => selectChain(table),
    limit: () => rows(),
  });
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
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
              return Promise.resolve(insertReturns.get(table) ?? []);
            },
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updateCalls.push({ table, values });
            return Promise.resolve(updateReturns.get(table) ?? []);
          },
        }),
      }),
    }),
  },
}));

const modulePromise = import("@/lib/org/seed");
const cachePromise = import("@/lib/org/seeded-organization");

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;
const ORIGINAL_ORG_SLUG = process.env.DEFAULT_ORG_SLUG;
const ORIGINAL_ORG_NAME = process.env.DEFAULT_ORG_NAME;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

beforeEach(async () => {
  selectRows.clear();
  insertReturns.clear();
  updateReturns.clear();
  insertCalls = [];
  updateCalls = [];
  restoreEnv("ADMIN_EMAILS", ORIGINAL_ADMIN_EMAILS);
  restoreEnv("DEFAULT_ORG_SLUG", ORIGINAL_ORG_SLUG);
  restoreEnv("DEFAULT_ORG_NAME", ORIGINAL_ORG_NAME);
  const { resetSeededOrganizationCache } = await cachePromise;
  resetSeededOrganizationCache();
});

describe("ensureSeededOrganization", () => {
  test("creates the organization from configuration", async () => {
    process.env.DEFAULT_ORG_NAME = "Next Degree";
    process.env.DEFAULT_ORG_SLUG = "next-degree";
    insertReturns.set(organizations, [{ id: "org-1" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    expect(result.organizationId).toBe("org-1");
    expect(result.createdOrganization).toBe(true);
    const orgInsert = insertCalls.find((call) => call.table === organizations);
    expect(orgInsert?.values[0]).toMatchObject({
      name: "Next Degree",
      slug: "next-degree",
    });
  });

  test("relies on the slug conflict target rather than check-then-insert", async () => {
    insertReturns.set(organizations, [{ id: "org-1" }]);
    const { ensureSeededOrganization } = await modulePromise;

    await ensureSeededOrganization();

    const orgInsert = insertCalls.find((call) => call.table === organizations);
    expect(orgInsert?.conflictTarget).toBe(organizations.slug);
  });

  test("adopts the winning row when a concurrent boot already inserted it", async () => {
    insertReturns.set(organizations, []);
    selectRows.set(organizations, [{ id: "org-from-other-boot" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    expect(result.organizationId).toBe("org-from-other-boot");
    expect(result.createdOrganization).toBe(false);
  });

  test("is a no-op on a second run against a seeded database", async () => {
    insertReturns.set(organizations, []);
    selectRows.set(organizations, [{ id: "org-1" }]);
    selectRows.set(users, [
      { id: "u1", email: "grace@nextdegree.org", emailVerified: true },
    ]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    expect(result).toMatchObject({
      createdOrganization: false,
      grantedMemberships: 0,
      promotedPlatformAdmins: 0,
      backfilledSessions: 0,
    });
  });

  // The settings row cannot come from a migration: migrations are static SQL
  // and the organization they key off is created here, from configuration.
  test("creates the organization settings row with the kill switch off", async () => {
    insertReturns.set(organizations, [{ id: "org-1" }]);
    insertReturns.set(orgSettings, [{ id: "settings-1" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    const settingsInsert = insertCalls.find(
      (call) => call.table === orgSettings,
    );
    expect(settingsInsert?.values[0]).toMatchObject({
      organizationId: "org-1",
      agentRunsPaused: false,
      dailyTokenBudget: null,
    });
    expect(result.createdSettings).toBe(true);
  });

  test("leaves an existing settings row untouched on a later boot", async () => {
    insertReturns.set(organizations, []);
    selectRows.set(organizations, [{ id: "org-1" }]);
    insertReturns.set(orgSettings, []);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    // Insert-with-conflict, not check-then-insert: a concurrent boot cannot
    // reset an administrator's kill switch back to false.
    const settingsInsert = insertCalls.find(
      (call) => call.table === orgSettings,
    );
    expect(settingsInsert?.conflictTarget).toBe(orgSettings.organizationId);
    expect(result.createdSettings).toBe(false);
    expect(updateCalls.some((call) => call.table === orgSettings)).toBe(false);
  });

  test("grants membership to every existing user", async () => {
    process.env.ADMIN_EMAILS = "ada@nextdegree.org";
    insertReturns.set(organizations, [{ id: "org-1" }]);
    selectRows.set(users, [
      { id: "u1", email: "ada@nextdegree.org", emailVerified: true },
      { id: "u2", email: "grace@nextdegree.org", emailVerified: true },
      { id: "u3", email: null, emailVerified: false },
    ]);
    insertReturns.set(orgMembers, [{ id: "m1" }, { id: "m2" }, { id: "m3" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    const memberInsert = insertCalls.find((call) => call.table === orgMembers);
    expect(memberInsert?.values).toMatchObject([
      { organizationId: "org-1", userId: "u1", role: "owner" },
      { organizationId: "org-1", userId: "u2", role: "member" },
      { organizationId: "org-1", userId: "u3", role: "member" },
    ]);
    expect(result.grantedMemberships).toBe(3);
  });

  // The cutover backfill is a one-time action. If it re-ran on every boot it
  // would re-approve everyone who had been left pending, which would turn the
  // membership gate into a no-op on the next deploy.
  test("does not re-grant membership to pending users on a later boot", async () => {
    process.env.ADMIN_EMAILS = "ada@nextdegree.org";
    insertReturns.set(organizations, []);
    selectRows.set(organizations, [{ id: "org-1" }]);
    selectRows.set(users, [
      { id: "u1", email: "ada@nextdegree.org", emailVerified: true },
      { id: "u2", email: "stranger@example.com", emailVerified: true },
    ]);
    const { ensureSeededOrganization } = await modulePromise;

    await ensureSeededOrganization();

    const memberInsert = insertCalls.find((call) => call.table === orgMembers);
    // Only the configured admin, so an adminless deployment stays recoverable.
    expect(memberInsert?.values).toMatchObject([
      { organizationId: "org-1", userId: "u1", role: "owner" },
    ]);
  });

  test("assigns owner and platform admin to configured admins", async () => {
    process.env.ADMIN_EMAILS = "ada@nextdegree.org";
    insertReturns.set(organizations, [{ id: "org-1" }]);
    selectRows.set(users, [
      { id: "u1", email: "ada@nextdegree.org", emailVerified: true },
    ]);
    updateReturns.set(users, [{ id: "u1" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    expect(result.promotedPlatformAdmins).toBe(1);
    expect(
      updateCalls.some(
        (call) => call.table === users && call.values.role === "admin",
      ),
    ).toBe(true);
    expect(
      updateCalls.some(
        (call) => call.table === orgMembers && call.values.role === "owner",
      ),
    ).toBe(true);
  });

  test("does not touch roles when no admin is configured", async () => {
    delete process.env.ADMIN_EMAILS;
    insertReturns.set(organizations, [{ id: "org-1" }]);
    selectRows.set(users, [
      { id: "u1", email: "ada@nextdegree.org", emailVerified: true },
    ]);
    const { ensureSeededOrganization } = await modulePromise;

    await ensureSeededOrganization();

    expect(updateCalls.some((call) => call.table === users)).toBe(false);
  });

  test("backfills the active organization on existing sessions", async () => {
    insertReturns.set(organizations, [{ id: "org-1" }]);
    updateReturns.set(authSessions, [{ id: "s1" }, { id: "s2" }]);
    const { ensureSeededOrganization } = await modulePromise;

    const result = await ensureSeededOrganization();

    expect(result.backfilledSessions).toBe(2);
    const sessionUpdate = updateCalls.find(
      (call) => call.table === authSessions,
    );
    expect(sessionUpdate?.values).toEqual({ activeOrganizationId: "org-1" });
  });

  test("primes the resolver cache so the first request needs no lookup", async () => {
    insertReturns.set(organizations, [{ id: "org-1" }]);
    const { ensureSeededOrganization } = await modulePromise;
    const { getSeededOrganizationId } = await cachePromise;

    await ensureSeededOrganization();
    selectRows.set(organizations, []);

    expect(await getSeededOrganizationId()).toBe("org-1");
  });

  test("fails loudly when the organization cannot be resolved", async () => {
    insertReturns.set(organizations, []);
    selectRows.set(organizations, []);
    const { ensureSeededOrganization } = await modulePromise;

    expect(ensureSeededOrganization()).rejects.toThrow(
      /Failed to seed the organization/,
    );
  });
});
