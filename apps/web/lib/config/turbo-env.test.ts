import { describe, expect, test } from "bun:test";
import { getEnvCatalog } from "@/lib/config/registry";
import {
  findUndeclaredBuildEnv,
  readTurboBuildEnv,
} from "@/lib/config/turbo-env";

describe("turbo.json build env", () => {
  test("passes through every variable in the config catalog", async () => {
    expect(await findUndeclaredBuildEnv()).toEqual([]);
  });

  test("passes through every production-required variable", async () => {
    const buildEnv = new Set(await readTurboBuildEnv());
    const requiredInProd = getEnvCatalog()
      .filter((entry) => entry.spec.axis === "required-prod")
      .map((entry) => entry.name);

    for (const name of requiredInProd) {
      expect({ name, declared: buildEnv.has(name) }).toEqual({
        name,
        declared: true,
      });
    }
  });

  test("passes through the variables that promote an optional one", async () => {
    const buildEnv = new Set(await readTurboBuildEnv());

    for (const entry of getEnvCatalog()) {
      for (const trigger of entry.spec.requiredWith ?? []) {
        expect({ trigger, declared: buildEnv.has(trigger) }).toEqual({
          trigger,
          declared: true,
        });
      }
    }
  });

  test("lists variables once, in sorted order", async () => {
    const buildEnv = await readTurboBuildEnv();

    expect(buildEnv).toEqual([...new Set(buildEnv)].sort());
  });
});
