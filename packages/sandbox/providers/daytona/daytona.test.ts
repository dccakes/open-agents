import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defaultRegistry } from "../../registry";
import { daytonaProvider } from "./index";

describe("Daytona provider", () => {
  const originalApiKey = process.env.DAYTONA_API_KEY;
  const originalServerUrl = process.env.DAYTONA_SERVER_URL;
  const originalBetaEnabled = process.env.DAYTONA_BETA_ENABLED;

  beforeEach(() => {
    delete process.env.DAYTONA_API_KEY;
    delete process.env.DAYTONA_SERVER_URL;
    delete process.env.DAYTONA_BETA_ENABLED;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.DAYTONA_API_KEY;
    } else {
      process.env.DAYTONA_API_KEY = originalApiKey;
    }

    if (originalServerUrl === undefined) {
      delete process.env.DAYTONA_SERVER_URL;
    } else {
      process.env.DAYTONA_SERVER_URL = originalServerUrl;
    }

    if (originalBetaEnabled === undefined) {
      delete process.env.DAYTONA_BETA_ENABLED;
    } else {
      process.env.DAYTONA_BETA_ENABLED = originalBetaEnabled;
    }
  });

  test("registers in defaultRegistry", () => {
    const def = defaultRegistry.get("daytona");
    expect(def).toBe(daytonaProvider);
  });

  test("isAvailable returns false when beta flag is missing", () => {
    expect(daytonaProvider.isAvailable()).toBe(false);
    expect(daytonaProvider.reasonUnavailable()).toMatch(/DAYTONA_BETA_ENABLED/);
  });

  test("isAvailable returns false when beta flag is invalid", () => {
    process.env.DAYTONA_BETA_ENABLED = "0";
    expect(daytonaProvider.isAvailable()).toBe(false);
    expect(daytonaProvider.reasonUnavailable()).toMatch(/DAYTONA_BETA_ENABLED/);
  });

  test("isAvailable returns true when beta flag is enabled", () => {
    process.env.DAYTONA_BETA_ENABLED = "true";
    expect(daytonaProvider.isAvailable()).toBe(true);
    expect(daytonaProvider.reasonUnavailable()).toBeUndefined();
  });

  test("is labeled as beta", () => {
    expect(daytonaProvider.beta).toBe(true);
    expect(daytonaProvider.label).toContain("Daytona");
  });

  test("capabilities are set correctly", () => {
    expect(daytonaProvider.capabilities.persistent).toBe(true);
    expect(daytonaProvider.capabilities.db).toBe(true);
    expect(daytonaProvider.capabilities.envInjection).toBe(true);
    expect(daytonaProvider.capabilities.credentialBrokering).toBe(true);
  });
});
