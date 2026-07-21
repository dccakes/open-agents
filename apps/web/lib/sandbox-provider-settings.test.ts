import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  SandboxConfigField,
  SandboxProviderDef,
} from "@open-agents/sandbox";
import {
  buildEffectiveProviderConfig,
  buildSandboxProviderSettingsData,
  isConfiguredProvider,
} from "./sandbox-provider-settings";

const ENV_KEYS = [
  "TEST_A",
  "TEST_B",
  "TEST_C",
  "TEST_D",
  "TEST_REQUIRED_URL",
  "TEST_REQUIRED_TOKEN",
  "TEST_OPTIONAL_TEAM",
  "TEST_OPTIONAL_NOTE",
] as const;

let originalEnv: Map<string, string | undefined>;

beforeEach(() => {
  originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const originalValue = originalEnv.get(key);
    if (typeof originalValue === "string") {
      process.env[key] = originalValue;
      continue;
    }

    delete process.env[key];
  }
});

const capabilities = {
  persistent: true,
  db: true,
  envInjection: true,
  credentialBrokering: true,
} as const;

function createProvider(
  configFields: SandboxConfigField[],
): SandboxProviderDef<unknown> {
  return {
    type: "vercel",
    label: "Test Provider",
    capabilities,
    configFields,
    isAvailable: () => true,
    reasonUnavailable: () => undefined,
    create: async () => {
      throw new Error("Not implemented in tests");
    },
    connect: async () => {
      throw new Error("Not implemented in tests");
    },
  };
}

