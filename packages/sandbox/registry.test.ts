import { describe, expect, test } from "bun:test";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef } from "./provider";
import { SandboxRegistry } from "./registry";

function makeDef(
  type: "vercel" | "docker" | "daytona",
  available = true,
): SandboxProviderDef {
  return {
    type,
    label: type,
    capabilities: {
      persistent: false,
      db: false,
      envInjection: false,
      credentialBrokering: false,
    },
    isAvailable: () => available,
    reasonUnavailable: () => (available ? undefined : `${type} not configured`),
    create: async () => ({ type }) as unknown as Sandbox,
    connect: async () => ({ type }) as unknown as Sandbox,
  };
}

describe("SandboxRegistry", () => {
  test("get returns registered provider", () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel"));
    const def = reg.get("vercel");
    expect(def?.type).toBe("vercel");
  });

  test("get returns undefined for unregistered type", () => {
    const reg = new SandboxRegistry();
    expect(reg.get("docker")).toBeUndefined();
  });

  test("list returns all registered providers", () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel"));
    reg.register(makeDef("docker"));
    expect(reg.list().map((d) => d.type)).toEqual(["vercel", "docker"]);
  });

  test("listAvailable filters unavailable providers", () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel", true));
    reg.register(makeDef("docker", false));
    const available = reg.listAvailable();
    expect(available.map((d) => d.type)).toEqual(["vercel"]);
  });

  test("create dispatches through registered provider", async () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel"));
    const sb = await reg.create("vercel", { type: "vercel" });
    expect((sb as unknown as { type: string }).type).toBe("vercel");
  });

  test("create throws for unknown provider type", async () => {
    const reg = new SandboxRegistry();
    await expect(
      reg.create("docker" as "vercel", { type: "docker" }),
    ).rejects.toThrow("Unknown sandbox provider: docker");
  });

  test("connect dispatches through registered provider using state.type", async () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel"));
    const sb = await reg.connect({ type: "vercel" } as never);
    expect((sb as unknown as { type: string }).type).toBe("vercel");
  });

  test("connect resolves legacy 'cloud' state as 'vercel'", async () => {
    const reg = new SandboxRegistry();
    reg.register(makeDef("vercel"));
    const sb = await reg.connect({ type: "cloud" } as never);
    expect((sb as unknown as { type: string }).type).toBe("vercel");
  });
});
