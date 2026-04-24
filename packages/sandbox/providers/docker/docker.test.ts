import { describe, expect, test } from "bun:test";
import { defaultRegistry } from "../../registry";
import { dockerProvider } from "./index";

describe("Docker provider", () => {
  test("registers in defaultRegistry", () => {
    const def = defaultRegistry.get("docker");
    expect(def).toBe(dockerProvider);
  });

  test("capabilities are set correctly", () => {
    expect(dockerProvider.capabilities.persistent).toBe(false);
    expect(dockerProvider.capabilities.db).toBe(true);
    expect(dockerProvider.capabilities.envInjection).toBe(true);
    expect(dockerProvider.capabilities.credentialBrokering).toBe(false);
  });
});
