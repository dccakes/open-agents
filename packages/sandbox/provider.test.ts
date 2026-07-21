import { describe, expect, test } from "bun:test";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef } from "./provider";

describe("SandboxProviderDef type contract", () => {
  test("minimal provider satisfies interface", () => {
    const mockProvider: SandboxProviderDef<{ type: "vercel" }> = {
      type: "vercel",
      label: "Vercel",
      capabilities: {
        persistent: true,
        db: true,
        envInjection: true,
        credentialBrokering: true,
      },
      isAvailable: () => true,
      reasonUnavailable: () => undefined,
      create: async (_state, _opts) => ({}) as Sandbox,
      connect: async (_state, _opts) => ({}) as Sandbox,
    };
    expect(mockProvider.type).toBe("vercel");
    expect(mockProvider.isAvailable()).toBe(true);
    expect(mockProvider.reasonUnavailable()).toBeUndefined();
  });

  test("unavailable provider returns reason", () => {
    const mockProvider: SandboxProviderDef<unknown> = {
      type: "daytona",
      label: "Daytona",
      beta: true,
      capabilities: {
        persistent: true,
        db: true,
        envInjection: true,
        credentialBrokering: true,
      },
      isAvailable: () => false,
      reasonUnavailable: () => "DAYTONA_API_KEY not configured",
      create: async () => ({}) as Sandbox,
      connect: async () => ({}) as Sandbox,
    };
    expect(mockProvider.isAvailable()).toBe(false);
    expect(mockProvider.reasonUnavailable()).toBe(
      "DAYTONA_API_KEY not configured",
    );
  });
});
