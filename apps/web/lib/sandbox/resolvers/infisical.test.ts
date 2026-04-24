import { describe, expect, test } from "bun:test";
import { InfisicalEnvResolver } from "./infisical";

const MOCK_INFISICAL_SECRETS = [
  {
    key: "DATABASE_URL",
    value: "postgres://...",
    environment: "production",
  },
  {
    key: "SECRET_KEY",
    value: "s3cr3t",
    environment: "production",
  },
  {
    key: "INFISICAL_TOKEN",
    value: "should-be-denied",
    environment: "production",
  },
];

describe("InfisicalEnvResolver", () => {
  test("resolves environment secrets from Infisical", async () => {
    const resolver = new InfisicalEnvResolver({
      fetchSecrets: async () => MOCK_INFISICAL_SECRETS,
    });

    const result = await resolver.resolve({
      environment: "production",
      denylist: [],
    });

    expect(result["DATABASE_URL"]).toBe("postgres://...");
    expect(result["SECRET_KEY"]).toBe("s3cr3t");
  });

  test("excludes denylisted keys from output", async () => {
    const resolver = new InfisicalEnvResolver({
      fetchSecrets: async () => MOCK_INFISICAL_SECRETS,
    });

    const result = await resolver.resolve({
      environment: "production",
      denylist: ["INFISICAL_TOKEN", "SECRET_KEY"],
    });

    expect(result["INFISICAL_TOKEN"]).toBeUndefined();
    expect(result["SECRET_KEY"]).toBeUndefined();
    expect(result["DATABASE_URL"]).toBe("postgres://...");
  });

  test("throws when required Infisical config is missing", async () => {
    const previousToken = process.env.INFISICAL_TOKEN;
    const previousProjectId = process.env.INFISICAL_PROJECT_ID;
    delete process.env.INFISICAL_TOKEN;
    delete process.env.INFISICAL_PROJECT_ID;

    const resolver = new InfisicalEnvResolver();

    try {
      await expect(
        resolver.resolve({
          environment: "production",
          denylist: [],
        }),
      ).rejects.toThrow("INFISICAL_TOKEN and INFISICAL_PROJECT_ID");
    } finally {
      if (previousToken === undefined) {
        delete process.env.INFISICAL_TOKEN;
      } else {
        process.env.INFISICAL_TOKEN = previousToken;
      }

      if (previousProjectId === undefined) {
        delete process.env.INFISICAL_PROJECT_ID;
      } else {
        process.env.INFISICAL_PROJECT_ID = previousProjectId;
      }
    }
  });
});
