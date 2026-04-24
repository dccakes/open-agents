import { describe, expect, test } from "bun:test";
import { VercelEnvResolver } from "./vercel";

const MOCK_VERCEL_VARS = [
  {
    key: "DATABASE_URL",
    value: "postgres://...",
    target: ["production", "preview", "development"],
  },
  {
    key: "SECRET_KEY",
    value: "s3cr3t",
    target: ["production", "preview", "development"],
  },
  {
    key: "VERCEL_TOKEN",
    value: "should-be-denied",
    target: ["production"],
  },
];

describe("VercelEnvResolver", () => {
  test("resolves environment variables from Vercel API", async () => {
    const resolver = new VercelEnvResolver({
      fetchVars: async () => MOCK_VERCEL_VARS,
    });

    const result = await resolver.resolve({
      environment: "production",
      denylist: [],
    });

    expect(result["DATABASE_URL"]).toBe("postgres://...");
    expect(result["SECRET_KEY"]).toBe("s3cr3t");
  });

  test("excludes denylisted keys from output", async () => {
    const resolver = new VercelEnvResolver({
      fetchVars: async () => MOCK_VERCEL_VARS,
    });

    const result = await resolver.resolve({
      environment: "production",
      denylist: ["VERCEL_TOKEN", "SECRET_KEY"],
    });

    expect(result["VERCEL_TOKEN"]).toBeUndefined();
    expect(result["SECRET_KEY"]).toBeUndefined();
    expect(result["DATABASE_URL"]).toBe("postgres://...");
  });

  test("filters by target environment", async () => {
    const resolver = new VercelEnvResolver({
      fetchVars: async () => MOCK_VERCEL_VARS,
    });

    const result = await resolver.resolve({
      environment: "preview",
      denylist: [],
    });

    expect(result["VERCEL_TOKEN"]).toBeUndefined();
    expect(result["DATABASE_URL"]).toBe("postgres://...");
  });
});
