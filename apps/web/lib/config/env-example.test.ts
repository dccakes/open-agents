import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseEnvFile, renderEnvExample } from "@/lib/config/env-example";
import { getEnvCatalog } from "@/lib/config/registry";

const examplePath = join(import.meta.dirname, "..", "..", ".env.example");
const exampleContents = await Bun.file(examplePath).text();

describe(".env.example", () => {
  test("matches what the config schemas render", () => {
    expect(exampleContents).toBe(renderEnvExample());
  });

  test("declares exactly the variables in the config catalog", () => {
    const declared = Object.keys(parseEnvFile(exampleContents));
    const catalog = getEnvCatalog().map((entry) => entry.name);

    expect(declared).toEqual(catalog);
  });

  test("leaves every secret blank", () => {
    const values = parseEnvFile(exampleContents);

    for (const entry of getEnvCatalog()) {
      if (entry.spec.secret) {
        expect(values[entry.name]).toBe("");
      }
    }
  });

  test("parses against the schemas with dummy values", () => {
    const values = parseEnvFile(exampleContents);

    for (const entry of getEnvCatalog()) {
      const value = values[entry.name] || `dummy-${entry.name.toLowerCase()}`;
      const result = entry.spec.schema.safeParse(value);

      expect({
        name: entry.name,
        success: result.success,
      }).toEqual({ name: entry.name, success: true });
    }
  });
});
