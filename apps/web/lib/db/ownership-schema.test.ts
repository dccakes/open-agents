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
 * Three tables carry the same convention — a nullable `organization_id` where
 * non-NULL means the organization owns the row — and until now it was written
 * down in comments and AGENTS.md and enforced by nothing. Every property below
 * is silent at typecheck time: making the column NOT NULL, dropping the
 * partial unique index, or widening it to cover personal rows all compile
 * fine, and each one changes what the database actually guarantees.
 *
 * The partial index is the load-bearing one. It is what makes "exactly one
 * organization-owned row per installation/repository" true regardless of
 * whether the promotion routine remembers, and its `WHERE ... IS NOT NULL`
 * clause is what keeps it from colliding with the personal rows it does not
 * govern.
 */

const OWNABLE_TABLES: {
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
    name: "vercel_project_links",
    table: vercelProjectLinks,
    partialUniqueIndex: "vercel_project_links_org_repo_idx",
  },
  {
    name: "linear_workspaces",
    table: linearWorkspaces,
    partialUniqueIndex: "linear_workspaces_organization_id_idx",
  },
];

for (const { name, table, partialUniqueIndex } of OWNABLE_TABLES) {
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
