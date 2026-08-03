import { beforeEach, describe, expect, mock, test } from "bun:test";

let seededOrganizationId: string | null = "org-1";
let rows: Record<string, unknown>[] = [];
let joins: string[] = [];
let whereClauses: unknown[] = [];

function chain() {
  const self = {
    from: () => self,
    leftJoin: (_table: unknown, condition: unknown) => {
      joins.push("left");
      whereClauses.push(condition);
      return self;
    },
    innerJoin: () => {
      joins.push("inner");
      return self;
    },
    where: (condition: unknown) => {
      whereClauses.push(condition);
      return self;
    },
    orderBy: async () => rows,
  };
  return self;
}

mock.module("@/lib/db/client", () => ({
  db: { select: () => chain() },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => seededOrganizationId,
}));

const modulePromise = import("@/lib/org/member-directory");

/** The literal fragments of a Drizzle SQL condition, joined for assertion. */
function renderSql(condition: unknown): string {
  if (typeof condition !== "object" || condition === null) {
    return String(condition);
  }

  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      return Array.isArray(value) ? value.join("") : "";
    })
    .join(" ");
}

beforeEach(() => {
  seededOrganizationId = "org-1";
  rows = [];
  joins = [];
  whereClauses = [];
});

describe("listPendingUsers", () => {
  // Pending is the *absence* of a membership row, not a role value, so the
  // query must be a LEFT JOIN filtered on the missing side. A role filter
  // would be a fail-open shape.
  test("selects users with no membership row via a left join", async () => {
    rows = [{ userId: "u1" }];
    const { listPendingUsers } = await modulePromise;

    expect(await listPendingUsers()).toEqual([{ userId: "u1" }] as never);
    expect(joins).toEqual(["left"]);
    expect(renderSql(whereClauses.at(-1))).toContain("is null");
  });

  test("returns nobody before the organization is seeded", async () => {
    seededOrganizationId = null;
    const { listPendingUsers } = await modulePromise;

    expect(await listPendingUsers()).toEqual([]);
  });
});

describe("listOrganizationMembers", () => {
  test("joins members to their user rows", async () => {
    rows = [{ memberId: "m1" }];
    const { listOrganizationMembers } = await modulePromise;

    expect(await listOrganizationMembers()).toEqual([
      { memberId: "m1" },
    ] as never);
    expect(joins).toEqual(["inner"]);
  });

  test("returns nobody before the organization is seeded", async () => {
    seededOrganizationId = null;
    const { listOrganizationMembers } = await modulePromise;

    expect(await listOrganizationMembers()).toEqual([]);
  });
});
