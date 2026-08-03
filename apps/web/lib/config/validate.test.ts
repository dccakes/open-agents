import { afterEach, describe, expect, test } from "bun:test";
import {
  collectConfigProblems,
  validateServerConfig,
} from "@/lib/config/validate";

const TRACKED_KEYS = [
  "VERCEL_ENV",
  "POSTGRES_URL",
  "BETTER_AUTH_SECRET",
  "NEXT_PUBLIC_VERCEL_APP_CLIENT_ID",
  "VERCEL_APP_CLIENT_SECRET",
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "LINEAR_WEBHOOK_SECRET",
  "DOCKER_SANDBOX_IMAGE",
] as const;

const originalValues = new Map(
  TRACKED_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(
  values: Partial<Record<(typeof TRACKED_KEYS)[number], string>>,
) {
  for (const key of TRACKED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

/** Everything a production boot needs, so tests can remove one at a time. */
function productionBaseline() {
  return {
    VERCEL_ENV: "production",
    POSTGRES_URL: "postgres://user:pass@localhost:5432/db",
    BETTER_AUTH_SECRET: "secret",
    NEXT_PUBLIC_VERCEL_APP_CLIENT_ID: "client-id",
    VERCEL_APP_CLIENT_SECRET: "client-secret",
  };
}

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("validateServerConfig", () => {
  test("passes when a production deployment has every required variable", () => {
    setEnv(productionBaseline());

    expect(() => validateServerConfig()).not.toThrow();
  });

  test("names the missing variable on a production boot", () => {
    const { POSTGRES_URL: _omitted, ...withoutDatabase } = productionBaseline();
    setEnv(withoutDatabase);

    expect(() => validateServerConfig()).toThrow(/POSTGRES_URL is required/);
  });

  test("does not enforce production requirements outside production", () => {
    setEnv({ VERCEL_ENV: "preview" });

    expect(collectConfigProblems().errors).toEqual([]);
  });

  test("requires a cohort variable once its integration is configured", () => {
    setEnv({ ...productionBaseline(), LINEAR_CLIENT_ID: "linear-client" });

    const { errors } = collectConfigProblems();

    expect(
      errors.some((error) => error.startsWith("LINEAR_WEBHOOK_SECRET")),
    ).toBe(true);
    expect(
      errors.some((error) => error.startsWith("LINEAR_CLIENT_SECRET")),
    ).toBe(true);
  });

  test("warns about dev-only variables set in production", () => {
    setEnv({
      ...productionBaseline(),
      DOCKER_SANDBOX_IMAGE: "open-agents/sandbox-dev:latest",
    });

    const { warnings } = collectConfigProblems();

    expect(
      warnings.some((warning) => warning.startsWith("DOCKER_SANDBOX_IMAGE")),
    ).toBe(true);
  });
});
