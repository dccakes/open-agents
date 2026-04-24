import { afterEach, describe, expect, test } from "bun:test";

afterEach(() => {
  delete process.env.SANDBOX_ENV_RESOLVER;
});

describe("getEnvResolver", () => {
  test("returns null when SANDBOX_ENV_RESOLVER is unset", async () => {
    delete process.env.SANDBOX_ENV_RESOLVER;
    const { getEnvResolver } = await import("./env-resolver");
    expect(getEnvResolver()).toBeNull();
  });

  test("returns VercelEnvResolver when SANDBOX_ENV_RESOLVER=vercel", async () => {
    process.env.SANDBOX_ENV_RESOLVER = "vercel";
    const { getEnvResolver } = await import("./env-resolver");
    const resolver = getEnvResolver();
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe("VercelEnvResolver");
  });

  test("returns InfisicalEnvResolver when SANDBOX_ENV_RESOLVER=infisical", async () => {
    process.env.SANDBOX_ENV_RESOLVER = "infisical";
    const { getEnvResolver } = await import("./env-resolver");
    const resolver = getEnvResolver();
    expect(resolver).not.toBeNull();
    expect(resolver?.constructor.name).toBe("InfisicalEnvResolver");
  });

  test("throws for unknown SANDBOX_ENV_RESOLVER value", async () => {
    process.env.SANDBOX_ENV_RESOLVER = "unknown-backend";
    const { getEnvResolver } = await import("./env-resolver");
    expect(() => getEnvResolver()).toThrow(
      "Unknown SANDBOX_ENV_RESOLVER: unknown-backend",
    );
  });
});