function createUserConfig(
  config: Record<string, string>,
  enabled = true,
): {
  id: string;
  userId: string;
  providerType: "vercel";
  enabled: boolean;
  config: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: "config-1",
    userId: "user-1",
    providerType: "vercel",
    enabled,
    config,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("buildEffectiveProviderConfig", () => {
  test("uses saved values first, falls back to env values, and ignores whitespace-only entries", () => {
    const configFields: SandboxConfigField[] = [
      { key: "TEST_A", label: "A", type: "text", required: false },
      { key: "TEST_B", label: "B", type: "text", required: false },
      { key: "TEST_C", label: "C", type: "text", required: false },
    ];

    process.env.TEST_A = "env-a";
    process.env.TEST_B = " env-b ";
    process.env.TEST_C = "   ";
    process.env.TEST_D = "env-d";

    const effective = buildEffectiveProviderConfig(configFields, {
      TEST_A: " saved-a ",
      TEST_B: "\t",
      TEST_C: "   ",
      TEST_D: "saved-d",
    });

    expect(effective).toEqual({
      TEST_A: "saved-a",
      TEST_B: "env-b",
    });
  });
});

describe("isConfiguredProvider", () => {
  test("returns true when every required field is present from mixed saved/env values", () => {
    const configFields: SandboxConfigField[] = [
      {
        key: "TEST_REQUIRED_URL",
        label: "Required URL",
        type: "url",
        required: true,
      },
      {
        key: "TEST_REQUIRED_TOKEN",
        label: "Required Token",
        type: "password",
        required: true,
      },
      {
        key: "TEST_OPTIONAL_TEAM",
        label: "Optional Team",
        type: "text",
        required: false,
      },
    ];

    process.env.TEST_REQUIRED_URL = "https://env.example.com";

    expect(
      isConfiguredProvider(configFields, {
        TEST_REQUIRED_TOKEN: " saved-token ",
      }),
    ).toBe(true);
  });

  test("returns false when any required field is missing after normalization", () => {
    const configFields: SandboxConfigField[] = [
      {
        key: "TEST_REQUIRED_URL",
        label: "Required URL",
        type: "url",
        required: true,
      },
      {
        key: "TEST_REQUIRED_TOKEN",
        label: "Required Token",
        type: "password",
        required: true,
      },
      {
        key: "TEST_OPTIONAL_TEAM",
        label: "Optional Team",
        type: "text",
        required: false,
      },
    ];

    process.env.TEST_REQUIRED_URL = "https://env.example.com";
    process.env.TEST_REQUIRED_TOKEN = "   ";

    expect(
      isConfiguredProvider(configFields, {
        TEST_REQUIRED_TOKEN: "\n",
        TEST_OPTIONAL_TEAM: "saved-team",
      }),
    ).toBe(false);
  });

  test("returns true for optional-only providers only when at least one value is present", () => {
    const configFields: SandboxConfigField[] = [
      {
        key: "TEST_OPTIONAL_TEAM",
        label: "Optional Team",
        type: "text",
        required: false,
      },
    ];

    expect(isConfiguredProvider(configFields, {})).toBe(false);

    process.env.TEST_OPTIONAL_TEAM = "env-team";

    expect(isConfiguredProvider(configFields, {})).toBe(true);
  });

  test("returns true for zero-field providers", () => {
    expect(isConfiguredProvider([], {})).toBe(true);
  });
});

describe("buildSandboxProviderSettingsData", () => {
  test("masks saved secrets and reports env/override sources with mixed saved and env values", () => {
    const configFields: SandboxConfigField[] = [
      {
        key: "TEST_REQUIRED_URL",
        label: "Required URL",
        type: "url",
        required: true,
      },
      {
        key: "TEST_REQUIRED_TOKEN",
        label: "Required Token",
        type: "password",
        required: true,
      },
      {
        key: "TEST_OPTIONAL_TEAM",
        label: "Optional Team",
        type: "text",
        required: false,
      },
      {
        key: "TEST_OPTIONAL_NOTE",
        label: "Optional Note",
        type: "text",
        required: false,
      },
    ];

    process.env.TEST_REQUIRED_URL = "https://env.example.com";
    process.env.TEST_REQUIRED_TOKEN = "env-token";
    process.env.TEST_OPTIONAL_TEAM = "env-team";
    process.env.TEST_OPTIONAL_NOTE = "env-note";

    const provider = createProvider(configFields);
    const settings = buildSandboxProviderSettingsData(
      provider,
      createUserConfig({
        TEST_REQUIRED_TOKEN: " saved-token ",
        TEST_OPTIONAL_TEAM: " saved-team ",
        TEST_OPTIONAL_NOTE: "   ",
      }),
    );

    expect(settings.config).toEqual({
      TEST_OPTIONAL_TEAM: "saved-team",
    });
    expect(settings.secretConfigKeys).toEqual(["TEST_REQUIRED_TOKEN"]);
    expect(settings.environmentConfigKeys).toEqual([
      "TEST_REQUIRED_URL",
      "TEST_OPTIONAL_NOTE",
    ]);
    expect(settings.overriddenEnvironmentConfigKeys).toEqual([
      "TEST_REQUIRED_TOKEN",
      "TEST_OPTIONAL_TEAM",
    ]);
    expect(settings.isConfigured).toBe(true);
  });

  test("marks provider as not configured when required fields are unresolved", () => {
    const configFields: SandboxConfigField[] = [
      {
        key: "TEST_REQUIRED_URL",
        label: "Required URL",
        type: "url",
        required: true,
      },
      {
        key: "TEST_REQUIRED_TOKEN",
        label: "Required Token",
        type: "password",
        required: true,
      },
      {
        key: "TEST_OPTIONAL_TEAM",
        label: "Optional Team",
        type: "text",
        required: false,
      },
    ];

    process.env.TEST_REQUIRED_URL = "https://env.example.com";
    process.env.TEST_REQUIRED_TOKEN = "   ";

    const provider = createProvider(configFields);
    const settings = buildSandboxProviderSettingsData(
      provider,
      createUserConfig({
        TEST_OPTIONAL_TEAM: "saved-team",
      }),
    );

    expect(settings.config).toEqual({
      TEST_OPTIONAL_TEAM: "saved-team",
    });
    expect(settings.environmentConfigKeys).toEqual(["TEST_REQUIRED_URL"]);
    expect(settings.overriddenEnvironmentConfigKeys).toEqual([]);
    expect(settings.isConfigured).toBe(false);
  });
});
