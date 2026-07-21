import { describe, expect, test } from "bun:test";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef, SandboxProviderType } from "./provider";
import { SandboxRegistry } from "./registry";

type ProviderDouble = {
  def: SandboxProviderDef;
  calls: {
    connect: number;
    create: number;
  };
};

function makeProviderDouble(
  type: SandboxProviderType,
  available = true,
): ProviderDouble {
  const calls = {
    connect: 0,
    create: 0,
  };

  const def: SandboxProviderDef = {
    type,
    label: `${type} provider`,
    capabilities: {
      persistent: false,
      db: false,
      envInjection: false,
      credentialBrokering: false,
    },
    isAvailable: () => available,
    reasonUnavailable: () => (available ? undefined : `${type} unavailable`),
    create: async () => {
      calls.create += 1;
      return { provider: type, mode: "create" } as unknown as Sandbox;
    },
    connect: async () => {
      calls.connect += 1;
      return { provider: type, mode: "connect" } as unknown as Sandbox;
    },
  };

  return { def, calls };
}

describe("SandboxRegistry integration", () => {
  test("listAvailable() excludes unavailable providers", () => {
    const registry = new SandboxRegistry();
    const vercel = makeProviderDouble("vercel", true);
    const docker = makeProviderDouble("docker", false);
    const daytona = makeProviderDouble("daytona", true);

    registry.register(vercel.def);
    registry.register(docker.def);
    registry.register(daytona.def);

    expect(registry.listAvailable().map((provider) => provider.type)).toEqual([
      "vercel",
      "daytona",
    ]);
  });

  test("connect() throws actionable error for unknown provider type", async () => {
    const registry = new SandboxRegistry();
    registry.register(makeProviderDouble("vercel").def);

    await expect(
      registry.connect({ type: "unknown" } as never),
    ).rejects.toThrow("Unknown sandbox provider: unknown");
  });

  test("create() throws actionable error for unknown provider type", async () => {
    const registry = new SandboxRegistry();
    registry.register(makeProviderDouble("vercel").def);

    await expect(
      registry.create("unknown" as SandboxProviderType, { type: "unknown" }),
    ).rejects.toThrow("Unknown sandbox provider: unknown");
  });

  test("legacy cloud state maps to vercel", async () => {
    const registry = new SandboxRegistry();
    const vercel = makeProviderDouble("vercel");
    const docker = makeProviderDouble("docker");
    registry.register(vercel.def);
    registry.register(docker.def);

    const sandbox = (await registry.connect({
      type: "cloud",
    } as never)) as unknown as { provider: string };

    expect(sandbox.provider).toBe("vercel");
    expect(vercel.calls.connect).toBe(1);
    expect(docker.calls.connect).toBe(0);
  });
});
