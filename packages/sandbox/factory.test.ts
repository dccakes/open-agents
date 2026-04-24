import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef } from "./provider";
import { defaultRegistry } from "./registry";

function makeConnectedSandbox(label: string): Sandbox {
  return {
    type: "vercel",
    workingDirectory: "/",
    readFile: async () => label,
  } as unknown as Sandbox;
}

function clearDefaultRegistry(): void {
  const registry = defaultRegistry as unknown as {
    providers: Map<string, SandboxProviderDef>;
  };
  registry.providers.clear();
}

describe("connectSandbox (registry dispatch)", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  test("dispatches to registered provider via state.type", async () => {
    const connectMock = mock(async () =>
      makeConnectedSandbox("vercel-connected"),
    );
    const def: SandboxProviderDef = {
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
      create: connectMock,
      connect: connectMock,
    };
    defaultRegistry.register(def);

    const { connectSandbox } = await import("./factory");
    const sb = await connectSandbox({ state: { type: "vercel" } });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(sb).toBeDefined();
  });

  test("dispatches legacy 'cloud' state as 'vercel'", async () => {
    const connectMock = mock(async () =>
      makeConnectedSandbox("vercel-connected"),
    );
    const def: SandboxProviderDef = {
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
      create: connectMock,
      connect: connectMock,
    };
    defaultRegistry.register(def);

    const { connectSandbox } = await import("./factory");
    await connectSandbox({ state: { type: "cloud" } });
    expect(connectMock).toHaveBeenCalled();
  });
});
