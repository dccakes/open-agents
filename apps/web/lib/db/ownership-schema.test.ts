import { describe, expect, test } from "bun:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  githubInstallations,
  linearWorkspaces,
  vercelProjectLinks,
} from "./schema";

/**
 * The ownership discriminator, pinned.
 *
 * These properties are all silent at typecheck time — dropping an index or
 * changing a column's nullability compiles fine and changes what the database
 * actually guarantees — so they are asserted here, in the idiom the repo
 * already uses for the policy and usage schema.
 *
 * Two shapes, and the difference matters:
 *
 * - `github_installations` and `linear_workspaces` have a **nullable**
 *   `organization_id`, because both genuinely have personal rows: an
 *   installation on someone's own GitHub account is never promotable. The
 *   partial unique index is what makes "one organization-owned row" true
 *   without constraining the personal rows it does not govern.
 * - `vercel_project_links` has a **NOT NULL** `organization_id` and a primary
 *   key that starts with it. There is no personal variant at all — which
 *   project a repository deploys to is a fact about the repository — so the
 *   key does the work an index would otherwise have to.
 */

const NULLABLE_OWNERSHIP: {
  name: string;
  table: Parameters<typeof getTableConfig>[0];
  partialUniqueIndex: string;
}[] = [
  {
    name: "github_installations",
    table: githubInstallations,
    partialUniqueIndex: "github_installations_org_installation_idx",
  },
  {
    name: "linear_workspaces",
    table: linearWorkspaces,
    partialUniqueIndex: "linear_workspaces_organization_id_idx",
  },
];

for (const { name, table, partialUniqueIndex } of NULLABLE_OWNERSHIP) {
  describe(`${name} ownership discriminator`, () => {
    test("has a nullable organization_id", () => {
      const columns = getTableColumns(table) as Record<
        string,
        { name: string; notNull: boolean }
      >;

      expect(Object.keys(columns)).toContain("organizationId");
      expect(columns.organizationId?.name).toBe("organization_id");
      // Nullable is the whole mechanism: NULL *is* "personal". A NOT NULL
      // column would force every row to claim an owner it may not have.
      expect(columns.organizationId?.notNull).toBe(false);
    });

    test("references organizations, so a deleted org takes its rows with it", () => {
      const { foreignKeys } = getTableConfig(table);
      const orgFk = foreignKeys.find((fk) =>
        fk
          .reference()
          .columns.some((column) => column.name === "organization_id"),
      );

      expect(orgFk).toBeDefined();
      const foreignTable = orgFk?.reference().foreignTable;
      expect(foreignTable && getTableName(foreignTable)).toBe("organizations");
    });

    test("enforces one organization-owned row with a partial unique index", () => {
      const { indexes } = getTableConfig(table);
      const index = indexes.find(
        (candidate) => candidate.config.name === partialUniqueIndex,
      );

      expect(index).toBeDefined();
      expect(index?.config.unique).toBe(true);
      // Partial, not total: without the WHERE clause this would also constrain
      // the personal rows, where duplicates across users are expected.
      expect(index?.config.where).toBeDefined();
      expect(
        index?.config.columns.some((column) =>
          "name" in column ? column.name === "organization_id" : false,
        ),
      ).toBe(true);
    });
  });
}

describe("vercel_project_links is owned outright", () => {
  test("organization_id is NOT NULL — there is no personal variant", () => {
    const columns = getTableColumns(vercelProjectLinks) as Record<
      string,
      { name: string; notNull: boolean }
    >;

    expect(columns.organizationId?.notNull).toBe(true);
  });

  test("the primary key is the repository, keyed by organization", () => {
    const { primaryKeys } = getTableConfig(vercelProjectLinks);
    const columns = primaryKeys[0]?.columns.map((column) => column.name);

    expect(columns).toEqual(["organization_id", "repo_owner", "repo_name"]);
  });

  // Provenance outliving its author is the point: the organization's deploy
  // target must not vanish because the person who recorded it was removed.
  test("user_id is nullable provenance that survives the user", () => {
    const columns = getTableColumns(vercelProjectLinks) as Record<
      string,
      { notNull: boolean }
    >;

    expect(columns.userId?.notNull).toBe(false);
  });
});
