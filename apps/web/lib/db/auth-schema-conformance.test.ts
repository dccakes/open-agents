import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { AnyPgTable } from "drizzle-orm/pg-core";
import { authDbSchemaMap } from "@/lib/auth/db-schema-map";
import { createAuthPlugins } from "@/lib/auth/plugins";

/**
 * Hand-authored plugin tables fail at runtime, not at typecheck, when a column
 * the plugin declares is missing or misnamed — the Drizzle adapter indexes the
 * table object by Better Auth's *field* name, so a mismatch surfaces as a
 * "field does not exist in the schema" error on an ordinary request.
 *
 * The expectations are read from the plugins themselves rather than hardcoded,
 * so a Better Auth upgrade that adds a field fails here instead of in
 * production.
 */

type PluginFieldAttributes = { fieldName?: string };
type PluginModelSchema = {
  modelName?: string;
  fields: Record<string, PluginFieldAttributes>;
};

const plugins = createAuthPlugins();

/**
 * Default model names, used when a plugin does not remap one. `user` and
 * `session` are remapped by the root Better Auth config rather than by a
 * plugin, so they are resolved here.
 */
const DEFAULT_MODEL_NAMES: Record<string, string> = {
  user: "users",
  session: "auth_sessions",
};

interface DeclaredModel {
  plugin: string;
  model: string;
  tableKey: string;
  fields: string[];
}

function collectDeclaredModels(): DeclaredModel[] {
  const declared: DeclaredModel[] = [];

  for (const plugin of plugins) {
    const schema = plugin.schema as
      | Record<string, PluginModelSchema>
      | undefined;
    if (!schema) {
      continue;
    }

    for (const [model, modelSchema] of Object.entries(schema)) {
      declared.push({
        plugin: plugin.id,
        model,
        tableKey: modelSchema.modelName ?? DEFAULT_MODEL_NAMES[model] ?? model,
        fields: Object.entries(modelSchema.fields ?? {}).map(
          ([field, attributes]) => attributes.fieldName ?? field,
        ),
      });
    }
  }

  return declared;
}

const declaredModels = collectDeclaredModels();

describe("plugin schema conformance", () => {
  test("every plugin model maps to a table in the adapter schema", () => {
    for (const { plugin, model, tableKey } of declaredModels) {
      expect({ plugin, model, mapped: tableKey in authDbSchemaMap }).toEqual({
        plugin,
        model,
        mapped: true,
      });
    }
  });

  test("every plugin-declared field exists as a column", () => {
    for (const { plugin, model, tableKey, fields } of declaredModels) {
      const table = (authDbSchemaMap as Record<string, AnyPgTable>)[tableKey];
      expect({ plugin, model, tableKey, found: Boolean(table) }).toEqual({
        plugin,
        model,
        tableKey,
        found: true,
      });

      const columns = Object.keys(getTableColumns(table));
      for (const field of fields) {
        expect({ tableKey, field, present: columns.includes(field) }).toEqual({
          tableKey,
          field,
          present: true,
        });
      }
    }
  });

  test("covers both plugins, not just the new tables", () => {
    const models = declaredModels.map(
      (entry) => `${entry.plugin}:${entry.model}`,
    );

    expect(models).toContain("organization:organization");
    expect(models).toContain("organization:member");
    expect(models).toContain("organization:invitation");
    expect(models).toContain("organization:session");
    expect(models).toContain("admin:user");
    expect(models).toContain("admin:session");
  });
});

describe("columns the plugins select but this change never writes", () => {
  // These went missing in an earlier draft precisely because nothing in the
  // change reads them. Better Auth selects every field its schemas declare, so
  // their absence is a SQL error on ordinary authenticated requests.
  const required: Array<[string, string[]]> = [
    ["users", ["role", "banned", "banReason", "banExpires"]],
    ["auth_sessions", ["activeOrganizationId", "impersonatedBy"]],
    ["organizations", ["metadata", "slug", "logo"]],
    ["org_members", ["organizationId", "userId", "role", "createdAt"]],
    [
      "org_invitations",
      [
        "organizationId",
        "email",
        "role",
        "status",
        "expiresAt",
        "inviterId",
        "createdAt",
      ],
    ],
  ];

  for (const [tableKey, fields] of required) {
    test(`${tableKey} carries every plugin column`, () => {
      const table = (authDbSchemaMap as Record<string, AnyPgTable>)[tableKey];
      const columns = Object.keys(getTableColumns(table));

      for (const field of fields) {
        expect({ tableKey, field, present: columns.includes(field) }).toEqual({
          tableKey,
          field,
          present: true,
        });
      }
    });
  }

  test("users keeps is_admin until the contract migration drops it", () => {
    const columns = Object.keys(getTableColumns(authDbSchemaMap.users));

    expect(columns).toContain("isAdmin");
  });
});
