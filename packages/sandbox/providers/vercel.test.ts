import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "../interface";
import type { SandboxProviderDef } from "../provider";
import { defaultRegistry } from "../registry";

const connectVercelMock = mock(async () => ({ type: "vercel" }) as Sandbox);

mock.module("../vercel/connect", () => ({
  connectVercel: connectVercelMock,
}));

function clearDefaultRegistry(): void {
  const registry = defaultRegistry as unknown as {
    providers: Map<string, SandboxProviderDef>;
  };
  registry.providers.clear();
}

beforeAll(async () => {
  clearDefaultRegistry();
  await import("../providers/vercel");
});

beforeEach(() => {
  connectVercelMock.mockClear();
});

describe("Vercel provider registration", () => {
  test("vercel is registered in defaultRegistry", () => {
    const def = defaultRegistry.get("vercel");
    expect(def).toBeDefined();
    expect(def?.type).toBe("vercel");
    expect(def?.label).toBe("Vercel");
    expect(def?.isAvailable()).toBe(true);
  });

  test("vercel capabilities are set correctly", () => {
    const def = defaultRegistry.get("vercel");
    expect(def?.capabilities.persistent).toBe(true);
    expect(def?.capabilities.db).toBe(true);
    expect(def?.capabilities.envInjection).toBe(true);
    expect(def?.capabilities.credentialBrokering).toBe(true);
  });

  test("cloud alias resolves to vercel provider", async () => {
    const sb = await defaultRegistry.connect({ type: "cloud" } as never);
    expect(sb).toBeDefined();
    expect(connectVercelMock).toHaveBeenCalledTimes(1);
  });
});
